import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";

const { brokerTrafficUsage } = await import("./traffic-usage.broker.js");

const days = {
  today: { start: "2026-07-19T00:00:00.000Z", end: "2026-07-20T00:00:00.000Z" },
  yesterday: { start: "2026-07-18T00:00:00.000Z", end: "2026-07-19T00:00:00.000Z" },
};

const whitelistQuota = (subscriptionId: string, username = `${subscriptionId}-user`) => ({
  subscriptionId,
  meteredSquadUuid: "whitelist-squad",
  remnawaveUsername: username,
});

function dependencies(options: {
  nodes?: readonly string[];
  today?: ReadonlyArray<{ username: string; total: number }>;
  yesterday?: ReadonlyArray<{ username: string; total: number }>;
  nodeError?: string;
  usageError?: string;
}) {
  const accessibleCalls: string[] = [];
  const usageCalls: Array<{ nodes: string[]; start: string; end: string; limit: number }> = [];
  return {
    dependencies: {
      getSquadAccessibleNodeUuids: async (squadUuid: string) => {
        accessibleCalls.push(squadUuid);
        return options.nodeError
          ? { error: options.nodeError, status: 504 }
          : { data: [...(options.nodes ?? ["whitelist-node"])], status: 200 };
      },
      getNodesUsersUsage: async (nodes: string[], start: string, end: string, limit: number) => {
        usageCalls.push({ nodes, start, end, limit });
        if (options.usageError) return { error: options.usageError, status: 502 };
        return { data: { topUsers: [...(start === days.today.start ? options.today ?? [] : options.yesterday ?? [])] }, status: 200 };
      },
    },
    accessibleCalls,
    usageCalls,
  };
}

test("Default quotas do not resolve nodes while Whitelist uses only its accessible nodes", async () => {
  const calls = dependencies({ today: [{ username: "white-user", total: 20 }], yesterday: [{ username: "white-user", total: 10 }] });
  const result = await brokerTrafficUsage([
    { subscriptionId: "default", meteredSquadUuid: null, remnawaveUsername: "default-user" },
    whitelistQuota("white", "white-user"),
  ], days, calls.dependencies);

  assert.deepEqual(calls.accessibleCalls, ["whitelist-squad"]);
  assert.equal(calls.usageCalls.length, 2);
  assert.deepEqual(calls.usageCalls[0]?.nodes, ["whitelist-node"]);
  assert.deepEqual(calls.usageCalls[1]?.nodes, ["whitelist-node"]);
  assert.deepEqual(result.usageBySubscription.get("white"), { todayBytes: 20n, yesterdayBytes: 10n });
  assert.equal(result.usageBySubscription.has("default"), false);
});

test("two tariffs on one Whitelist squad use one today/yesterday request pair", async () => {
  const calls = dependencies({
    today: [{ username: "one-user", total: 20 }, { username: "two-user", total: 40 }],
    yesterday: [{ username: "one-user", total: 10 }, { username: "two-user", total: 30 }],
  });
  const result = await brokerTrafficUsage([whitelistQuota("one"), whitelistQuota("two")], days, calls.dependencies);

  assert.deepEqual(calls.accessibleCalls, ["whitelist-squad"]);
  assert.equal(calls.usageCalls.length, 2);
  assert.equal(calls.usageCalls[0]?.limit, 100);
  assert.deepEqual(result.usageBySubscription.get("one"), { todayBytes: 20n, yesterdayBytes: 10n });
  assert.deepEqual(result.usageBySubscription.get("two"), { todayBytes: 40n, yesterdayBytes: 30n });
});

test("a response at the safe limit discards the whole squad group", async () => {
  const calls = dependencies({
    today: Array.from({ length: 100 }, (_, index) => ({ username: `user-${index}`, total: index })),
    yesterday: [],
  });
  const result = await brokerTrafficUsage([whitelistQuota("one"), whitelistQuota("two")], days, calls.dependencies);

  assert.equal(result.usageBySubscription.size, 0);
  assert.equal(result.squadDiagnostics.get("whitelist-squad")?.error, "TRUNCATED_RESPONSE");
});

test("missing usernames in complete responses map to zero", async () => {
  const calls = dependencies({ today: [{ username: "someone-else", total: 99 }], yesterday: [] });
  const result = await brokerTrafficUsage([whitelistQuota("one")], days, calls.dependencies);

  assert.deepEqual(result.usageBySubscription.get("one"), { todayBytes: 0n, yesterdayBytes: 0n });
});

for (const [label, setup] of [
  ["empty nodes", { nodes: [] }],
  ["timeout", { usageError: "Remna API timeout" }],
  ["malformed total", { today: [{ username: "one-user", total: -1 }] }],
] as const) {
  test(`${label} leaves no partial squad result`, async () => {
    const calls = dependencies(setup);
    const result = await brokerTrafficUsage([whitelistQuota("one")], days, calls.dependencies);

    assert.equal(result.usageBySubscription.size, 0);
    assert.ok(result.squadDiagnostics.get("whitelist-squad")?.error);
  });
}

test("quota without a saved username is a configuration error without a per-user lookup", async () => {
  const calls = dependencies({});
  const result = await brokerTrafficUsage([whitelistQuota("one", "")], days, calls.dependencies);

  assert.equal(calls.usageCalls.length, 0);
  assert.equal(result.subscriptionErrors.get("one"), "CONFIG_ERROR");
});
