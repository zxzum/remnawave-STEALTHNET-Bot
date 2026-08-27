import { prisma } from "../../db.js";
import { saveCriticalSnapshot } from "../backup/backup.service.js";
import { remnaGetUser, remnaUpdateUser } from "../remna/remna.client.js";
import { enforceExhaustedQuota, restoreMeteredSquad } from "../squad-traffic/traffic-enforcement.service.js";
import { applyTrafficEntitlement } from "../squad-traffic/traffic-entitlement.service.js";
import { effectiveLimitBytes } from "../squad-traffic/traffic-period.js";
import { remnaTrafficSettings } from "../squad-traffic/traffic-remna-policy.js";

export type PreviousTariffTrafficConfig = {
  internalSquadUuids: string[];
};

function userBody(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  const root = data as Record<string, unknown>;
  const nested = root.response ?? root.data;
  return nested && typeof nested === "object" ? nested as Record<string, unknown> : root;
}

function squadUuids(data: unknown): string[] | null {
  const raw = userBody(data)?.activeInternalSquads;
  if (!Array.isArray(raw)) return null;
  return raw.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (item && typeof item === "object" && typeof (item as { uuid?: unknown }).uuid === "string") {
      return [(item as { uuid: string }).uuid];
    }
    return [];
  });
}

export async function syncTariffSubscribers(
  tariffId: string,
  previous: PreviousTariffTrafficConfig,
): Promise<{ total: number; synced: number; failed: number; snapshotPath: string | null; errors: string[] }> {
  const tariff = await prisma.tariff.findUnique({ where: { id: tariffId } });
  if (!tariff) throw new Error("Тариф не найден");
  const subscriptions = await prisma.subscription.findMany({
    where: { tariffId, deletionRequestedAt: null, expireAt: { gt: new Date() }, remnawaveUuid: { not: null } },
    select: { id: true, remnawaveUuid: true, extraDevices: true },
  });
  const snapshots = await Promise.all(subscriptions.map(async (subscription) => ({
    subscription,
    user: await remnaGetUser(subscription.remnawaveUuid!),
  })));
  const snapshotPath = snapshots.length
    ? await saveCriticalSnapshot(`tariff-${tariffId}-remnawave`, snapshots)
    : null;
  let synced = 0;
  const errors: string[] = [];
  const remnaSettings = remnaTrafficSettings(tariff);

  for (const snapshot of snapshots) {
    try {
      if (snapshot.user.error || !snapshot.user.data) throw new Error(snapshot.user.error ?? "Remnawave user не найден");
      const currentSquads = squadUuids(snapshot.user.data);
      if (!currentSquads) throw new Error("Некорректный activeInternalSquads Remnawave");
      const preserved = currentSquads.filter((uuid) => !previous.internalSquadUuids.includes(uuid));
      let targetSquads = [...new Set([...preserved, ...tariff.internalSquadUuids])];
      const currentQuota = await prisma.squadTrafficQuota.findUnique({ where: { subscriptionId: snapshot.subscription.id } });
      if (tariff.trafficLimitMode === "LOCAL_SQUAD" && currentQuota?.status === "EXHAUSTED" && tariff.meteredSquadUuid) {
        targetSquads = targetSquads.filter((uuid) => uuid !== tariff.meteredSquadUuid);
      }
      const updated = await remnaUpdateUser({
        uuid: snapshot.subscription.remnawaveUuid!,
        ...remnaSettings,
        hwidDeviceLimit: Math.max(1, tariff.includedDevices + snapshot.subscription.extraDevices),
        activeInternalSquads: targetSquads,
      });
      if (updated.error) throw new Error(updated.error);

      await applyTrafficEntitlement(snapshot.subscription.id, {
        tariffId,
        mode: tariff.trafficLimitMode,
        internalSquadUuids: tariff.internalSquadUuids,
        meteredSquadUuid: tariff.meteredSquadUuid,
        trafficLimitBytes: tariff.localTrafficLimitBytes,
      }, "TARIFF_CHANGE");

      const quota = await prisma.squadTrafficQuota.findUnique({
        where: { subscriptionId: snapshot.subscription.id },
        include: { grants: true },
      });
      if (quota && !["SUSPENDED", "CONFIG_ERROR"].includes(quota.status)) {
        const limit = effectiveLimitBytes(quota.baseLimitBytes, quota.grants.filter((grant) => grant.status === "ACTIVE"), quota.tariffIdAtPeriodStart, quota.periodStartedAt);
        const exhausted = limit > 0n && quota.usedBytes >= limit;
        if (exhausted && quota.status !== "EXHAUSTED") {
          await prisma.squadTrafficQuota.update({ where: { id: quota.id }, data: { status: "EXHAUSTED", exhaustedAt: new Date() } });
          const result = await enforceExhaustedQuota(snapshot.subscription.id);
          if (!result.ok) throw new Error(result.error ?? "Не удалось исключить squad");
        } else if (!exhausted && quota.status === "EXHAUSTED") {
          await prisma.squadTrafficQuota.update({ where: { id: quota.id }, data: { status: "ACTIVE", exhaustedAt: null } });
          const result = await restoreMeteredSquad(snapshot.subscription.id);
          if (!result.ok) throw new Error(result.error ?? "Не удалось вернуть squad");
        }
      }
      synced++;
    } catch (error) {
      errors.push(`${snapshot.subscription.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { total: subscriptions.length, synced, failed: subscriptions.length - synced, snapshotPath, errors: errors.slice(0, 20) };
}
