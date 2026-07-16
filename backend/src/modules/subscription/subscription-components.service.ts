import { prisma } from "../../db.js";
import {
  extractRemnaUuid,
  isRemnaConfigured,
  remnaCreateUser,
  remnaDeleteUser,
  remnaDisableUser,
  remnaEnableUser,
  remnaGetUser,
  remnaRevokeUserSubscription,
  remnaUpdateUser,
  remnaUsernameFromClient,
} from "../remna/remna.client.js";
import { generatePublicSubscriptionToken } from "./subscription.helpers.js";
import { getSystemConfig } from "../client/client.service.js";
import { notifySubscriptionRevoked } from "../notification/telegram-notify.service.js";

type ComponentOperationTarget = {
  key: string;
  required: boolean;
  mergeOrder: number;
};

export function generateUpstreamShortUuid(): string {
  return generatePublicSubscriptionToken().slice(0, 32);
}

export function subscriptionRemnawaveUuids(subscription: {
  remnawaveUuid?: string | null;
  components?: Array<{ remnawaveUuid: string | null; mergeOrder: number }>;
}): string[] {
  const ordered = [...(subscription.components ?? [])].sort((a, b) => a.mergeOrder - b.mergeOrder);
  const values = [subscription.remnawaveUuid, ...ordered.map((component) => component.remnawaveUuid)];
  return [...new Set(values.filter((uuid): uuid is string => typeof uuid === "string" && uuid.length > 0))];
}

export type MergedHwidDevice = {
  hwid: string;
  platform?: string;
  deviceModel?: string;
  appName?: string;
  createdAt?: string;
};

export function mergeComponentDevices(payloads: unknown[]): MergedHwidDevice[] {
  const devices = new Map<string, MergedHwidDevice>();
  for (const payload of payloads) {
    const response = payload && typeof payload === "object"
      ? (payload as { response?: { devices?: unknown[] } }).response
      : undefined;
    for (const raw of Array.isArray(response?.devices) ? response.devices : []) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      const hwid = typeof item.hwid === "string" ? item.hwid : "";
      if (!hwid) continue;
      const appName = item.appName ?? item.clientName ?? item.userAgent ?? item.app;
      const normalized: MergedHwidDevice = {
        hwid,
        ...(item.platform ? { platform: String(item.platform) } : {}),
        ...(item.deviceModel ? { deviceModel: String(item.deviceModel) } : {}),
        ...(appName ? { appName: String(appName).trim() } : {}),
        ...(item.createdAt ? { createdAt: String(item.createdAt) } : {}),
      };
      devices.set(hwid, { ...(devices.get(hwid) ?? {}), ...normalized });
    }
  }
  return [...devices.values()];
}

function bigintFromUnknown(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.max(0, Math.trunc(value)));
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return 0n;
}

export function extractRemnawaveComponentSnapshot(payload: unknown) {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const inner = ((root.response ?? root.data ?? root) && typeof (root.response ?? root.data ?? root) === "object"
    ? (root.response ?? root.data ?? root)
    : {}) as Record<string, unknown>;
  const squads = Array.isArray(inner.activeInternalSquads) ? inner.activeInternalSquads : [];
  return {
    uuid: typeof inner.uuid === "string" ? inner.uuid : null,
    shortUuid: typeof inner.shortUuid === "string" ? inner.shortUuid : null,
    expireAt: typeof inner.expireAt === "string" ? inner.expireAt : null,
    status: typeof inner.status === "string" ? inner.status : null,
    hwidDeviceLimit: typeof inner.hwidDeviceLimit === "number" ? inner.hwidDeviceLimit : null,
    trafficLimitBytes: bigintFromUnknown(inner.trafficLimitBytes),
    internalSquadUuids: squads.flatMap((item) => {
      if (typeof item === "string") return [item];
      if (item && typeof item === "object" && typeof (item as Record<string, unknown>).uuid === "string") {
        return [(item as Record<string, unknown>).uuid as string];
      }
      return [];
    }),
  };
}

export function componentQuotaFromRemna(
  component: {
    key: string;
    adminName?: string | null;
    quotaDisplayName?: string | null;
    trafficLimitBytes: bigint | null;
    trafficResetMode: string;
  },
  payload: unknown,
  now = new Date(),
) {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const inner = (root.response && typeof root.response === "object" ? root.response : root) as Record<string, unknown>;
  const traffic = (inner.userTraffic && typeof inner.userTraffic === "object" ? inner.userTraffic : {}) as Record<string, unknown>;
  const limit = component.trafficLimitBytes ?? bigintFromUnknown(inner.trafficLimitBytes);
  const used = bigintFromUnknown(traffic.usedTrafficBytes ?? inner.usedTrafficBytes);
  let nextResetAt: string | null = null;
  if (component.trafficResetMode === "monthly") {
    nextResetAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  } else if (component.trafficResetMode === "monthly_rolling") {
    const rawBase = typeof inner.lastTrafficResetAt === "string" ? new Date(inner.lastTrafficResetAt) : now;
    if (!Number.isNaN(rawBase.getTime())) {
      rawBase.setUTCMonth(rawBase.getUTCMonth() + 1);
      nextResetAt = rawBase.toISOString();
    }
  }
  return {
    key: component.key,
    displayName: component.quotaDisplayName?.trim() || component.adminName?.trim() || component.key,
    limitBytes: limit.toString(),
    usedBytes: used.toString(),
    remainingBytes: (limit > used ? limit - used : 0n).toString(),
    resetMode: component.trafficResetMode,
    nextResetAt,
    status: typeof inner.status === "string" ? inner.status : null,
  };
}

export async function runComponentOperations<T extends ComponentOperationTarget>(
  components: T[],
  operation: (component: T) => Promise<void>,
): Promise<{ failures: Array<{ key: string; required: boolean; error: string }>; requiredFailure: boolean }> {
  const outcomes = await Promise.all(
    [...components]
      .sort((a, b) => a.mergeOrder - b.mergeOrder)
      .map(async (component) => {
        try {
          await operation(component);
          return null;
        } catch (error) {
          return {
            key: component.key,
            required: component.required,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
  );
  const failures = outcomes.filter((failure): failure is NonNullable<typeof failure> => failure !== null);
  return { failures, requiredFailure: failures.some((failure) => failure.required) };
}

/**
 * Отзыв — атомарная для логической подписки операция: пока не отозван
 * каждый компонент, запись и public URL остаются tombstone для повторной попытки.
 */
export function isLogicalSubscriptionRevoked(result: {
  failures: Array<{ key: string; required: boolean; error: string }>;
}): boolean {
  return result.failures.length === 0;
}

/** Дополняет шаблон тарифа ручными компонентами, не давая reconciliation их удалить. */
export function mergeSubscriptionComponentTemplates<T extends { key: string; mergeOrder: number }>(
  configured: T[],
  manual: T[],
): T[] {
  const configuredKeys = new Set(configured.map((component) => component.key));
  return [...configured, ...manual.filter((component) => !configuredKeys.has(component.key))]
    .sort((a, b) => a.mergeOrder - b.mergeOrder);
}

export function selectComponentTargets(subscription: {
  remnawaveUuid: string | null;
  components: Array<{
    key: string;
    required: boolean;
    mergeOrder: number;
    remnawaveUuid: string | null;
  }>;
}, componentKey?: string): Array<ComponentOperationTarget & { remnawaveUuid: string }> {
  const targets = subscription.components.length
    ? subscription.components.map((component) => ({
        key: component.key,
        required: component.required,
        mergeOrder: component.mergeOrder,
        remnawaveUuid: component.remnawaveUuid
          ?? (component.required ? subscription.remnawaveUuid : null),
      }))
    : [{ key: "primary", required: true, mergeOrder: 0, remnawaveUuid: subscription.remnawaveUuid }];

  return targets.filter((target): target is ComponentOperationTarget & { remnawaveUuid: string } =>
    Boolean(target.remnawaveUuid) && (!componentKey || target.key === componentKey));
}

export async function runSubscriptionComponentOperation(
  subscriptionId: string,
  operation: (target: { key: string; required: boolean; mergeOrder: number; remnawaveUuid: string }) => Promise<void>,
  componentKey?: string,
) {
  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    select: {
      remnawaveUuid: true,
      components: {
        orderBy: { mergeOrder: "asc" },
        select: { key: true, required: true, mergeOrder: true, remnawaveUuid: true },
      },
    },
  });
  if (!subscription) {
    return { failures: [{ key: "subscription", required: true, error: "Подписка не найдена" }], requiredFailure: true };
  }

  const available = selectComponentTargets(subscription, componentKey);
  if (!available.length) {
    return { failures: [{ key: componentKey ?? "subscription", required: true, error: "Компонент не привязан к Remnawave" }], requiredFailure: true };
  }

  const result = await runComponentOperations(available, operation);
  if (result.failures.length) {
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        syncStatus: "PENDING",
        syncAttempts: { increment: 1 },
        syncError: result.failures.map((failure) => `${failure.key}: ${failure.error}`).join("; "),
        syncRequiredAt: new Date(Date.now() + 5 * 60_000),
      },
    });
  }
  return result;
}

/** Remnawave сам генерирует совместимый shortUuid и возвращает его в обновлённом пользователе. */
export async function revokeRemnawaveComponent(
  remnawaveUuid: string,
  request: typeof remnaRevokeUserSubscription = remnaRevokeUserSubscription,
  getUser: typeof remnaGetUser = remnaGetUser,
): Promise<string | null> {
  const response = await request(remnawaveUuid);
  if (response.error) throw new Error(response.error);
  const revokedShortUuid = extractRemnawaveComponentSnapshot(response.data).shortUuid;
  if (revokedShortUuid) return revokedShortUuid;

  const fresh = await getUser(remnawaveUuid);
  if (fresh.error) return null;
  return extractRemnawaveComponentSnapshot(fresh.data).shortUuid;
}

/** Перевыпускает уникальную upstream-ссылку каждого компонента и общий публичный токен STEALTHNET. */
export async function revokeSubscriptionComponents(subscriptionId: string) {
  const succeededShortUuids = new Map<string, string>();
  const result = await runSubscriptionComponentOperation(
    subscriptionId,
    async ({ key, remnawaveUuid }) => {
      const upstreamShortUuid = await revokeRemnawaveComponent(remnawaveUuid);
      if (upstreamShortUuid) succeededShortUuids.set(key, upstreamShortUuid);
    },
  );
  const upstreamShortUuids = Object.fromEntries(succeededShortUuids);
  if (result.requiredFailure) return { ...result, publicSubscriptionToken: null, upstreamShortUuids };

  const publicSubscriptionToken = generatePublicSubscriptionToken();
  await prisma.$transaction([
    prisma.subscription.update({
      where: { id: subscriptionId },
      data: result.failures.length
        ? { publicSubscriptionToken }
        : {
            publicSubscriptionToken,
            syncStatus: "SYNCED",
            syncAttempts: 0,
            syncError: null,
            syncRequiredAt: null,
          },
    }),
    ...[...succeededShortUuids].map(([key, upstreamShortUuid]) => prisma.remnawaveComponent.updateMany({
      where: { subscriptionId, key },
      data: { upstreamShortUuid },
    })),
  ]);
  return { ...result, publicSubscriptionToken, upstreamShortUuids };
}

async function removeSubscriptionRecord(
  subscriptionId: string,
  links: { ownerId: string; subscriptionIndex: number },
) {
  await prisma.$transaction([
    prisma.subscription.delete({ where: { id: subscriptionId } }),
    ...(links.subscriptionIndex === 0
      ? [prisma.client.update({
          where: { id: links.ownerId },
          data: {
            remnawaveUuid: null,
            currentTariffId: null,
            currentPricePerDay: null,
            customPrimaryPrice: null,
            autoRenewEnabled: false,
            autoRenewTariffId: null,
            autoRenewPriceOptionId: null,
            autoRenewExtraDevices: 0,
            autoRenewRetryCount: 0,
            autoRenewNotifiedAt: null,
            autoRenewPromoCode: null,
            lastArnNotifiedKey: null,
          },
        })]
      : []),
  ]);
}

/**
 * Идемпотентное удаление логической подписки. Tombstone сохраняет UUID
 * компонентов до тех пор, пока каждый upstream user не удалён или не вернул 404.
 */
export async function deleteSubscriptionComponents(subscriptionId: string) {
  const marked = await prisma.subscription.updateMany({
    where: { id: subscriptionId },
    data: {
      deletionRequestedAt: new Date(),
      deletionOperation: "DELETE",
      syncStatus: "PENDING",
      syncRequiredAt: new Date(),
    },
  });
  if (!marked.count) {
    return {
      deleted: true,
      failures: [] as Array<{ key: string; required: boolean; error: string }>,
      requiredFailure: false,
    };
  }
  const links = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    select: {
      ownerId: true,
      subscriptionIndex: true,
      remnawaveUuid: true,
      components: { select: { remnawaveUuid: true, mergeOrder: true } },
    },
  });
  if (links && !subscriptionRemnawaveUuids(links).length) {
    await removeSubscriptionRecord(subscriptionId, links);
    return {
      deleted: true,
      failures: [] as Array<{ key: string; required: boolean; error: string }>,
      requiredFailure: false,
    };
  }
  const result = await runSubscriptionComponentOperation(subscriptionId, async ({ remnawaveUuid }) => {
    const response = await remnaDeleteUser(remnawaveUuid);
    if (response.error && response.status !== 404) throw new Error(response.error);
  });
  if (!result.failures.length) {
    if (links) await removeSubscriptionRecord(subscriptionId, links);
  }
  return { deleted: result.failures.length === 0, ...result };
}

/**
 * Аннулирует одну логическую подписку: для каждого Remnawave-компонента
 * Remnawave-пользователь удаляется, затем удаляется только эта запись Subscription.
 * Другие subscriptionIndex пользователя не затрагиваются.
 */
export async function revokeLogicalSubscription(subscriptionId: string) {
  const marked = await prisma.subscription.updateMany({
    where: { id: subscriptionId },
    data: {
      deletionRequestedAt: new Date(),
      deletionOperation: "REVOKE",
      syncStatus: "PENDING",
      syncRequiredAt: new Date(),
    },
  });
  if (!marked.count) {
    return {
      deleted: true,
      failures: [] as Array<{ key: string; required: boolean; error: string }>,
      requiredFailure: false,
    };
  }

  const links = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    select: {
      ownerId: true,
      subscriptionIndex: true,
      remnawaveUuid: true,
      components: { select: { remnawaveUuid: true, mergeOrder: true } },
    },
  });
  if (links && !subscriptionRemnawaveUuids(links).length) {
    await removeSubscriptionRecord(subscriptionId, links);
    void notifySubscriptionRevoked({ clientId: links.ownerId, subscriptionId, subscriptionIndex: links.subscriptionIndex })
      .catch((error) => console.warn("[subscription revoke] notification failed", error));
    return {
      deleted: true,
      failures: [] as Array<{ key: string; required: boolean; error: string }>,
      requiredFailure: false,
    };
  }

  const result = await runSubscriptionComponentOperation(subscriptionId, async ({ remnawaveUuid }) => {
    const response = await remnaDeleteUser(remnawaveUuid);
    if (response.error && response.status !== 404) throw new Error(response.error);
  });
  if (isLogicalSubscriptionRevoked(result)) {
    if (links) await removeSubscriptionRecord(subscriptionId, links);
    if (links) void notifySubscriptionRevoked({ clientId: links.ownerId, subscriptionId, subscriptionIndex: links.subscriptionIndex })
      .catch((error) => console.warn("[subscription revoke] notification failed", error));
  }
  return { deleted: isLogicalSubscriptionRevoked(result), ...result };
}

export function buildComponentUsername(base: string, key: string, subscriptionIndex: number): string {
  const safeBase = base.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
  const suffix = `_c_${safeKey}_${subscriptionIndex}`;
  return `${safeBase.slice(0, Math.max(1, 36 - suffix.length))}${suffix}`.slice(0, 36);
}

/** Наш универсальный suffix и legacy `_WL` нужны только на границе импорта. */
export function isManagedComponentUsername(username: string | null | undefined): boolean {
  return typeof username === "string" && (/_c_[a-zA-Z0-9_-]+_\d+$/.test(username) || /_WL$/i.test(username));
}

export function computeExpiredGraceWindow(expireAt: Date, days: number, now = new Date()) {
  const graceUntil = new Date(expireAt.getTime() + Math.max(0, days) * 86_400_000);
  return { graceUntil, active: days > 0 && now.getTime() < graceUntil.getTime() };
}

export function expiredGraceComponentPolicy(required: boolean, squadUuid: string) {
  return {
    activeInternalSquads: required ? [squadUuid] : [],
    enabled: required,
  };
}

type ComponentTemplate = {
  key: string;
  adminName: string;
  required: boolean;
  mergeOrder: number;
  internalSquadUuids: string[];
  trafficLimitBytes: bigint | null;
  trafficResetMode: string;
  showQuotaToClient: boolean;
  quotaDisplayName: string | null;
};

function parseLegacySquads(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function trafficStrategy(mode: string): "NO_RESET" | "MONTH" | "MONTH_ROLLING" {
  if (mode === "monthly") return "MONTH";
  if (mode === "monthly_rolling") return "MONTH_ROLLING";
  return "NO_RESET";
}

export function templatesForSubscription(subscription: {
  tariff: null | {
    internalSquadUuids: string[];
    trafficLimitBytes: bigint | null;
    trafficResetMode: string;
    remnawaveComponents: Array<ComponentTemplate & { enabled: boolean }>;
  };
  trial: null | {
    squadUuids: string | null;
    trafficLimitBytes: bigint | null;
    remnawaveComponents: Array<ComponentTemplate & { enabled: boolean }>;
  };
}): ComponentTemplate[] {
  const trialComponents = subscription.trial?.remnawaveComponents ?? [];
  const configured = trialComponents.length
    ? trialComponents
    : subscription.tariff?.remnawaveComponents ?? [];
  const enabled = configured.filter((component) => component.enabled);
  if (enabled.some((component) => component.required)) {
    return enabled.map((component) => ({
      key: component.key,
      adminName: component.adminName,
      required: component.required,
      mergeOrder: component.mergeOrder,
      internalSquadUuids: component.internalSquadUuids,
      trafficLimitBytes:
        trialComponents.length === 0 && subscription.trial?.trafficLimitBytes != null && component.required
          ? subscription.trial.trafficLimitBytes
          : component.trafficLimitBytes,
      trafficResetMode: component.trafficResetMode,
      showQuotaToClient: component.showQuotaToClient,
      quotaDisplayName: component.quotaDisplayName,
    }));
  }

  return [{
    key: "primary",
    adminName: "Основной",
    required: true,
    mergeOrder: 0,
    internalSquadUuids:
      subscription.tariff?.internalSquadUuids ?? parseLegacySquads(subscription.trial?.squadUuids),
    trafficLimitBytes:
      subscription.trial?.trafficLimitBytes ?? subscription.tariff?.trafficLimitBytes ?? null,
    trafficResetMode: subscription.tariff?.trafficResetMode ?? "no_reset",
    showQuotaToClient: false,
    quotaDisplayName: null,
  }];
}

export async function synchronizeSubscriptionComponents(subscriptionId: string): Promise<{
  ok: boolean;
  requiredFailure: boolean;
  failures: Array<{ key: string; required: boolean; error: string }>;
}> {
  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: {
      owner: true,
      components: { orderBy: { mergeOrder: "asc" } },
      tariff: { include: { remnawaveComponents: { orderBy: { mergeOrder: "asc" } } } },
      trial: { include: { remnawaveComponents: { orderBy: { mergeOrder: "asc" } } } },
    },
  });
  if (!subscription) {
    return {
      ok: false,
      requiredFailure: true,
      failures: [{ key: "subscription", required: true, error: "Подписка не найдена" }],
    };
  }
  if (subscription.deletionRequestedAt) {
    return {
      ok: false,
      requiredFailure: true,
      failures: [{ key: "subscription", required: true, error: "Подписка ожидает удаления" }],
    };
  }

  const now = new Date();
  const systemConfig = await getSystemConfig();
  const graceSquadUuid = systemConfig.expiredGraceSquadUuid;
  const graceActive = Boolean(
    systemConfig.expiredGraceEnabled
    && graceSquadUuid
    && subscription.graceUntil
    && subscription.graceUntil.getTime() > now.getTime()
    && subscription.expireAt
    && subscription.expireAt.getTime() <= now.getTime(),
  );
  if (subscription.expireAt && subscription.expireAt.getTime() > now.getTime() && subscription.graceUntil) {
    await prisma.subscription.update({ where: { id: subscriptionId }, data: { graceUntil: null } });
  }

  const configuredTemplates = templatesForSubscription(subscription);
  const manualTemplates = subscription.components
    .filter((component) => component.managedManually)
    .map((component) => ({
      key: component.key,
      adminName: component.adminName,
      required: component.required,
      mergeOrder: component.mergeOrder,
      internalSquadUuids: component.internalSquadUuids,
      trafficLimitBytes: component.trafficLimitBytes,
      trafficResetMode: component.trafficResetMode,
      showQuotaToClient: component.showQuotaToClient,
      quotaDisplayName: component.quotaDisplayName,
    }));
  const templates = mergeSubscriptionComponentTemplates(configuredTemplates, manualTemplates);
  const templateKeys = templates.map((template) => template.key);
  const subscriptionUuidIsFree = Boolean(
    subscription.remnawaveUuid
    && !subscription.components.some((component) => component.remnawaveUuid === subscription.remnawaveUuid),
  );
  for (const template of templates) {
    await prisma.remnawaveComponent.upsert({
      where: { subscriptionId_key: { subscriptionId, key: template.key } },
      create: {
        subscriptionId,
        ...template,
        remnawaveUuid: template.required && subscriptionUuidIsFree ? subscription.remnawaveUuid : null,
      },
      update: {
        adminName: template.adminName,
        required: template.required,
        mergeOrder: template.mergeOrder,
        internalSquadUuids: template.internalSquadUuids,
        trafficLimitBytes: template.trafficLimitBytes,
        trafficResetMode: template.trafficResetMode,
        showQuotaToClient: template.showQuotaToClient,
        quotaDisplayName: template.quotaDisplayName,
        ...(template.required && subscriptionUuidIsFree && subscription.remnawaveUuid
          ? { remnawaveUuid: subscription.remnawaveUuid }
          : {}),
      },
    });
  }

  const components = await prisma.remnawaveComponent.findMany({
    where: { subscriptionId, key: { in: templateKeys } },
    orderBy: { mergeOrder: "asc" },
  });
  const obsoleteComponents = await prisma.remnawaveComponent.findMany({
    where: { subscriptionId, key: { notIn: templateKeys } },
    orderBy: { mergeOrder: "asc" },
  });
  const baseUsername = remnaUsernameFromClient({
    telegramUsername: subscription.owner.telegramUsername,
    telegramId: subscription.owner.telegramId,
    email: subscription.owner.email,
    clientIdFallback: subscription.ownerId,
  });
  const hwidDeviceLimit = subscription.tariff
    ? Math.max(1, subscription.tariff.includedDevices + subscription.extraDevices)
    : subscription.trial?.deviceLimit ?? undefined;
  const identityPayload = !subscription.purchasedAsGift
    ? {
        ...(subscription.owner.telegramId?.trim()
          ? { telegramId: Number(subscription.owner.telegramId) }
          : {}),
        ...(subscription.owner.email?.trim() ? { email: subscription.owner.email.trim() } : {}),
      }
    : {};

  const upstreamState = new Map<string, { status: number; error?: string; snapshot: ReturnType<typeof extractRemnawaveComponentSnapshot> }>();
  await Promise.all(components.map(async (component) => {
    if (!component.remnawaveUuid) return;
    const response = await remnaGetUser(component.remnawaveUuid);
    upstreamState.set(component.id, {
      status: response.status,
      ...(response.error ? { error: response.error } : {}),
      snapshot: extractRemnawaveComponentSnapshot(response.data),
    });
  }));
  const result = await runComponentOperations(components, async (component) => {
    // Legacy system-config Trial does not have a persisted template. Its main user
    // was already configured by the caller, so an empty synthesized squad list
    // must not overwrite it.
    if (component.required && !subscription.tariff && !subscription.trial) return;
    if (!subscription.expireAt) throw new Error("Неизвестен срок действия подписки");

    const gracePolicy = graceActive && graceSquadUuid
      ? expiredGraceComponentPolicy(component.required, graceSquadUuid)
      : null;
    const payload = {
      expireAt: (graceActive && subscription.graceUntil ? subscription.graceUntil : subscription.expireAt).toISOString(),
      trafficLimitBytes: component.trafficLimitBytes == null ? 0 : Number(component.trafficLimitBytes),
      trafficLimitStrategy: trafficStrategy(component.trafficResetMode),
      hwidDeviceLimit,
      activeInternalSquads: gracePolicy?.activeInternalSquads ?? component.internalSquadUuids,
    };

    let remnawaveUuid = component.remnawaveUuid;
    const previousState = upstreamState.get(component.id);
    let upstreamShortUuid = previousState?.snapshot.shortUuid
      ?? component.upstreamShortUuid
      ?? generateUpstreamShortUuid();
    let lastKnownStatus = previousState?.snapshot.status ?? null;
    if (remnawaveUuid && previousState?.status !== 404) {
      const updated = await remnaUpdateUser({ uuid: remnawaveUuid, ...payload, ...identityPayload });
      if (updated.error && updated.status !== 404) throw new Error(updated.error);
      if (updated.status === 404) remnawaveUuid = null;
    }
    if (!remnawaveUuid) {
      const created = await remnaCreateUser({
        username: buildComponentUsername(baseUsername, component.key, subscription.subscriptionIndex),
        ...payload,
        ...identityPayload,
        shortUuid: upstreamShortUuid,
      });
      remnawaveUuid = extractRemnaUuid(created.data);
      if (!remnawaveUuid) throw new Error(created.error || "Remnawave не вернул UUID компонента");
      lastKnownStatus = extractRemnawaveComponentSnapshot(created.data).status;
    }

    if (
      previousState
      && previousState.snapshot.shortUuid !== upstreamShortUuid
    ) {
      upstreamShortUuid = await revokeRemnawaveComponent(remnawaveUuid) ?? upstreamShortUuid;
    }
    if (
      subscription.owner.isBlocked
      || (subscription.expireAt.getTime() <= now.getTime() && !graceActive)
      || gracePolicy?.enabled === false
    ) {
      const disabled = await remnaDisableUser(remnawaveUuid);
      if (disabled.error) throw new Error(disabled.error);
      lastKnownStatus = "DISABLED";
    } else if (gracePolicy?.enabled) {
      const enabled = await remnaEnableUser(remnawaveUuid);
      if (enabled.error) throw new Error(enabled.error);
      lastKnownStatus = "ACTIVE";
    }

    await prisma.remnawaveComponent.update({
      where: { id: component.id },
      data: {
        remnawaveUuid,
        upstreamShortUuid,
        lastKnownStatus,
        lastSyncError: null,
        lastSyncedAt: new Date(),
      },
    });
    if (component.required && remnawaveUuid !== subscription.remnawaveUuid) {
      await prisma.subscription.update({ where: { id: subscriptionId }, data: { remnawaveUuid } });
      if (subscription.subscriptionIndex === 0) {
        await prisma.client.update({ where: { id: subscription.ownerId }, data: { remnawaveUuid } });
      }
    }
  });

  const cleanupResult = result.requiredFailure
    ? { failures: [] as Array<{ key: string; required: boolean; error: string }>, requiredFailure: false }
    : await runComponentOperations(obsoleteComponents, async (component) => {
        await prisma.remnawaveComponent.update({
          where: { id: component.id },
          data: { lastKnownStatus: "REMOVING" },
        });
        if (component.remnawaveUuid) {
          const disabled = await remnaDisableUser(component.remnawaveUuid);
          if (disabled.error && disabled.status !== 404) throw new Error(disabled.error);
        }
        await prisma.remnawaveComponent.delete({ where: { id: component.id } });
      });
  const failures = [...result.failures, ...cleanupResult.failures];
  const requiredFailure = result.requiredFailure || cleanupResult.requiredFailure;

  for (const failure of failures) {
    await prisma.remnawaveComponent.updateMany({
      where: { subscriptionId, key: failure.key },
      data: { lastSyncError: failure.error },
    });
  }

  if (failures.length) {
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        syncStatus: "PENDING",
        syncAttempts: { increment: 1 },
        syncError: failures.map((failure) => `${failure.key}: ${failure.error}`).join("; "),
        syncRequiredAt: new Date(Date.now() + 5 * 60_000),
      },
    });
  } else {
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        syncStatus: "SYNCED",
        syncAttempts: 0,
        syncError: null,
        syncRequiredAt: null,
        lastReconciledAt: new Date(),
      },
    });
  }

  return { ok: failures.length === 0, requiredFailure, failures };
}

export async function reconcileSubscriptionComponents(limit = 50) {
  if (!isRemnaConfigured()) return { checked: 0, synced: 0, degraded: 0, failed: 0 };
  const now = new Date();
  const staleBefore = new Date(now.getTime() - 6 * 60 * 60_000);
  const subscriptions = await prisma.subscription.findMany({
    where: {
      OR: [
        { deletionRequestedAt: { not: null } },
        { syncStatus: { not: "SYNCED" }, OR: [{ syncRequiredAt: null }, { syncRequiredAt: { lte: now } }] },
        { lastReconciledAt: null },
        { lastReconciledAt: { lte: staleBefore } },
      ],
    },
    orderBy: [{ syncRequiredAt: "asc" }, { lastReconciledAt: "asc" }],
    take: Math.max(1, Math.min(500, Math.trunc(limit))),
    select: { id: true, deletionRequestedAt: true, deletionOperation: true },
  });

  let synced = 0;
  let degraded = 0;
  let failed = 0;
  for (const subscription of subscriptions) {
    const result = await (subscription.deletionRequestedAt
      ? subscription.deletionOperation === "REVOKE"
        ? revokeLogicalSubscription(subscription.id)
        : deleteSubscriptionComponents(subscription.id)
      : synchronizeSubscriptionComponents(subscription.id)).catch((error) => ({
      ok: false,
      deleted: false,
      requiredFailure: true,
      failures: [{ key: "subscription", required: true, error: error instanceof Error ? error.message : String(error) }],
    }));
    if (("deleted" in result && result.deleted) || ("ok" in result && result.ok)) synced++;
    else if (result.requiredFailure) failed++;
    else degraded++;
  }
  return { checked: subscriptions.length, synced, degraded, failed };
}

export async function processExpiredSubscriptionAccess(limit = 200) {
  if (!isRemnaConfigured()) return { checked: 0, grace: 0, disabled: 0, failed: 0 };
  const config = await getSystemConfig();
  const now = new Date();
  const subscriptions = await prisma.subscription.findMany({
    where: { expireAt: { lte: now }, deletionRequestedAt: null },
    orderBy: { expireAt: "desc" },
    take: Math.max(1, Math.min(1000, Math.trunc(limit))),
    select: { id: true, expireAt: true, graceUntil: true },
  });
  let grace = 0;
  let disabled = 0;
  let failed = 0;
  for (const subscription of subscriptions) {
    if (!subscription.expireAt) continue;
    const window = computeExpiredGraceWindow(subscription.expireAt, config.expiredGraceDays, now);
    const allowGrace = Boolean(config.expiredGraceEnabled && config.expiredGraceSquadUuid && window.active);
    const desiredGraceUntil = allowGrace ? window.graceUntil : null;
    if (subscription.graceUntil?.getTime() !== desiredGraceUntil?.getTime()) {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { graceUntil: desiredGraceUntil },
      });
    }
    const result = await synchronizeSubscriptionComponents(subscription.id);
    if (result.requiredFailure) failed++;
    else if (allowGrace) grace++;
    else disabled++;
  }
  return { checked: subscriptions.length, grace, disabled, failed };
}
