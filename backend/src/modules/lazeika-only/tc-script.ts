/**
 * Lazeika-Only: генерация идемпотентного tc-скрипта и systemd unit для ноды.
 * Чистые функции; на ноду уходит только валидированный текст.
 *
 * АГРЕГИРОВАННЫЙ лимит (§7 финала): все 8 классификаторов ссылаются на ОДИН
 * общий police action на направление (ingress idx / egress idx) → один общий
 * token bucket на порт managed inbound. Лимит НЕ умножается на
 * IPv4/IPv6 × TCP/UDP ×(×2 направлений). Egress — отдельный bucket для ответов.
 *
 * Ограничения (спецификация §3.2): qdisc clsact + flower/classifier с собственными
 * pref/handle; root qdisc и firewall не трогаем; IPv4+IPv6, TCP+UDP.
 */

export const TC_SCRIPT_PATH = "/usr/local/sbin/lazeika-only-tc";
export const TC_UNIT_NAME = "lazeika-only-tc.service";
/** Собственные pref 11000..11007 — единый контракт проекта (§8 финала). */
export const TC_PREF_BASE = 11000;
export const TC_PREF_COUNT = 8;
/** Индексы ОБЩИХ police actions: один token bucket на направление. */
export const TC_POLICE_INDEX_INGRESS = 45101;
export const TC_POLICE_INDEX_EGRESS = 45102;
/** Запрещённые порты для managed inbound: SSH по умолчанию + Remna API. */
const FORBIDDEN_PORTS = [22, 443, 3000, 8080];

export class TcValidationError extends Error {}

export function validateInterface(iface: string): string {
  if (!/^[a-zA-Z0-9._-]{1,15}$/.test(iface)) {
    throw new TcValidationError(`Недопустимое имя интерфейса: ${JSON.stringify(iface)}`);
  }
  return iface;
}

export function validatePort(port: number, forbidden: Iterable<number> = FORBIDDEN_PORTS): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TcValidationError(`Недопустимый порт: ${port}`);
  }
  for (const f of forbidden) {
    if (f === port) throw new TcValidationError(`Порт ${port} совпадает со служебным`);
  }
  return port;
}

export function validateSpeed(mbit: number): number {
  if (!Number.isInteger(mbit) || mbit < 1 || mbit > 1000) {
    throw new TcValidationError(`Недопустимая скорость: ${mbit}`);
  }
  return mbit;
}

/** Список собственных pref'ов: ровно TC_PREF_COUNT штук от базы. */
export function ownedPrefs(): number[] {
  return Array.from({ length: TC_PREF_COUNT }, (_, i) => TC_PREF_BASE + i);
}

/**
 * Скрипт применения лимита. Идемпотентный:
 *  - миграция v1: удаляет legacy-pref'ы прежней версии (11001..11008) — они были
 *    исключительно нашими (документировано в runbook);
 *  - пересоздаёт ДВА общих police action (один bucket на направление);
 *  - ставит 8 цветочных классификаторов, каждый ссылается на общий action по index.
 * Root qdisc не изменяется.
 */
export function buildTcScript(args: { iface: string; port: number; speedMbit: number }): string {
  const iface = validateInterface(args.iface);
  validatePort(args.port);
  validateSpeed(args.speedMbit);
  const lines: string[] = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "# ponytail: генерируется панелью Лазейка ВПН; ручные правки будут перезаписаны.",
    "# Агрегированный limiter: один shared police bucket на направление (см. §7 финала).",
    `IFACE=${JSON.stringify(iface)}`,
    `PORT=${args.port}`,
    "",
    "# clsact нужен для ingress/egress классификаторов; добавляем если нет.",
    'tc qdisc show dev "$IFACE" | grep -q clsact || tc qdisc add dev "$IFACE" clsact',
    "",
    "# Миграция v1→v2: снимаем legacy pref'ы прошлой версии (только наши).",
  ];
  for (const direction of ["ingress", "egress"] as const) {
    for (let p = TC_PREF_BASE + 1; p <= TC_PREF_BASE + TC_PREF_COUNT; p++) {
      lines.push(`tc filter del dev "$IFACE" ${direction} pref ${p} 2>/dev/null || true`);
    }
  }
  lines.push(
    "",
    "# Общие police actions: РОВНО ОДИН token bucket на направление.",
    `tc action del action police index ${TC_POLICE_INDEX_INGRESS} 2>/dev/null || true`,
    `tc actions replace action police rate ${args.speedMbit}mbit burst 256kb drop index ${TC_POLICE_INDEX_INGRESS}`,
    `tc action del action police index ${TC_POLICE_INDEX_EGRESS} 2>/dev/null || true`,
    `tc actions replace action police rate ${args.speedMbit}mbit burst 256kb drop index ${TC_POLICE_INDEX_EGRESS}`,
    "",
    `# Собственные классификаторы: pref ${TC_PREF_BASE}..${TC_PREF_BASE + TC_PREF_COUNT - 1}.`,
  );
  let seq = 0;
  for (const protocol of ["ip", "ipv6"] as const) {
    for (const direction of ["ingress", "egress"] as const) {
      for (const ipProto of ["tcp", "udp"] as const) {
        const pref = TC_PREF_BASE + seq;
        const match = direction === "ingress" ? "dst_port" : "src_port";
        const policeIndex = direction === "ingress" ? TC_POLICE_INDEX_INGRESS : TC_POLICE_INDEX_EGRESS;
        lines.push(
          `tc filter replace dev "$IFACE" ${direction} pref ${pref} handle 1:${seq + 1}0 protocol ${protocol} flower ip_proto ${ipProto} ${match} "$PORT" action police index ${policeIndex}`,
        );
        seq++;
      }
    }
  }
  lines.push(
    "",
    "# Самопроверка: все 8 pref'ов и оба общих action обязаны существовать.",
  );
  for (const pref of ownedPrefs()) {
    lines.push(`tc filter show dev "$IFACE" | grep -q "pref ${pref} " || { echo "PREF_MISSING ${pref}"; exit 1; }`);
  }
  lines.push(
    `tc actions show action police index ${TC_POLICE_INDEX_INGRESS} | grep -qi 'rate ${args.speedMbit}mbit' || { echo "POLICE_MISSING ingress"; exit 1; }`,
    `tc actions show action police index ${TC_POLICE_INDEX_EGRESS} | grep -qi 'rate ${args.speedMbit}mbit' || { echo "POLICE_MISSING egress"; exit 1; }`,
    "",
    'echo "lazeika-only-tc applied on $IFACE port $PORT at ' + args.speedMbit + 'mbit (aggregate)"',
  );
  return lines.join("\n") + "\n";
}

export function buildTcUnit(): string {
  return [
    "[Unit]",
    "Description=Lazeika-Only aggregate tc rate limit (managed by panel)",
    "After=network-online.target docker.service",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=oneshot",
    `ExecStart=${TC_SCRIPT_PATH}`,
    "RemainAfterExit=yes",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
  ].join("\n") + "\n";
}
