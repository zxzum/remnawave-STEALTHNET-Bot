/**
 * Применение купленных опций (доп. трафик, устройства, серверы) к пользователю Remna после оплаты.
 */

import { randomUUID } from "node:crypto";
import { prisma } from "../../db.js";
import { remnaGetUser, remnaUpdateUser, isRemnaConfigured } from "../remna/remna.client.js";

export type ApplyExtraOptionResult =
  | { ok: true; outcome: "APPLIED" | "ALREADY_APPLIED" | "QUEUED" }
  | { ok: false; error: string; status: number; phase: "PRE_PENDING" | "PENDING"; retryable: boolean };

export function canRefundExtraOptionFailure(result: { ok: boolean; phase?: string; [key: string]: unknown }): boolean {
  return !result.ok && result.phase === "PRE_PENDING";
}

type ExtraOptionApplicationPlan = {
  state: "PENDING" | "APPLIED";
  subscriptionId: string;
  uuid: string;
  remote: Record<string, unknown>;
  local: Record<string, number>;
};

type ExtraOptionPayload =
  | { kind: "traffic"; trafficBytes: number }
  | { kind: "devices"; deviceCount: number }
  | { kind: "servers"; squadUuid: string; trafficBytes?: number };

function parseMetadataExtraOption(metadata: string | null): ExtraOptionPayload | null {
  if (!metadata?.trim()) return null;
  try {
    const obj = JSON.parse(metadata) as Record<string, unknown>;
    const extra = obj?.extraOption as Record<string, unknown> | undefined;
    if (!extra || typeof extra !== "object") return null;
    const kind = extra.kind as string;
    if (kind === "traffic" && typeof extra.trafficBytes === "number" && extra.trafficBytes > 0) {
      return { kind: "traffic", trafficBytes: extra.trafficBytes };
    }
    if (kind === "devices" && typeof extra.deviceCount === "number" && extra.deviceCount > 0) {
      return { kind: "devices", deviceCount: extra.deviceCount };
    }
    if (kind === "servers" && typeof extra.squadUuid === "string" && extra.squadUuid.length > 0) {
      const trafficBytes = typeof extra.trafficBytes === "number" && extra.trafficBytes > 0 ? extra.trafficBytes : undefined;
      return { kind: "servers", squadUuid: extra.squadUuid, ...(trafficBytes !== undefined && { trafficBytes }) };
    }
  } catch {
    // ignore
  }
  return null;
}

/** Извлечь текущие trafficLimitBytes и hwidDeviceLimit из ответа Remna GET /api/users/{uuid} */
function getRemnaLimits(data: unknown): { trafficLimitBytes: number; hwidDeviceLimit: number | null } {
  if (!data || typeof data !== "object") return { trafficLimitBytes: 0, hwidDeviceLimit: null };
  const resp = (data as Record<string, unknown>).response ?? (data as Record<string, unknown>).data ?? data;
  const r = resp as Record<string, unknown>;
  const traffic = r?.trafficLimitBytes;
  const devices = r?.hwidDeviceLimit;
  return {
    trafficLimitBytes: typeof traffic === "number" ? traffic : 0,
    hwidDeviceLimit: typeof devices === "number" ? devices : (devices != null ? Number(devices) : null),
  };
}

/** Извлечь activeInternalSquads (uuid[]) из ответа Remna */
function getRemnaSquads(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  const resp = (data as Record<string, unknown>).response ?? (data as Record<string, unknown>).data ?? data;
  const ais = (resp as Record<string, unknown>)?.activeInternalSquads;
  if (!Array.isArray(ais)) return [];
  const out: string[] = [];
  for (const s of ais) {
    const u = s && typeof s === "object" && "uuid" in s ? (s as Record<string, unknown>).uuid : s;
    if (typeof u === "string") out.push(u);
  }
  return out;
}

/**
 * Применить опцию по оплате: прочитать Payment.metadata.extraOption,
 * получить клиента и remnawaveUuid, обновить пользователя в Remna (добавить трафик/устройства/сквад).
 */
/**
 * извлечь targetSubscriptionId из metadata платежа.
 * Если задан — extra-option применяется к этой конкретной secondary; иначе — primary клиента.
 * После apply мы также увеличиваем custom_price подписки на стоимость опции (для будущих продлений).
 */
function getTargetSubscriptionId(metadata: string | null): string | null {
  if (!metadata?.trim()) return null;
  try {
    const o = JSON.parse(metadata) as Record<string, unknown>;
    const id = o?.targetSubscriptionId;
    return typeof id === "string" && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

function parseMetadata(metadata: string | null): Record<string, unknown> {
  if (!metadata?.trim()) return {};
  try {
    const parsed = JSON.parse(metadata) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parseApplicationPlan(metadata: Record<string, unknown>): ExtraOptionApplicationPlan | null {
  const value = metadata.extraOptionApplication;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const plan = value as Record<string, unknown>;
  if ((plan.state !== "PENDING" && plan.state !== "APPLIED")
    || typeof plan.subscriptionId !== "string"
    || typeof plan.uuid !== "string"
    || !plan.remote || typeof plan.remote !== "object" || Array.isArray(plan.remote)
    || !plan.local || typeof plan.local !== "object" || Array.isArray(plan.local)) return null;
  const local = plan.local as Record<string, unknown>;
  if (Object.values(local).some((entry) => typeof entry !== "number" || !Number.isFinite(entry))) return null;
  const remote = plan.remote as Record<string, unknown>;
  const allowedRemote = new Set(["trafficLimitBytes", "hwidDeviceLimit", "activeInternalSquads"]);
  const allowedLocal = new Set(["customPrice", "extraDevices", "extraDevicesMonthlyPrice"]);
  if (Object.keys(remote).some((key) => !allowedRemote.has(key))
    || Object.keys(local).some((key) => !allowedLocal.has(key))
    || Object.entries(remote).some(([key, entry]) => key === "activeInternalSquads"
      ? !Array.isArray(entry) || entry.some((uuid) => typeof uuid !== "string")
      : typeof entry !== "number" || !Number.isFinite(entry))) return null;
  return {
    state: plan.state,
    subscriptionId: plan.subscriptionId,
    uuid: plan.uuid,
    remote,
    local: local as Record<string, number>,
  };
}

export function extraOptionApplicationState(metadata: string | null): "PENDING" | "APPLIED" | null {
  return parseApplicationPlan(parseMetadata(metadata))?.state ?? null;
}

export async function applyExtraOptionByPaymentId(paymentId: string): Promise<ApplyExtraOptionResult> {
  const pre = (error: string, status: number): ApplyExtraOptionResult => ({ ok: false, error, status, phase: "PRE_PENDING", retryable: true });
  const pendingFailure = (error: string, status: number, retryable = true): ApplyExtraOptionResult => ({ ok: false, error, status, phase: "PENDING", retryable });
  const quarantine = async (expectedState: "PENDING" | "APPLYING", expectedToken: string | null, reason: string) => {
    const boundedReason = reason.slice(0, 500);
    return prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT "id" FROM "payments" WHERE "id" = $1 FOR UPDATE', paymentId);
      const current = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!current || current.extraOptionState !== expectedState || current.extraOptionClaimToken !== expectedToken) return false;
      const quarantinedMetadata = JSON.stringify({
        ...parseMetadata(current.metadata),
        extraOptionApplicationError: { reason: boundedReason, at: new Date().toISOString() },
      });
      const result = await tx.payment.updateMany({
        where: { id: paymentId, extraOptionState: expectedState, extraOptionClaimToken: expectedToken },
        data: { metadata: quarantinedMetadata, extraOptionState: "MANUAL_REVIEW", extraOptionClaimToken: null, extraOptionNextAttemptAt: null },
      });
      return result.count > 0;
    });
  };
  if (!isRemnaConfigured()) return pre("Remna API не настроен", 503);

  let payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) return pre("Платёж не найден", 404);
  if (payment.extraOptionState === "APPLIED") return { ok: true, outcome: "ALREADY_APPLIED" };
  if (payment.extraOptionState === "MANUAL_REVIEW") return pendingFailure("Платёж ожидает ручной проверки", 409, false);
  if (payment.extraOptionState === "APPLYING") {
    if (payment.extraOptionNextAttemptAt && payment.extraOptionNextAttemptAt > new Date()) return { ok: true, outcome: "QUEUED" };
    if (!await quarantine("APPLYING", payment.extraOptionClaimToken, "stale APPLYING has an unknown Remnawave PATCH outcome")) {
      return { ok: true, outcome: "QUEUED" };
    }
    return pendingFailure("Неизвестен результат применения опции; требуется ручная проверка", 409, false);
  }
  if (!payment.extraOptionState || payment.extraOptionState === "FAILED_SAFE") {
    return pre("Платёж не поставлен в очередь применения опции", 409);
  }
  let metadata = parseMetadata(payment.metadata);
  let plan = parseApplicationPlan(metadata);
  if (payment.extraOptionState !== "PENDING") {
    if (!parseMetadataExtraOption(payment.metadata) || !payment.subscriptionId) return pre("Некорректный платёж опции", 400);
    const locatedTarget = await prisma.subscription.findFirst({ where: { id: payment.subscriptionId }, select: { id: true } });
    if (!locatedTarget) return pre("Подписка для опции не найдена", 404);
    const now = new Date();
    const claimToken = randomUUID();
    const claimed = await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT "id" FROM "payments" WHERE "id" = $1 FOR UPDATE', paymentId);
      const fresh = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!fresh || fresh.extraOptionState === "APPLIED") return "APPLIED" as const;
      if (fresh.extraOptionState === "MANUAL_REVIEW") return "QUEUED" as const;
      if (fresh.extraOptionState === "PLANNING" && fresh.extraOptionNextAttemptAt && fresh.extraOptionNextAttemptAt > now) return "QUEUED" as const;
      if (!fresh.subscriptionId) return "INVALID" as const;
      await tx.$queryRawUnsafe('SELECT "id" FROM "subscriptions" WHERE "id" = $1 FOR UPDATE', fresh.subscriptionId);
      const subscription = await tx.subscription.findFirst({
        where: { id: fresh.subscriptionId, deletionRequestedAt: null },
        select: {
          id: true, remnawaveUuid: true, ownerId: true, giftedToClientId: true,
          customPrice: true, extraDevices: true, extraDevicesMonthlyPrice: true,
        },
      });
      const option = parseMetadataExtraOption(fresh.metadata);
      if (!subscription || !subscription.remnawaveUuid || !option
        || (subscription.ownerId !== fresh.clientId && subscription.giftedToClientId !== fresh.clientId)) return "INVALID" as const;
      const active = await tx.payment.findFirst({
        where: { subscriptionId: fresh.subscriptionId, extraOptionState: { in: ["PLANNING", "PENDING", "APPLYING", "MANUAL_REVIEW"] }, id: { not: paymentId } },
        select: { id: true },
      });
      if (active) return "QUEUED" as const;
      await tx.payment.update({
        where: { id: paymentId },
        data: { extraOptionState: "PLANNING", extraOptionClaimToken: claimToken, extraOptionNextAttemptAt: new Date(now.getTime() + 30_000) },
      });
      return { kind: "CLAIMED" as const, payment: fresh, subscription, option, uuid: subscription.remnawaveUuid, metadata: parseMetadata(fresh.metadata) };
    });
    if (claimed === "APPLIED") return { ok: true, outcome: "ALREADY_APPLIED" };
    if (claimed === "QUEUED") return { ok: true, outcome: "QUEUED" };
    if (claimed === "INVALID") return pre("Некорректная привязка платежа опции", 409);

    const userRes = await remnaGetUser(claimed.uuid);
    if (userRes.error) {
      await prisma.payment.updateMany({
        where: { id: paymentId, extraOptionState: "PLANNING", extraOptionClaimToken: claimToken },
        data: { extraOptionState: "NEEDS_PLAN", extraOptionClaimToken: null, extraOptionNextAttemptAt: new Date(Date.now() + 60_000) },
      });
      return pre(userRes.error, userRes.status >= 400 ? userRes.status : 500);
    }
    const limits = getRemnaLimits(userRes.data);
    const local: Record<string, number> = {};
    let remote: Record<string, unknown>;
    if (claimed.option.kind === "traffic") {
      remote = { trafficLimitBytes: limits.trafficLimitBytes + claimed.option.trafficBytes };
      local.customPrice = (claimed.subscription.customPrice ?? 0) + Math.max(0, claimed.payment.amount);
    } else if (claimed.option.kind === "devices") {
      const extraMeta = claimed.metadata.extraOption as Record<string, unknown>;
      const monthly = typeof extraMeta.productPriceMonthly === "number" && extraMeta.productPriceMonthly > 0 ? extraMeta.productPriceMonthly : Math.max(0, claimed.payment.amount);
      remote = { hwidDeviceLimit: (limits.hwidDeviceLimit ?? 0) + claimed.option.deviceCount };
      local.extraDevices = claimed.subscription.extraDevices + claimed.option.deviceCount;
      local.extraDevicesMonthlyPrice = claimed.subscription.extraDevicesMonthlyPrice + monthly;
    } else {
      const squads = getRemnaSquads(userRes.data);
      remote = {
        activeInternalSquads: squads.includes(claimed.option.squadUuid) ? squads : [...squads, claimed.option.squadUuid],
        ...(claimed.option.trafficBytes ? { trafficLimitBytes: limits.trafficLimitBytes + claimed.option.trafficBytes } : {}),
      };
      local.customPrice = (claimed.subscription.customPrice ?? 0) + Math.max(0, claimed.payment.amount);
    }
    plan = { state: "PENDING", subscriptionId: claimed.subscription.id, uuid: claimed.uuid, remote, local };
    const pendingMetadata = JSON.stringify({ ...claimed.metadata, extraOptionApplication: plan });
    const persisted = await prisma.payment.updateMany({
      where: { id: paymentId, extraOptionState: "PLANNING", extraOptionClaimToken: claimToken },
      data: { metadata: pendingMetadata, extraOptionState: "PENDING", extraOptionClaimToken: null, extraOptionNextAttemptAt: new Date() },
    });
    if (!persisted.count) return { ok: true, outcome: "QUEUED" };
    metadata = parseMetadata(pendingMetadata);
  }

  const pendingClaimToken = randomUUID();
  const leaseNow = new Date();
  const leased = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT "id" FROM "payments" WHERE "id" = $1 FOR UPDATE', paymentId);
    const fresh = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!fresh || fresh.extraOptionState === "APPLIED") return "APPLIED" as const;
    if (fresh.extraOptionState !== "PENDING") return "QUEUED" as const;
    if (fresh.extraOptionNextAttemptAt && fresh.extraOptionNextAttemptAt > leaseNow) return "QUEUED" as const;
    const won = await tx.payment.updateMany({
      where: { id: paymentId, extraOptionState: "PENDING", extraOptionClaimToken: fresh.extraOptionClaimToken },
      data: { extraOptionClaimToken: pendingClaimToken, extraOptionNextAttemptAt: new Date(leaseNow.getTime() + 30_000) },
    });
    return won.count ? "LEASED" as const : "QUEUED" as const;
  });
  if (leased === "APPLIED") return { ok: true, outcome: "ALREADY_APPLIED" };
  if (leased === "QUEUED") return { ok: true, outcome: "QUEUED" };

  payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.extraOptionState !== "PENDING" || payment.extraOptionClaimToken !== pendingClaimToken) {
    return { ok: true, outcome: "QUEUED" };
  }
  metadata = parseMetadata(payment.metadata);
  plan = parseApplicationPlan(metadata);
  if (!plan || plan.state !== "PENDING") {
    if (!await quarantine("PENDING", pendingClaimToken, "corrupt persisted plan")) return { ok: true, outcome: "QUEUED" };
    return pendingFailure("Сохранённый план опции повреждён; требуется ручная проверка", 409, false);
  }
  const liveSubscription = await prisma.subscription.findFirst({
    where: { id: payment.subscriptionId ?? "", deletionRequestedAt: null },
    select: { id: true, remnawaveUuid: true, ownerId: true, giftedToClientId: true, graceUntil: true },
  });
  if (!payment.subscriptionId || plan.subscriptionId !== payment.subscriptionId
    || !liveSubscription || plan.uuid !== liveSubscription.remnawaveUuid
    || (liveSubscription.ownerId !== payment.clientId && liveSubscription.giftedToClientId !== payment.clientId)) {
    if (!await quarantine("PENDING", pendingClaimToken, "persisted plan binding mismatch")) return { ok: true, outcome: "QUEUED" };
    return pendingFailure("Привязка сохранённого плана изменилась; требуется ручная проверка", 409, false);
  }

  // Активный Lazeika-Only grace: опция не должна перезаписывать grace-сквады/лимиты.
  // Контролируемый конфликт с ретраем — применится после восстановления тарифа (§4.4).
  const { isActiveSubscriptionGrace } = await import("../subscription/single-subscription-lifecycle.service.js");
  if (isActiveSubscriptionGrace(liveSubscription.graceUntil ?? null)) {
    return pendingFailure("Подписка в режиме продления Lazeika-Only: применение опции отложено до восстановления тарифа", 409);
  }

  const applying = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT "id" FROM "payments" WHERE "id" = $1 FOR UPDATE', paymentId);
    const transitioned = await tx.payment.updateMany({
      where: { id: paymentId, extraOptionState: "PENDING", extraOptionClaimToken: pendingClaimToken },
      data: { extraOptionState: "APPLYING", extraOptionNextAttemptAt: new Date(Date.now() + 30_000) },
    });
    return transitioned.count > 0;
  });
  if (!applying) return { ok: true, outcome: "QUEUED" };

  const update = await remnaUpdateUser({ uuid: plan.uuid, ...plan.remote });
  if (update.error) {
    const definitelyNotMutated = [400, 401, 403, 404, 409, 422].includes(update.status);
    if (definitelyNotMutated) {
      const released = await prisma.payment.updateMany({
        where: { id: paymentId, extraOptionState: "APPLYING", extraOptionClaimToken: pendingClaimToken },
        data: { extraOptionState: "PENDING", extraOptionClaimToken: null, extraOptionNextAttemptAt: new Date(Date.now() + 60_000) },
      });
      if (!released.count) return { ok: true, outcome: "QUEUED" };
    } else if (!await quarantine("APPLYING", pendingClaimToken, `unknown Remnawave PATCH outcome (${update.status}): ${update.error}`)) {
      return { ok: true, outcome: "QUEUED" };
    }
    return pendingFailure(update.error, update.status >= 400 ? update.status : 502);
  }
  const appliedMetadata = JSON.stringify({ ...metadata, extraOptionApplication: { ...plan, state: "APPLIED" } });
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT "id" FROM "subscriptions" WHERE "id" = $1 FOR UPDATE', plan.subscriptionId);
      const current = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!current || current.extraOptionState !== "APPLYING" || current.extraOptionClaimToken !== pendingClaimToken) {
        throw new Error("extra-option lease lost");
      }
      await tx.subscription.update({ where: { id: plan.subscriptionId }, data: plan.local });
      const applied = await tx.payment.updateMany({
        where: { id: paymentId, extraOptionState: "APPLYING", extraOptionClaimToken: pendingClaimToken },
        data: { metadata: appliedMetadata, extraOptionState: "APPLIED", extraOptionClaimToken: null, extraOptionNextAttemptAt: null },
      });
      if (!applied.count) throw new Error("extra-option lease lost");
    });
  } catch (error) {
    await quarantine("APPLYING", pendingClaimToken, `Remnawave PATCH succeeded but local commit failed: ${error instanceof Error ? error.message : String(error)}`).catch(() => {});
    return pendingFailure(error instanceof Error ? error.message : String(error), 500);
  }
  return { ok: true, outcome: "APPLIED" };
}

export async function cancelExtraOptionPaymentBeforePending(paymentId: string, clientId: string, amount: number): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId }, select: { subscriptionId: true } });
    if (!payment?.subscriptionId) return false;
    await tx.$queryRawUnsafe('SELECT "id" FROM "subscriptions" WHERE "id" = $1 FOR UPDATE', payment.subscriptionId);
    const cancelled = await tx.payment.updateMany({
      where: { id: paymentId, extraOptionState: { in: ["NEEDS_PLAN", "PLANNING"] } },
      data: { status: "FAILED", extraOptionState: "FAILED_SAFE", extraOptionClaimToken: null, extraOptionNextAttemptAt: null },
    });
    if (!cancelled.count) return false;
    await tx.client.update({ where: { id: clientId }, data: { balance: { increment: amount } } });
    return true;
  });
}

export async function drainPaidExtraOptionQueue(limit = 50) {
  const payments = await prisma.payment.findMany({
    where: {
      status: "PAID",
      extraOptionState: { in: ["PENDING", "APPLYING", "PLANNING", "NEEDS_PLAN"] },
      OR: [{ extraOptionNextAttemptAt: null }, { extraOptionNextAttemptAt: { lte: new Date() } }],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: Math.max(1, Math.min(200, Math.trunc(limit))),
    select: { id: true, clientId: true },
  });
  let applied = 0;
  let queued = 0;
  let failed = 0;
  for (const payment of payments) {
    const result = await applyExtraOptionByPaymentId(payment.id);
    if (!result.ok) failed++;
    else if (result.outcome === "APPLIED") {
      applied++;
      const { notifyExtraOptionApplied } = await import("../notification/telegram-notify.service.js");
      await notifyExtraOptionApplied(payment.clientId, payment.id).catch(() => {});
    }
    else queued++;
  }
  return { checked: payments.length, applied, queued, failed };
}
