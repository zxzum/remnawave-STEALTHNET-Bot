import { prisma } from "../../db.js";
import {
  remnaDeleteUser,
  remnaDisableUser,
  remnaEnableUser,
  remnaRevokeUserSubscription,
  remnaUpdateUser,
} from "../remna/remna.client.js";
import { notifySubscriptionRevoked } from "../notification/telegram-notify.service.js";
import { getSystemConfig } from "../client/client.service.js";
import { remnaTrafficSettings } from "../squad-traffic/traffic-remna-policy.js";

type RemnaResult = { data?: unknown; error?: string; status: number };
type RemnaRequest = (uuid: string) => Promise<RemnaResult>;
type RemnaUpdateRequest = (body: Record<string, unknown>) => Promise<RemnaResult>;
type Failure = { key: "subscription"; required: true; error: string };
type ExpiredGraceConfig = {
  expiredGraceEnabled: boolean;
  expiredGraceDays: number;
  expiredGraceSquadUuid: string | null;
};

export type SingleSubscriptionOperationResult = {
  failures: Failure[];
  requiredFailure: boolean;
};

export function isActiveSubscriptionGrace(graceUntil: Date | null, now = new Date()): boolean {
  return graceUntil != null && graceUntil.getTime() > now.getTime();
}

export async function requireSubscriptionRemnaUuid(subscriptionId: string): Promise<string> {
  const row = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    select: { remnawaveUuid: true },
  });
  if (!row?.remnawaveUuid) throw new Error("Подписка не привязана к Remnawave");
  return row.remnawaveUuid;
}

async function recordFailure(subscriptionId: string, error: string) {
  await prisma.subscription.update({
    where: { id: subscriptionId },
    data: {
      syncStatus: "PENDING",
      syncAttempts: { increment: 1 },
      syncError: error,
      syncRequiredAt: new Date(Date.now() + 5 * 60_000),
    },
  });
}

export async function runSingleSubscriptionOperation(
  subscriptionId: string,
  request: RemnaRequest,
): Promise<SingleSubscriptionOperationResult> {
  try {
    const response = await request(await requireSubscriptionRemnaUuid(subscriptionId));
    if (response.error) throw new Error(response.error);
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { syncStatus: "SYNCED", syncAttempts: 0, syncError: null, syncRequiredAt: null },
    });
    return { failures: [], requiredFailure: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordFailure(subscriptionId, message);
    return { failures: [{ key: "subscription", required: true, error: message }], requiredFailure: true };
  }
}

export function enableSingleSubscription(
  subscriptionId: string,
  request: RemnaRequest = remnaEnableUser,
) {
  return runSingleSubscriptionOperation(subscriptionId, request);
}

export function disableSingleSubscription(
  subscriptionId: string,
  request: RemnaRequest = remnaDisableUser,
) {
  return runSingleSubscriptionOperation(subscriptionId, request);
}

export function revokeSingleSubscription(
  subscriptionId: string,
  request: RemnaRequest = remnaRevokeUserSubscription,
) {
  return runSingleSubscriptionOperation(subscriptionId, request);
}

export async function processExpiredSingleSubscriptionAccess(
  limit = 200,
  request: RemnaUpdateRequest = remnaUpdateUser,
  configLoader: () => Promise<ExpiredGraceConfig> = getSystemConfig,
  now = new Date(),
) {
  const config = await configLoader();
  const subscriptions = await prisma.subscription.findMany({
    where: { expireAt: { lte: now }, deletionRequestedAt: null },
    orderBy: { expireAt: "desc" },
    take: Math.max(1, Math.min(1000, Math.trunc(limit))),
    select: {
      id: true,
      remnawaveUuid: true,
      expireAt: true,
      graceUntil: true,
      extraDevices: true,
      tariff: {
        select: {
          trafficLimitBytes: true,
          trafficLimitMode: true,
          trafficResetMode: true,
          includedDevices: true,
          internalSquadUuids: true,
        },
      },
    },
  });
  let grace = 0;
  let disabled = 0;
  let failed = 0;
  for (const subscription of subscriptions) {
    const expireAt = subscription.expireAt;
    if (!expireAt) continue;
    const graceUntil = new Date(
      expireAt.getTime() + Math.max(0, config.expiredGraceDays) * 86_400_000,
    );
    const allowGrace = Boolean(
      config.expiredGraceEnabled
      && config.expiredGraceSquadUuid
      && config.expiredGraceDays > 0
      && now.getTime() < graceUntil.getTime(),
    );
    const desiredGraceUntil = allowGrace ? graceUntil : null;
    if (subscription.graceUntil?.getTime() !== desiredGraceUntil?.getTime()) {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { graceUntil: desiredGraceUntil },
      });
    }
    const result = await runSingleSubscriptionOperation(subscription.id, (uuid) => request({
      uuid,
      expireAt: (allowGrace ? graceUntil : expireAt).toISOString(),
      status: allowGrace ? "ACTIVE" : "DISABLED",
      ...(subscription.tariff ? {
        ...remnaTrafficSettings(subscription.tariff),
        hwidDeviceLimit: Math.max(1, subscription.tariff.includedDevices + subscription.extraDevices),
        activeInternalSquads: allowGrace
          ? [config.expiredGraceSquadUuid]
          : subscription.tariff.internalSquadUuids,
      } : {
        activeInternalSquads: allowGrace ? [config.expiredGraceSquadUuid] : [],
      }),
    }));
    if (result.requiredFailure) failed++;
    else if (allowGrace) grace++;
    else disabled++;
  }
  return { checked: subscriptions.length, grace, disabled, failed };
}

async function completeSubscriptionDeletion(
  subscriptionId: string,
  links: { ownerId: string; subscriptionIndex: number },
) {
  await prisma.$transaction([
    prisma.subscription.delete({
      where: { id: subscriptionId },
    }),
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

function notifyRevoked(subscriptionId: string, links: { ownerId: string; subscriptionIndex: number }) {
  void notifySubscriptionRevoked({
    clientId: links.ownerId,
    subscriptionId,
    subscriptionIndex: links.subscriptionIndex,
  }).catch((error) => console.warn("[subscription revoke] notification failed", error));
}

export async function deleteSingleSubscription(
  subscriptionId: string,
  deletionOperation: "DELETE" | "REVOKE" = "DELETE",
  request: RemnaRequest = remnaDeleteUser,
) {
  const marked = await prisma.subscription.updateMany({
    where: { id: subscriptionId },
    data: {
      deletionRequestedAt: new Date(),
      deletionOperation,
      autoRenewEnabled: false,
      syncStatus: "PENDING",
      syncRequiredAt: new Date(),
    },
  });
  if (!marked.count) return { deleted: true, failures: [] as Failure[], requiredFailure: false };

  const links = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    select: { ownerId: true, subscriptionIndex: true, remnawaveUuid: true },
  });
  if (!links) return { deleted: true, failures: [] as Failure[], requiredFailure: false };
  if (!links.remnawaveUuid) {
    await completeSubscriptionDeletion(subscriptionId, links);
    if (deletionOperation === "REVOKE") notifyRevoked(subscriptionId, links);
    return { deleted: true, failures: [] as Failure[], requiredFailure: false };
  }

  let response: RemnaResult;
  try {
    response = await request(links.remnawaveUuid);
  } catch (error) {
    response = { status: 0, error: error instanceof Error ? error.message : String(error) };
  }
  if (response.error && response.status !== 404) {
    await recordFailure(subscriptionId, response.error);
    const failures: Failure[] = [{ key: "subscription", required: true, error: response.error }];
    return { deleted: false, failures, requiredFailure: true };
  }
  await completeSubscriptionDeletion(subscriptionId, links);
  if (deletionOperation === "REVOKE") notifyRevoked(subscriptionId, links);
  return { deleted: true, failures: [] as Failure[], requiredFailure: false };
}
