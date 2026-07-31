import { prisma } from "../../db.js";
import { remnaGetUser, remnaUpdateUser } from "../remna/remna.client.js";

export type TrafficEnforcementDependencies = {
  prisma: {
    squadTrafficQuota: { findUnique: (args: any) => Promise<any> };
    trafficQuotaEvent: { create: (args: any) => Promise<unknown> };
  };
  getRemnaUser: typeof remnaGetUser;
  updateRemnaUser: typeof remnaUpdateUser;
};

const defaultDependencies: TrafficEnforcementDependencies = {
  prisma,
  getRemnaUser: remnaGetUser,
  updateRemnaUser: remnaUpdateUser,
};

function currentSquadUuids(data: unknown): string[] | null {
  if (!data || typeof data !== "object") return null;
  const root = data as { response?: unknown; data?: unknown; activeInternalSquads?: unknown };
  const response = root.response && typeof root.response === "object" ? root.response as Record<string, unknown>
    : root.data && typeof root.data === "object" ? root.data as Record<string, unknown>
      : root;
  const raw = response.activeInternalSquads;
  if (!Array.isArray(raw)) return null;
  return raw.flatMap((squad) => {
    if (typeof squad === "string") return [squad];
    if (squad && typeof squad === "object" && typeof (squad as { uuid?: unknown }).uuid === "string") {
      return [(squad as { uuid: string }).uuid];
    }
    return [];
  });
}

async function writeRetryableEvent(dependencies: TrafficEnforcementDependencies, quota: any, action: string, error: string) {
  await dependencies.prisma.trafficQuotaEvent.create({
    data: {
      quotaId: quota.id,
      kind: "ENFORCEMENT_RETRYABLE",
      usedBytes: quota.usedBytes,
      limitBytes: quota.baseLimitBytes,
      detail: { action, error },
    },
  });
}

async function changeMeteredSquad(
  subscriptionId: string,
  action: "REMOVE_METERED_SQUAD" | "RESTORE_METERED_SQUAD",
  dependencies: TrafficEnforcementDependencies,
): Promise<{ ok: boolean; changed: boolean; error?: string }> {
  const quota = await dependencies.prisma.squadTrafficQuota.findUnique({
    where: { subscriptionId },
    include: { subscription: { select: { remnawaveUuid: true } } },
  });
  if (!quota) return { ok: true, changed: false };
  if (action === "REMOVE_METERED_SQUAD" && quota.status !== "EXHAUSTED") return { ok: true, changed: false };
  const remnawaveUuid = quota.subscription?.remnawaveUuid;
  if (!remnawaveUuid) {
    const error = "Subscription has no owning Remnawave user";
    await writeRetryableEvent(dependencies, quota, action, error);
    return { ok: false, changed: false, error };
  }

  const userResult = await dependencies.getRemnaUser(remnawaveUuid);
  if (userResult.error || !userResult.data) {
    const error = userResult.error ?? "Malformed Remnawave user response";
    await writeRetryableEvent(dependencies, quota, action, error);
    return { ok: false, changed: false, error };
  }
  const current = currentSquadUuids(userResult.data);
  if (!current) {
    const error = "Malformed Remnawave active squads";
    await writeRetryableEvent(dependencies, quota, action, error);
    return { ok: false, changed: false, error };
  }

  const target = action === "REMOVE_METERED_SQUAD"
    ? current.filter((uuid) => uuid !== quota.meteredSquadUuid)
    : [...new Set([...current, quota.meteredSquadUuid])];
  if (target.length === current.length && target.every((uuid, index) => uuid === current[index])) {
    return { ok: true, changed: false };
  }

  const updateResult = await dependencies.updateRemnaUser({
    uuid: remnawaveUuid,
    activeInternalSquads: target,
  });
  if (updateResult.error) {
    await writeRetryableEvent(dependencies, quota, action, updateResult.error);
    return { ok: false, changed: false, error: updateResult.error };
  }
  return { ok: true, changed: true };
}

/** Removes only the exhausted subscription's metered squad from its owning user. */
export function enforceExhaustedQuota(
  subscriptionId: string,
  dependencies: TrafficEnforcementDependencies = defaultDependencies,
) {
  return changeMeteredSquad(subscriptionId, "REMOVE_METERED_SQUAD", dependencies);
}

/** Restores only the metered squad, preserving every currently assigned squad. */
export function restoreMeteredSquad(
  subscriptionId: string,
  dependencies: TrafficEnforcementDependencies = defaultDependencies,
) {
  return changeMeteredSquad(subscriptionId, "RESTORE_METERED_SQUAD", dependencies);
}
