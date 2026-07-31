import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";

const { runSquadTrafficAccounting } = await import("./squad-traffic.worker.js");

function workerDependencies(options: { brokerError?: boolean; enabled?: boolean } = {}) {
  const calls: string[] = [];
  const accountedSamples: Array<{ subscriptionId: string; date: string; observedBytes: bigint }> = [];
  const dependencies = {
    listActiveQuotas: async () => [{ subscriptionId: "s1", meteredSquadUuid: "squad-1", remnawaveUsername: "alice" }],
    rollover: async () => { calls.push("rollover"); },
    broker: async (_quotas: unknown, days: { yesterday: { start: string; end: string }; today: { start: string; end: string } }) => {
      calls.push("broker");
      if (options.brokerError) throw new Error("upstream unavailable");
      assert.match(days.yesterday.start, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(days.today.end, /^\d{4}-\d{2}-\d{2}$/);
      return {
        usageBySubscription: new Map([["s1", { todayBytes: 10n, yesterdayBytes: 5n }]]),
        squadDiagnostics: new Map([["squad-1", { squadUuid: "squad-1", nodeUuids: ["node-1"], topUsersLimit: 100 }]]),
        subscriptionErrors: new Map(),
      };
    },
    account: async (samples: Array<{ subscriptionId: string; date: string; observedBytes: bigint }>) => {
      calls.push("account");
      accountedSamples.push(...samples);
      return { crossedPercentsBySubscription: new Map([["s1", [50]]]), exhaustedSubscriptionIds: new Set(["s1"]), anomalies: [], changedCount: 1 };
    },
    notify: async () => { calls.push("notify"); },
    enforce: async () => { calls.push("enforce"); },
    isEnforcementEnabled: async () => options.enabled ?? false,
    saveState: async () => { calls.push("state"); },
  };
  return { dependencies, calls, accountedSamples };
}

test("worker accounts yesterday before today so both bounded checkpoint slots initialize", async () => {
  const { dependencies, accountedSamples } = workerDependencies();

  await runSquadTrafficAccounting({ observeOnly: true }, dependencies);

  assert.deepEqual(accountedSamples.map((sample) => sample.observedBytes), [5n, 10n]);
  assert.ok(accountedSamples[0]!.date < accountedSamples[1]!.date);
});

test("worker rolls over before broker/accounting and observe-only suppresses enforcement", async () => {
  const { dependencies, calls } = workerDependencies({ enabled: false });
  const result = await runSquadTrafficAccounting({ observeOnly: true }, dependencies);

  assert.deepEqual(calls, ["rollover", "broker", "account", "notify", "state"]);
  assert.equal(result.wouldEnforce, 1);
  assert.equal(result.enforced, 0);
});

test("worker is fail-open when broker fails and does not account or enforce", async () => {
  const { dependencies, calls } = workerDependencies({ brokerError: true, enabled: true });
  const result = await runSquadTrafficAccounting({ observeOnly: false }, dependencies);

  assert.equal(result.ok, false);
  assert.deepEqual(calls, ["rollover", "broker", "state"]);
});

test("enabled worker enforces exhausted subscriptions after notifications", async () => {
  const { dependencies, calls } = workerDependencies({ enabled: true });
  const result = await runSquadTrafficAccounting({ observeOnly: false }, dependencies);

  assert.deepEqual(calls, ["rollover", "broker", "account", "notify", "enforce", "state"]);
  assert.equal(result.enforced, 1);
});
