import {
  remnaGetNodesUsersUsage,
  remnaGetSquadAccessibleNodeUuids,
  type Result,
} from "../remna/remna.client.js";

export type ActiveTrafficQuota = {
  subscriptionId: string;
  meteredSquadUuid: string | null;
  remnawaveUsername: string | null;
};

export type UsageDayRange = { start: string; end: string };
export type UsageDayRanges = { today: UsageDayRange; yesterday: UsageDayRange };
export type SubscriptionUsage = { todayBytes: bigint; yesterdayBytes: bigint };
export type SquadUsageDiagnostic = {
  squadUuid: string;
  nodeUuids: string[];
  topUsersLimit: number;
  error?: "CONFIG_ERROR" | "UPSTREAM_ERROR" | "MALFORMED_RESPONSE" | "TRUNCATED_RESPONSE";
};

type BulkUsage = { topUsers: Array<{ username: string; total: number }> };
export type TrafficUsageBrokerDependencies = {
  getSquadAccessibleNodeUuids: (squadUuid: string) => Promise<Result<string[]>>;
  getNodesUsersUsage: (nodesUuids: string[], start: string, end: string, topUsersLimit: number) => Promise<Result<BulkUsage>>;
};

const productionDependencies: TrafficUsageBrokerDependencies = {
  getSquadAccessibleNodeUuids: remnaGetSquadAccessibleNodeUuids,
  getNodesUsersUsage: remnaGetNodesUsersUsage,
};

export type TrafficUsageBrokerResult = {
  usageBySubscription: Map<string, SubscriptionUsage>;
  squadDiagnostics: Map<string, SquadUsageDiagnostic>;
  subscriptionErrors: Map<string, "CONFIG_ERROR">;
};

function readTotals(response: Result<BulkUsage>, topUsersLimit: number):
  | { totals: Map<string, bigint> }
  | { error: SquadUsageDiagnostic["error"] } {
  if (response.error || !response.data) return { error: "UPSTREAM_ERROR" };
  const { topUsers } = response.data;
  if (!Array.isArray(topUsers)) return { error: "MALFORMED_RESPONSE" };
  if (topUsers.length >= topUsersLimit) return { error: "TRUNCATED_RESPONSE" };

  const totals = new Map<string, bigint>();
  for (const item of topUsers) {
    if (!item || typeof item.username !== "string" || typeof item.total !== "number"
      || !Number.isSafeInteger(item.total) || item.total < 0) {
      return { error: "MALFORMED_RESPONSE" };
    }
    totals.set(item.username, BigInt(item.total));
  }
  return { totals };
}

/**
 * Resolves each metered squad once and fetches separate, complete UTC-day totals.
 * Groups fail open: a failed group contributes no partial subscription samples.
 */
export async function brokerTrafficUsage(
  activeQuotas: ActiveTrafficQuota[],
  days: UsageDayRanges,
  dependencies: TrafficUsageBrokerDependencies = productionDependencies,
): Promise<TrafficUsageBrokerResult> {
  const usageBySubscription = new Map<string, SubscriptionUsage>();
  const squadDiagnostics = new Map<string, SquadUsageDiagnostic>();
  const subscriptionErrors = new Map<string, "CONFIG_ERROR">();
  const bySquad = new Map<string, ActiveTrafficQuota[]>();

  for (const quota of activeQuotas) {
    if (!quota.meteredSquadUuid) continue;
    if (!quota.remnawaveUsername) {
      subscriptionErrors.set(quota.subscriptionId, "CONFIG_ERROR");
      continue;
    }
    const group = bySquad.get(quota.meteredSquadUuid) ?? [];
    group.push(quota);
    bySquad.set(quota.meteredSquadUuid, group);
  }

  for (const [squadUuid, quotas] of bySquad) {
    const activeUsernames = new Set(quotas.map((quota) => quota.remnawaveUsername!));
    const topUsersLimit = Math.max(100, activeUsernames.size * 2 + 50);
    const nodesResult = await dependencies.getSquadAccessibleNodeUuids(squadUuid);
    const nodeUuids = nodesResult.data ?? [];
    const diagnostic: SquadUsageDiagnostic = { squadUuid, nodeUuids, topUsersLimit };
    squadDiagnostics.set(squadUuid, diagnostic);

    if (nodesResult.error || nodeUuids.length === 0) {
      diagnostic.error = "CONFIG_ERROR";
      continue;
    }

    const todayResult = await dependencies.getNodesUsersUsage(nodeUuids, days.today.start, days.today.end, topUsersLimit);
    const today = readTotals(todayResult, topUsersLimit);
    if ("error" in today) {
      diagnostic.error = today.error;
      continue;
    }

    const yesterdayResult = await dependencies.getNodesUsersUsage(nodeUuids, days.yesterday.start, days.yesterday.end, topUsersLimit);
    const yesterday = readTotals(yesterdayResult, topUsersLimit);
    if ("error" in yesterday) {
      diagnostic.error = yesterday.error;
      continue;
    }

    for (const quota of quotas) {
      usageBySubscription.set(quota.subscriptionId, {
        todayBytes: today.totals.get(quota.remnawaveUsername!) ?? 0n,
        yesterdayBytes: yesterday.totals.get(quota.remnawaveUsername!) ?? 0n,
      });
    }
  }

  return { usageBySubscription, squadDiagnostics, subscriptionErrors };
}
