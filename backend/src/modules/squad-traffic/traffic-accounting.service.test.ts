import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";

const { accountTrafficBatch } = await import("./traffic-accounting.service.js");

type Checkpoint = {
  subscriptionId: string;
  squadUuid: string;
  currentDate: Date | null;
  currentObservedBytes: bigint;
  previousDate: Date | null;
  previousObservedBytes: bigint;
};

function memoryAccounting(options: { baseLimitBytes?: bigint; concurrent?: boolean } = {}) {
  const quota = {
    id: "quota-1", subscriptionId: "s1", meteredSquadUuid: "squad-1", baseLimitBytes: options.baseLimitBytes ?? 100n,
    usedBytes: 0n, tariffIdAtPeriodStart: "tariff-1", periodStartedAt: new Date("2026-07-01T00:00:00.000Z"),
    notifiedPercents: [], status: "ACTIVE", exhaustedAt: null as Date | null, updatedAt: new Date("2026-07-01T00:00:00.000Z"), grants: [],
  };
  let checkpoint: Checkpoint | null = null;
  const events: Array<Record<string, unknown>> = [];
  let checkpointUpdates = 0;
  let quotaUpdates = 0;
  const tx = {
    squadTrafficQuota: {
      findUnique: async ({ where }: { where: { subscriptionId: string } }) => where.subscriptionId === quota.subscriptionId ? quota : null,
      updateMany: async ({ where, data }: { where: { id: string; updatedAt: Date }; data: Partial<typeof quota> }) => {
        quotaUpdates++;
        if (options.concurrent || where.updatedAt.getTime() !== quota.updatedAt.getTime()) return { count: 0 };
        Object.assign(quota, data, { updatedAt: new Date(quota.updatedAt.getTime() + 1) });
        return { count: 1 };
      },
    },
    trafficUsageCheckpoint: {
      findUnique: async ({ where }: { where: { subscriptionId: string } }) => where.subscriptionId === "s1" ? checkpoint : null,
      create: async ({ data }: { data: Checkpoint }) => {
        checkpoint = { ...data };
        return checkpoint;
      },
      update: async ({ data }: { data: Partial<Checkpoint> }) => {
        checkpointUpdates++;
        assert.ok(checkpoint);
        Object.assign(checkpoint, data);
        return checkpoint;
      },
    },
    trafficQuotaEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        events.push(data);
        return data;
      },
    },
  };
  return {
    dependencies: { prisma: { $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx) } },
    state: {
      quota, events,
      get checkpoint() { return checkpoint; },
      get checkpointUpdates() { return checkpointUpdates; },
      get quotaUpdates() { return quotaUpdates; },
    },
  };
}

const now = new Date("2026-07-19T12:00:00.000Z");
const sample = (date: string, observedBytes: bigint) => ({ subscriptionId: "s1", date, observedBytes });

test("same observed totals do not add usage twice or update unchanged rows", async () => {
  const { dependencies, state } = memoryAccounting();
  await accountTrafficBatch([sample("2026-07-18", 100n)], now, dependencies);
  await accountTrafficBatch([sample("2026-07-18", 150n)], now, dependencies);
  await accountTrafficBatch([sample("2026-07-18", 150n)], now, dependencies);

  assert.equal(state.quota.usedBytes, 50n);
  assert.equal(state.checkpointUpdates, 1);
  assert.equal(state.quotaUpdates, 1);
});

test("day shift preserves the prior slot and late yesterday samples apply their own delta", async () => {
  const { dependencies, state } = memoryAccounting();
  await accountTrafficBatch([sample("2026-07-18", 10n)], now, dependencies);
  await accountTrafficBatch([sample("2026-07-19", 30n)], now, dependencies);
  await accountTrafficBatch([sample("2026-07-18", 25n)], now, dependencies);

  assert.equal(state.quota.usedBytes, 15n);
  assert.equal(state.checkpoint?.currentDate?.toISOString().slice(0, 10), "2026-07-19");
  assert.equal(state.checkpoint?.previousDate?.toISOString().slice(0, 10), "2026-07-18");
  assert.equal(state.checkpoint?.previousObservedBytes, 25n);
});

test("a decreased source replaces its checkpoint baseline without subtracting used traffic", async () => {
  const { dependencies, state } = memoryAccounting();
  await accountTrafficBatch([sample("2026-07-18", 100n)], now, dependencies);
  await accountTrafficBatch([sample("2026-07-18", 150n)], now, dependencies);
  const result = await accountTrafficBatch([sample("2026-07-18", 120n)], now, dependencies);

  assert.equal(state.quota.usedBytes, 50n);
  assert.equal(state.checkpoint?.currentObservedBytes, 120n);
  assert.deepEqual(result.anomalies, [{ subscriptionId: "s1", kind: "SOURCE_DECREASED" }]);
});

test("unlimited quotas account usage but never exhaust", async () => {
  const { dependencies, state } = memoryAccounting({ baseLimitBytes: 0n });
  await accountTrafficBatch([sample("2026-07-18", 0n)], now, dependencies);
  const result = await accountTrafficBatch([sample("2026-07-18", 200n)], now, dependencies);

  assert.equal(state.quota.usedBytes, 200n);
  assert.equal(state.quota.status, "ACTIVE");
  assert.equal(result.exhaustedSubscriptionIds.size, 0);
});

test("one large delta reports every remaining threshold and exhausts a finite quota", async () => {
  const { dependencies, state } = memoryAccounting({ baseLimitBytes: 100n });
  await accountTrafficBatch([sample("2026-07-18", 0n)], now, dependencies);
  const result = await accountTrafficBatch([sample("2026-07-18", 100n)], now, dependencies);

  assert.deepEqual(result.crossedPercentsBySubscription.get("s1"), [50, 25, 10, 3, 0]);
  assert.equal(state.quota.status, "EXHAUSTED");
  assert.deepEqual([...result.exhaustedSubscriptionIds], ["s1"]);
});

test("a concurrent quota update is discarded instead of overwriting a manual change", async () => {
  const { dependencies, state } = memoryAccounting({ concurrent: true });
  await accountTrafficBatch([sample("2026-07-18", 0n)], now, dependencies);
  const result = await accountTrafficBatch([sample("2026-07-18", 100n)], now, dependencies);

  assert.equal(state.quota.usedBytes, 0n);
  assert.deepEqual(result.anomalies, [{ subscriptionId: "s1", kind: "CONCURRENT_UPDATE" }]);
});
