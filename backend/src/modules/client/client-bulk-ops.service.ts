/**
 * массовые операции над всеми подписками клиента.
 *
 * Контекст: после унификации (T-unify) у клиента N подписок в таблице `subscriptions`,
 * каждая со своим Remna-юзером (remnawaveUuid). Старые API уровня «клиент → один Remna»
 * больше не работают — нужны bulk-операции на уровне клиента, которые внутри проходят
 * по всем его подпискам.
 *
 * Возвращаемый формат — структурированный отчёт, чтобы UI мог показать «3 ok / 1 failed»
 * с детализацией по каждой подписке.
 */

import { prisma } from "../../db.js";
import {
  remnaGetUser,
  remnaUpdateUser,
  remnaResetUserTraffic,
  remnaGetUserByTelegramId,
  remnaCreateUser,
  remnaUsernameFromClient,
  extractRemnaUuid,
  isRemnaConfigured,
} from "../remna/remna.client.js";
import {
  deleteSingleSubscription,
  disableSingleSubscription,
  enableSingleSubscription,
  isActiveSubscriptionGrace,
  revokeSingleSubscription,
  runSingleSubscriptionOperation,
  type SingleSubscriptionOperationResult,
} from "../subscription/single-subscription-lifecycle.service.js";
import { remnaTrafficSettings } from "../squad-traffic/traffic-remna-policy.js";

export type BulkOpItem = {
  subscriptionId: string;
  subscriptionIndex: number;
  remnawaveUuid: string | null;
  status: "ok" | "skipped" | "error";
  message?: string;
};

export type BulkOpReport = {
  ok: number;
  skipped: number;
  failed: number;
  items: BulkOpItem[];
};

function newReport(): BulkOpReport {
  return { ok: 0, skipped: 0, failed: 0, items: [] };
}

function pushItem(report: BulkOpReport, item: BulkOpItem) {
  report.items.push(item);
  if (item.status === "ok") report.ok++;
  else if (item.status === "skipped") report.skipped++;
  else report.failed++;
}

async function applyToSubscription(
  report: BulkOpReport,
  sub: { id: string; subscriptionIndex: number; remnawaveUuid: string | null },
  operation: (subscriptionId: string) => Promise<SingleSubscriptionOperationResult>,
) {
  const result = await operation(sub.id);
  pushItem(report, {
    subscriptionId: sub.id,
    subscriptionIndex: sub.subscriptionIndex,
    remnawaveUuid: sub.remnawaveUuid,
    status: result.failures.length ? "error" : "ok",
    ...(result.failures.length ? { message: result.failures.map((failure) => `${failure.key}: ${failure.error}`).join("; ") } : {}),
  });
}

async function fetchSubscriptions(clientId: string) {
  return prisma.subscription.findMany({
    where: { ownerId: clientId },
    orderBy: { subscriptionIndex: "asc" },
    select: {
      id: true,
      subscriptionIndex: true,
      remnawaveUuid: true,
      tariffId: true,
      autoRenewEnabled: true,
      expireAt: true,
      graceUntil: true,
      extraDevices: true,
      tariff: { select: { internalSquadUuids: true, trafficLimitBytes: true, trafficResetMode: true, includedDevices: true, durationDays: true } },
    },
  });
}

/**
 * Composite «Отключить клиента»:
 *   - Client.isBlocked = true
 *   - autoRenewEnabled = false для всех подписок (чтоб крон не списывал у заблоченных)
 *   - remnaDisableUser для каждого UUID
 */
export async function disableClient(clientId: string): Promise<BulkOpReport & { clientBlocked: boolean; autoRenewDisabled: number }> {
  const report = newReport();
  await prisma.client.update({ where: { id: clientId }, data: { isBlocked: true } }).catch(() => {});
  const arResult = await prisma.subscription.updateMany({
    where: { ownerId: clientId, autoRenewEnabled: true },
    data: { autoRenewEnabled: false },
  }).catch(() => ({ count: 0 }));

  const subs = await fetchSubscriptions(clientId);
  for (const sub of subs) {
    if (!isRemnaConfigured()) {
      pushItem(report, { subscriptionId: sub.id, subscriptionIndex: sub.subscriptionIndex, remnawaveUuid: sub.remnawaveUuid, status: "skipped", message: "Remna not configured" });
      continue;
    }
    await applyToSubscription(report, sub, disableSingleSubscription);
  }
  return { ...report, clientBlocked: true, autoRenewDisabled: arResult.count };
}

/**
 * Composite «Включить клиента»:
 *   - Client.isBlocked = false
 *   - remnaEnableUser для каждого UUID (только если подписка не просрочена — иначе оставляем DISABLED,
 *     чтобы юзер не получил VPN без оплаты)
 *   - autoRenewEnabled оставляем как есть (юзер сам включит обратно)
 */
export async function enableClient(clientId: string): Promise<BulkOpReport & { clientUnblocked: boolean }> {
  const report = newReport();
  await prisma.client.update({ where: { id: clientId }, data: { isBlocked: false } }).catch(() => {});

  const subs = await fetchSubscriptions(clientId);
  for (const sub of subs) {
    if (!sub.remnawaveUuid) {
      pushItem(report, { subscriptionId: sub.id, subscriptionIndex: sub.subscriptionIndex, remnawaveUuid: null, status: "skipped", message: "no remnawaveUuid" });
      continue;
    }
    if (!isRemnaConfigured()) {
      pushItem(report, { subscriptionId: sub.id, subscriptionIndex: sub.subscriptionIndex, remnawaveUuid: sub.remnawaveUuid, status: "skipped", message: "Remna not configured" });
      continue;
    }
    if (sub.expireAt && sub.expireAt.getTime() <= Date.now()) {
      pushItem(report, { subscriptionId: sub.id, subscriptionIndex: sub.subscriptionIndex, remnawaveUuid: sub.remnawaveUuid, status: "skipped", message: "expired — оставляем disabled" });
      continue;
    }
    await applyToSubscription(report, sub, enableSingleSubscription);
  }
  return { ...report, clientUnblocked: true };
}

/** Только Remna disable, без бан в боте — для случая «вырубить VPN, но оставить юзера в боте». */
export async function disableAllSubscriptionsInRemna(clientId: string): Promise<BulkOpReport> {
  const report = newReport();
  const subs = await fetchSubscriptions(clientId);
  for (const sub of subs) {
    await applyToSubscription(report, sub, disableSingleSubscription);
  }
  return report;
}

export async function enableAllSubscriptionsInRemna(clientId: string): Promise<BulkOpReport> {
  const report = newReport();
  const subs = await fetchSubscriptions(clientId);
  for (const sub of subs) {
    await applyToSubscription(report, sub, enableSingleSubscription);
  }
  return report;
}

/** Сбросить трафик на каждой подписке. */
export async function resetAllSubscriptionsTraffic(clientId: string): Promise<BulkOpReport> {
  const report = newReport();
  const subs = await fetchSubscriptions(clientId);
  for (const sub of subs) {
    await applyToSubscription(report, sub, (subscriptionId) =>
      runSingleSubscriptionOperation(subscriptionId, remnaResetUserTraffic));
  }
  return report;
}

/** Revoke subscription URL для каждой подписки (старые ссылки перестают работать). */
export async function revokeAllSubscriptionsUrls(clientId: string): Promise<BulkOpReport> {
  const report = newReport();
  const subs = await fetchSubscriptions(clientId);
  for (const sub of subs) {
    const result = await revokeSingleSubscription(sub.id);
    pushItem(report, {
      subscriptionId: sub.id,
      subscriptionIndex: sub.subscriptionIndex,
      remnawaveUuid: sub.remnawaveUuid,
      status: result.requiredFailure ? "error" : "ok",
      ...(result.failures.length
        ? { message: result.failures.map((failure) => `${failure.key}: ${failure.error}`).join("; ") }
        : {}),
    });
  }
  return report;
}

/**
 * Push: БД → Remna. Для каждой подписки забираем тариф из БД и PATCH в Remna
 * (expireAt можно пересчитать только если durationDays известны — для подписки без tariffId
 * skip).
 */
export async function syncAllSubscriptionsToRemna(clientId: string): Promise<BulkOpReport> {
  const report = newReport();
  const subs = await fetchSubscriptions(clientId);
  for (const sub of subs) {
    if (!sub.remnawaveUuid) {
      pushItem(report, { subscriptionId: sub.id, subscriptionIndex: sub.subscriptionIndex, remnawaveUuid: null, status: "skipped", message: "no remnawaveUuid (создать?)" });
      continue;
    }
    if (!sub.tariff) {
      pushItem(report, { subscriptionId: sub.id, subscriptionIndex: sub.subscriptionIndex, remnawaveUuid: sub.remnawaveUuid, status: "skipped", message: "нет тарифа — нечего пушить" });
      continue;
    }
    // Активный Lazeika-Only grace защищён от перезаписи (§4.4).
    if (isActiveSubscriptionGrace(sub.graceUntil ?? null)) {
      pushItem(report, { subscriptionId: sub.id, subscriptionIndex: sub.subscriptionIndex, remnawaveUuid: sub.remnawaveUuid, status: "skipped", message: "активен режим продления Lazeika-Only — sync пропущен" });
      continue;
    }
    const tariff = sub.tariff;
    const result = await runSingleSubscriptionOperation(sub.id, (uuid) => remnaUpdateUser({
      uuid,
      ...(sub.expireAt ? { expireAt: sub.expireAt.toISOString() } : {}),
      ...remnaTrafficSettings(tariff),
      hwidDeviceLimit: Math.max(1, tariff.includedDevices + sub.extraDevices),
      activeInternalSquads: tariff.internalSquadUuids,
    }));
    pushItem(report, {
      subscriptionId: sub.id,
      subscriptionIndex: sub.subscriptionIndex,
      remnawaveUuid: sub.remnawaveUuid,
      status: result.failures.length ? "error" : "ok",
      ...(result.failures.length ? { message: result.failures.map((failure) => `${failure.key}: ${failure.error}`).join("; ") } : {}),
    });
  }
  return report;
}

/** Pull: Remna → БД. Обновляем locale-кеш в БД (на будущее, сейчас минимально). */
export async function syncAllSubscriptionsFromRemna(clientId: string): Promise<BulkOpReport & { foundExtraInRemna: number }> {
  const report = newReport();
  let foundExtraInRemna = 0;
  const subs = await fetchSubscriptions(clientId);
  for (const sub of subs) {
    if (!sub.remnawaveUuid) {
      pushItem(report, { subscriptionId: sub.id, subscriptionIndex: sub.subscriptionIndex, remnawaveUuid: null, status: "skipped", message: "нет UUID" });
      continue;
    }
    const r = await remnaGetUser(sub.remnawaveUuid);
    if (r.error || !r.data) {
      pushItem(report, { subscriptionId: sub.id, subscriptionIndex: sub.subscriptionIndex, remnawaveUuid: sub.remnawaveUuid, status: "error", message: r.error ?? "no data" });
      continue;
    }
    // Здесь можно расширить — пока просто фиксируем что синк прошёл.
    pushItem(report, { subscriptionId: sub.id, subscriptionIndex: sub.subscriptionIndex, remnawaveUuid: sub.remnawaveUuid, status: "ok" });
  }

  // Бонус: проверим, нет ли в Remna юзеров с этим Telegram ID, которых у нас в Subscription[] нет.
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { telegramId: true } });
  if (client?.telegramId?.trim()) {
    const remnaRes = await remnaGetUserByTelegramId(client.telegramId.trim());
    const uuid = extractRemnaUuid(remnaRes.data);
    if (uuid && !subs.some((s) => s.remnawaveUuid === uuid)) {
      foundExtraInRemna = 1;
    }
  }
  return { ...report, foundExtraInRemna };
}

/**
 * Удалить все подписки клиента: и в Remna (delete user), и в БД (delete row).
 * Клиент остаётся в БД (баланс, история платежей, и т. п.).
 */
export async function wipeClientSubscriptions(clientId: string): Promise<BulkOpReport> {
  const report = newReport();
  const subs = await fetchSubscriptions(clientId);
  for (const sub of subs) {
    const deletion = await deleteSingleSubscription(sub.id);
    if (!deletion.deleted) {
      pushItem(report, { subscriptionId: sub.id, subscriptionIndex: sub.subscriptionIndex, remnawaveUuid: sub.remnawaveUuid, status: "error", message: deletion.failures.map((failure) => failure.error).join("; ") });
      continue;
    }
    // Сбросим легаси-якорь у клиента если удалили primary.
    if (sub.subscriptionIndex === 0) {
      await prisma.client.update({ where: { id: clientId }, data: { remnawaveUuid: null, currentTariffId: null } }).catch(() => {});
    }
    pushItem(report, { subscriptionId: sub.id, subscriptionIndex: sub.subscriptionIndex, remnawaveUuid: sub.remnawaveUuid, status: "ok" });
  }
  return report;
}

/**
 * Audit (read-only): diff БД vs Remna. Возвращает таблицу расхождений.
 * Что проверяем:
 *   - подписки с UUID, но юзер удалён в Remna (404);
 *   - расхождение expireAt > 1 день;
 *   - подписки без UUID (нечем управлять).
 */
export type AuditIssue = {
  subscriptionId: string;
  subscriptionIndex: number;
  type: "MISSING_REMNA_USER" | "EXPIRE_MISMATCH" | "NO_UUID" | "EXTRA_REMNA_USER";
  detail: string;
};

export async function auditClientSubscriptions(clientId: string): Promise<{ issues: AuditIssue[]; total: number; checked: number }> {
  const issues: AuditIssue[] = [];
  const subs = await fetchSubscriptions(clientId);
  let checked = 0;
  for (const sub of subs) {
    if (!sub.remnawaveUuid) {
      issues.push({ subscriptionId: sub.id, subscriptionIndex: sub.subscriptionIndex, type: "NO_UUID", detail: "Подписка без Remnawave UUID" });
      continue;
    }
    checked++;
    const r = await remnaGetUser(sub.remnawaveUuid);
    if (r.status === 404) {
      issues.push({ subscriptionId: sub.id, subscriptionIndex: sub.subscriptionIndex, type: "MISSING_REMNA_USER", detail: `Remna user ${sub.remnawaveUuid.slice(0, 8)}… не найден` });
      continue;
    }
    // EXPIRE_MISMATCH: пока пропускаем (нужно сравнивать с durationDays/createdAt — отдельная фича).
  }
  // EXTRA: проверим есть ли в Remna юзер по TG, которого у нас нет.
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { telegramId: true } });
  if (client?.telegramId?.trim()) {
    const remnaRes = await remnaGetUserByTelegramId(client.telegramId.trim());
    const uuid = extractRemnaUuid(remnaRes.data);
    if (uuid && !subs.some((s) => s.remnawaveUuid === uuid)) {
      issues.push({ subscriptionId: "", subscriptionIndex: -1, type: "EXTRA_REMNA_USER", detail: `В Remna есть юзер ${uuid.slice(0, 8)}… с этим TG, но в БД его нет` });
    }
  }
  return { issues, total: subs.length, checked };
}

/**
 * Создать Remna-юзера для подписки, у которой нет UUID. Возвращает новый UUID или null.
 * Используется в Push-sync когда подписка осиротела.
 */
export async function createRemnaUserForOrphanSubscription(subscriptionId: string): Promise<string | null> {
  const sub = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: {
      owner: { select: { id: true, email: true, telegramId: true, telegramUsername: true } },
      tariff: { select: { trafficLimitBytes: true, trafficLimitMode: true, trafficResetMode: true, includedDevices: true, internalSquadUuids: true, durationDays: true } },
    },
  });
  if (!sub || sub.remnawaveUuid) return sub?.remnawaveUuid ?? null;
  if (!sub.tariff) return null;

  const expireAt = new Date(Date.now() + sub.tariff.durationDays * 86_400_000).toISOString();
  const username = remnaUsernameFromClient({
    telegramUsername: sub.owner.telegramUsername,
    telegramId: sub.owner.telegramId,
    email: sub.owner.email,
    clientIdFallback: sub.owner.id,
  });
  const r = await remnaCreateUser({
    username: sub.subscriptionIndex === 0 ? username : `${username}_${sub.subscriptionIndex}`,
    ...remnaTrafficSettings(sub.tariff),
    expireAt,
    hwidDeviceLimit: Math.max(1, sub.tariff.includedDevices + sub.extraDevices),
    activeInternalSquads: sub.tariff.internalSquadUuids,
    ...(sub.owner.telegramId?.trim() && { telegramId: parseInt(sub.owner.telegramId, 10) }),
    ...(sub.owner.email?.trim() && { email: sub.owner.email.trim() }),
  });
  const uuid = extractRemnaUuid(r.data);
  if (!uuid) return null;
  await prisma.subscription.update({ where: { id: subscriptionId }, data: { remnawaveUuid: uuid } });
  return uuid;
}
