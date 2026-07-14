import { prisma } from "../../db.js";
import {
  extractRemnaUuid,
  remnaCreateUser,
  remnaRevokeUserSubscription,
  remnaUpdateUser,
  remnaUsernameFromClient,
} from "../remna/remna.client.js";
import { generatePublicSubscriptionToken } from "./subscription.helpers.js";

type ComponentOperationTarget = {
  key: string;
  required: boolean;
  mergeOrder: number;
};

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

export async function runSubscriptionComponentOperation(
  subscriptionId: string,
  operation: (target: { key: string; required: boolean; mergeOrder: number; remnawaveUuid: string }) => Promise<void>,
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

  const targets = subscription.components.length
    ? subscription.components.map((component) => ({
        ...component,
        remnawaveUuid: component.remnawaveUuid
          ?? (component.required ? subscription.remnawaveUuid : null),
      }))
    : [{ key: "primary", required: true, mergeOrder: 0, remnawaveUuid: subscription.remnawaveUuid }];
  const available = targets.filter((target): target is typeof target & { remnawaveUuid: string } => Boolean(target.remnawaveUuid));
  if (!available.length) {
    return { failures: [{ key: "subscription", required: true, error: "Подписка не привязана к Remnawave" }], requiredFailure: true };
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

/**
 * Перевыпускает upstream-ссылки всех компонентов одним shortUuid и только после
 * успешного обязательного компонента меняет публичный токен STEALTHNET.
 */
export async function revokeSubscriptionComponents(subscriptionId: string) {
  const upstreamShortUuid = generatePublicSubscriptionToken().slice(0, 32);
  const succeededKeys: string[] = [];
  const result = await runSubscriptionComponentOperation(
    subscriptionId,
    async ({ key, remnawaveUuid }) => {
      const response = await remnaRevokeUserSubscription(remnawaveUuid, { shortUuid: upstreamShortUuid });
      if (response.error) throw new Error(response.error);
      succeededKeys.push(key);
    },
  );
  if (result.requiredFailure) return { ...result, publicSubscriptionToken: null, upstreamShortUuid };

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
    prisma.remnawaveComponent.updateMany({
      where: { subscriptionId, key: { in: succeededKeys } },
      data: { upstreamShortUuid },
    }),
  ]);
  return { ...result, publicSubscriptionToken, upstreamShortUuid };
}

export function buildComponentUsername(base: string, key: string, subscriptionIndex: number): string {
  const safeBase = base.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
  const suffix = `_c_${safeKey}_${subscriptionIndex}`;
  return `${safeBase.slice(0, Math.max(1, 36 - suffix.length))}${suffix}`.slice(0, 36);
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

function templatesForSubscription(subscription: {
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
  const configured = subscription.tariff?.remnawaveComponents.length
    ? subscription.tariff.remnawaveComponents
    : subscription.trial?.remnawaveComponents ?? [];
  const enabled = configured.filter((component) => component.enabled);
  if (enabled.length) {
    return enabled.map((component) => ({
      key: component.key,
      adminName: component.adminName,
      required: component.required,
      mergeOrder: component.mergeOrder,
      internalSquadUuids: component.internalSquadUuids,
      trafficLimitBytes:
        subscription.trial?.trafficLimitBytes != null && component.required
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

  const templates = templatesForSubscription(subscription);
  for (const template of templates) {
    await prisma.remnawaveComponent.upsert({
      where: { subscriptionId_key: { subscriptionId, key: template.key } },
      create: {
        subscriptionId,
        ...template,
        remnawaveUuid: template.required ? subscription.remnawaveUuid : null,
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
        ...(template.required && subscription.remnawaveUuid
          ? { remnawaveUuid: subscription.remnawaveUuid }
          : {}),
      },
    });
  }

  const components = await prisma.remnawaveComponent.findMany({
    where: { subscriptionId, key: { in: templates.map((template) => template.key) } },
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

  const result = await runComponentOperations(components, async (component) => {
    // Legacy system-config Trial does not have a persisted template. Its main user
    // was already configured by the caller, so an empty synthesized squad list
    // must not overwrite it.
    if (component.required && !subscription.tariff && !subscription.trial) return;
    if (!subscription.expireAt) throw new Error("Неизвестен срок действия подписки");

    const payload = {
      expireAt: subscription.expireAt.toISOString(),
      trafficLimitBytes: component.trafficLimitBytes == null ? 0 : Number(component.trafficLimitBytes),
      trafficLimitStrategy: trafficStrategy(component.trafficResetMode),
      hwidDeviceLimit,
      activeInternalSquads: component.internalSquadUuids,
    };

    let remnawaveUuid = component.remnawaveUuid;
    if (remnawaveUuid) {
      const updated = await remnaUpdateUser({ uuid: remnawaveUuid, ...payload, ...identityPayload });
      if (updated.error) throw new Error(updated.error);
    } else {
      const created = await remnaCreateUser({
        username: buildComponentUsername(baseUsername, component.key, subscription.subscriptionIndex),
        ...payload,
        ...identityPayload,
      });
      remnawaveUuid = extractRemnaUuid(created.data);
      if (!remnawaveUuid) throw new Error(created.error || "Remnawave не вернул UUID компонента");
    }

    await prisma.remnawaveComponent.update({
      where: { id: component.id },
      data: {
        remnawaveUuid,
        lastSyncError: null,
        lastSyncedAt: new Date(),
      },
    });
  });

  for (const failure of result.failures) {
    await prisma.remnawaveComponent.updateMany({
      where: { subscriptionId, key: failure.key },
      data: { lastSyncError: failure.error },
    });
  }

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

  return { ok: result.failures.length === 0, ...result };
}
