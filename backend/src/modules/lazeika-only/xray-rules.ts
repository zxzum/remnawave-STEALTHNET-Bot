/**
 * Lazeika-Only: построение управляемого inbound и routing-правил Xray.
 * Чистые функции — тестируются без Remna/SSH.
 */

export type XrayInbound = Record<string, unknown> & { tag?: string; port?: number | string };
export type XrayRoutingRule = Record<string, unknown>;
export type XrayConfig = {
  log?: unknown;
  inbounds?: XrayInbound[];
  outbounds?: Array<{ tag?: string; protocol?: string } & Record<string, unknown>>;
  routing?: { rules?: XrayRoutingRule[] } & Record<string, unknown>;
};

/** Правило применяется строго к нашему inboundTag — глобальный routing не трогаем. */
export function buildRoutingRules(inboundTag: string, blockOutboundTag: string): XrayRoutingRule[] {
  return [
    { inboundTag: [inboundTag], domain: ["geosite:telegram"], outbound: "DIRECT", network: "tcp,udp" },
    { inboundTag: [inboundTag], domain: ["domain:lazeika.xyz"], outbound: "DIRECT" },
    { inboundTag: [inboundTag], network: "tcp,udp", outbound: blockOutboundTag },
  ];
}

/** Стабильный marker-тег inbound: LAZEIKA_ONLY_INBOUND_<короткий uuid>. */
export function managedInboundTag(profileUuidHint: string): string {
  const short = profileUuidHint.replaceAll("-", "").slice(0, 8).toUpperCase();
  return `LAZEIKA_ONLY_INBOUND_${short}`;
}

/**
 * Управляемый inbound = глубокая копия существующего рабочего inbound профиля
 * (наследует валидные streamSettings/ключи) с новым tag и портом.
 * Sniffing обязателен — без него доменные правила маршрутизации не работают.
 */
export function buildManagedInbound(baseInbound: XrayInbound, tag: string, port: number): XrayInbound {
  const inbound = JSON.parse(JSON.stringify(baseInbound)) as XrayInbound;
  inbound.tag = tag;
  inbound.port = port;
  const sniffing = (inbound.sniffing ??= {}) as Record<string, unknown>;
  sniffing.enabled = true;
  const destOverride = Array.isArray(sniffing.destOverride) ? sniffing.destOverride : [];
  for (const proto of ["http", "tls", "quic"]) {
    if (!destOverride.includes(proto)) destOverride.push(proto);
  }
  sniffing.destOverride = destOverride;
  return inbound;
}

function findOutboundByTag(config: XrayConfig, tagLower: string) {
  return config.outbounds?.find((o) => typeof o?.tag === "string" && o.tag.toLowerCase() === tagLower);
}

/** Уникальный свободный порт: не занят другими inbound и не совпадает с запрещёнными. */
export function pickManagedPort(config: XrayConfig, forbiddenPorts: Iterable<number>): number {
  const used = new Set<number>(forbiddenPorts);
  for (const ib of config.inbounds ?? []) {
    const p = Number(ib?.port);
    if (Number.isInteger(p)) used.add(p);
  }
  // ponytail: детерминированный поиск из безопасного диапазона вместо случайного порта.
  for (let port = 40001; port <= 40100; port++) {
    if (!used.has(port)) return port;
  }
  throw new Error("Не удалось подобрать свободный порт для Lazeika-Only inbound");
}

export class XrayConfigError extends Error {}

/**
 * Добавить в копию конфига управляемый inbound + allow/block правила.
 * Ошибка, если нет BLOCK-outbound или managed inbound уже существует с другим портом.
 * Существующие inbounds/rules не изменяются.
 */
export function applyLazeikaToConfig(
  base: XrayConfig,
  baseInboundForClone: XrayInbound,
  tag: string,
  port: number,
): { config: XrayConfig; inboundUuidlessTag: string; rulesAdded: number } {
  const block = findOutboundByTag(base, "block") ?? findOutboundByTag(base, "blackhole");
  if (!block?.tag) {
    throw new XrayConfigError("В профиле нет outbound BLOCK/blackhole — allowlist применить нельзя");
  }
  const existing = (base.inbounds ?? []).find((ib) => ib?.tag === tag);
  if (existing && Number(existing.port) !== port) {
    throw new XrayConfigError(`Управляемый inbound ${tag} уже существует с другим портом`);
  }

  const config: XrayConfig = JSON.parse(JSON.stringify(base));
  config.inbounds ??= [];
  config.routing ??= { rules: [] };
  config.routing.rules ??= [];
  const outbounds = config.outbounds ??= [];

  if (!existing) {
    config.inbounds.push(buildManagedInbound(baseInboundForClone, tag, port));
    // ponytail: geosite:telegram — штатный matcher Xray-core; валидность проверяем наличием BLOCK.
  }

  // Удаляем только свои прежние правила (по inboundTag), затем добавляем актуальные.
  const foreignRules = config.routing.rules.filter(
    (r) => !Array.isArray(r.inboundTag) || !(r.inboundTag as string[]).includes(tag),
  );
  const rules = buildRoutingRules(tag, block.tag);
  config.routing.rules = [...foreignRules, ...rules];
  if (!outbounds.some((o) => o.tag === "DIRECT")) {
    outbounds.push({ tag: "DIRECT", protocol: "freedom" });
  }
  return { config, inboundUuidlessTag: tag, rulesAdded: rules.length };
}
