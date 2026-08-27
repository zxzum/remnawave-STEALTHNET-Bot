import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";
process.env.REMNA_API_URL = "https://remna.test";
process.env.REMNA_ADMIN_TOKEN = "test-token";

const {
  applyTrafficEntitlement,
  grantTrafficBytes,
  revokeTrafficGrant,
  rolloverTrafficQuota,
  validateTrafficEntitlement,
} = await import("./traffic-entitlement.service.js");
const { extendSecondarySubscription } = await import("../tariff/tariff-activation.service.js");

type Quota = {
  id: string;
  subscriptionId: string;
  tariffIdAtPeriodStart: string | null;
  meteredSquadUuid: string;
  baseLimitBytes: bigint;
  usedBytes: bigint;
  periodStartedAt: Date;
  periodEndsAt: Date;
  notifiedPercents: number[];
  status: string;
  exhaustedAt: Date | null;
  lastAccountedAt: Date | null;
};

type Grant = {
  id: string;
  quotaId: string;
  tariffIdAtGrant: string | null;
  scope: "CURRENT_PERIOD" | "WHILE_TARIFF_ACTIVE";
  status: "ACTIVE" | "REVOKED" | "EXPIRED";
  bytes: bigint;
  validPeriodStartAt: Date | null;
  revokedAt: Date | null;
};

function memoryDependencies(options: {
  now: Date;
  expireAt?: Date;
  quota?: Partial<Quota>;
  grants?: Grant[];
}) {
  const subscription = {
    id: "sub-1",
    remnawaveUuid: "owning-uuid",
    expireAt: options.expireAt ?? new Date("2026-10-01T00:00:00.000Z"),
  };
  let quota: Quota | null = options.quota ? {
    id: "quota-1",
    subscriptionId: subscription.id,
    tariffIdAtPeriodStart: "tariff-1",
    meteredSquadUuid: "squad-local",
    baseLimitBytes: 100n,
    usedBytes: 40n,
    periodStartedAt: new Date("2026-07-01T00:00:00.000Z"),
    periodEndsAt: new Date("2026-08-01T00:00:00.000Z"),
    notifiedPercents: [50],
    status: "ACTIVE",
    exhaustedAt: null,
    lastAccountedAt: null,
    ...options.quota,
  } : null;
  const grants = [...(options.grants ?? [])];
  const events: Array<Record<string, unknown>> = [];
  const remnaWrites: Array<Record<string, unknown>> = [];
  const checkpoints: Array<Record<string, unknown>> = [];
  let grantSequence = grants.length;

  const withRelations = (value: Quota | null) => value && ({
    ...value,
    grants: grants.filter((grant) => grant.quotaId === value.id),
    subscription,
  });

  const tx = {
    subscription: {
      findUnique: async () => subscription,
    },
    squadTrafficQuota: {
      findUnique: async ({ where }: { where: { subscriptionId?: string; id?: string } }) => (
        withRelations(quota && (where.subscriptionId === quota.subscriptionId || where.id === quota.id) ? quota : null)
      ),
      create: async ({ data }: { data: Omit<Quota, "id"> }) => {
        quota = { id: "quota-1", ...data };
        return withRelations(quota);
      },
      update: async ({ data }: { data: Partial<Quota> }) => {
        assert.ok(quota);
        quota = { ...quota, ...data };
        return withRelations(quota);
      },
      deleteMany: async () => {
        const count = quota ? 1 : 0;
        quota = null;
        grants.length = 0;
        return { count };
      },
    },
    trafficQuotaGrant: {
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const grant of grants) {
          if (grant.quotaId === where.quotaId && grant.status === where.status
            && (!where.scope || grant.scope === where.scope)) {
            Object.assign(grant, data);
            count++;
          }
        }
        return { count };
      },
      create: async ({ data }: { data: Omit<Grant, "id" | "status" | "revokedAt"> }) => {
        const grant: Grant = { id: `grant-${++grantSequence}`, status: "ACTIVE", revokedAt: null, ...data };
        grants.push(grant);
        return grant;
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const grant = grants.find((item) => item.id === where.id);
        return grant && quota ? { ...grant, quota: withRelations(quota) } : null;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Grant> }) => {
        const grant = grants.find((item) => item.id === where.id);
        assert.ok(grant);
        Object.assign(grant, data);
        return grant;
      },
    },
    trafficQuotaEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        events.push(data);
        return data;
      },
    },
    trafficUsageCheckpoint: {
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        checkpoints.push(create);
        return create;
      },
    },
  };

  return {
    dependencies: {
      prisma: {
        subscription: tx.subscription,
        $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      },
      updateRemnaUser: async (data: Record<string, unknown>) => {
        remnaWrites.push(data);
        return { status: 200, data: {} };
      },
    } as any,
    state: { get quota() { return quota; }, grants, events, remnaWrites, checkpoints, subscription },
  };
}

const local = {
  tariffId: "tariff-1",
  mode: "LOCAL_SQUAD" as const,
  internalSquadUuids: ["squad-default", "squad-local"],
  meteredSquadUuid: "squad-local",
  trafficLimitBytes: 100n,
};

test("new LOCAL_SQUAD purchase creates a zero-used local quota without changing global Remnawave policy", async () => {
  const now = new Date("2026-07-19T12:00:00.000Z");
  const { dependencies, state } = memoryDependencies({ now });

  await applyTrafficEntitlement("sub-1", local, "NEW_PURCHASE", now, dependencies);

  assert.equal(state.quota?.usedBytes, 0n);
  assert.equal(state.quota?.periodStartedAt.toISOString(), now.toISOString());
  assert.deepEqual(state.remnaWrites, []);
  assert.deepEqual(state.checkpoints, [{
    subscriptionId: "sub-1",
    squadUuid: "squad-local",
    currentDate: now,
    currentObservedBytes: 0n,
    previousDate: null,
    previousObservedBytes: 0n,
  }]);
});

test("same-tariff renewal preserves the current period, usage, and tariff-scoped grant", async () => {
  const now = new Date("2026-07-19T12:00:00.000Z");
  const periodStartedAt = new Date("2026-07-01T00:00:00.000Z");
  const periodEndsAt = new Date("2026-08-01T00:00:00.000Z");
  const grant: Grant = {
    id: "grant-tariff", quotaId: "quota-1", tariffIdAtGrant: "tariff-1",
    scope: "WHILE_TARIFF_ACTIVE", status: "ACTIVE", bytes: 20n,
    validPeriodStartAt: null, revokedAt: null,
  };
  const { dependencies, state } = memoryDependencies({ now, quota: { periodStartedAt, periodEndsAt }, grants: [grant] });

  await applyTrafficEntitlement("sub-1", local, "RENEWAL", now, dependencies);

  assert.equal(state.quota?.periodStartedAt, periodStartedAt);
  assert.equal(state.quota?.periodEndsAt, periodEndsAt);
  assert.equal(state.quota?.usedBytes, 40n);
  assert.equal(grant.status, "ACTIVE");
});

test("elapsed paid period rolls over, expires CURRENT_PERIOD, and keeps tariff-scoped grants", async () => {
  const now = new Date("2026-08-02T12:00:00.000Z");
  const current: Grant = {
    id: "grant-current", quotaId: "quota-1", tariffIdAtGrant: null,
    scope: "CURRENT_PERIOD", status: "ACTIVE", bytes: 10n,
    validPeriodStartAt: new Date("2026-07-01T00:00:00.000Z"), revokedAt: null,
  };
  const tariff: Grant = {
    id: "grant-tariff", quotaId: "quota-1", tariffIdAtGrant: "tariff-1",
    scope: "WHILE_TARIFF_ACTIVE", status: "ACTIVE", bytes: 20n,
    validPeriodStartAt: null, revokedAt: null,
  };
  const { dependencies, state } = memoryDependencies({
    now,
    quota: { periodEndsAt: new Date("2026-08-01T00:00:00.000Z") },
    grants: [current, tariff],
  });

  await rolloverTrafficQuota("sub-1", now, dependencies);

  assert.equal(state.quota?.periodStartedAt.toISOString(), now.toISOString());
  assert.equal(state.quota?.usedBytes, 0n);
  assert.equal(current.status, "EXPIRED");
  assert.equal(tariff.status, "ACTIVE");
});

test("tariff change resets quota and expires all old active grants", async () => {
  const now = new Date("2026-07-19T12:00:00.000Z");
  const grants: Grant[] = [
    { id: "g1", quotaId: "quota-1", tariffIdAtGrant: null, scope: "CURRENT_PERIOD", status: "ACTIVE", bytes: 10n, validPeriodStartAt: new Date("2026-07-01T00:00:00Z"), revokedAt: null },
    { id: "g2", quotaId: "quota-1", tariffIdAtGrant: "tariff-1", scope: "WHILE_TARIFF_ACTIVE", status: "ACTIVE", bytes: 20n, validPeriodStartAt: null, revokedAt: null },
  ];
  const { dependencies, state } = memoryDependencies({ now, quota: {}, grants });

  await applyTrafficEntitlement("sub-1", { ...local, tariffId: "tariff-2", trafficLimitBytes: 200n }, "TARIFF_CHANGE", now, dependencies);

  assert.equal(state.quota?.tariffIdAtPeriodStart, "tariff-2");
  assert.equal(state.quota?.baseLimitBytes, 200n);
  assert.equal(state.quota?.usedBytes, 0n);
  assert.deepEqual(grants.map((grant) => grant.status), ["EXPIRED", "EXPIRED"]);
});

test("REMNAWAVE mode removes local quota state", async () => {
  const now = new Date("2026-07-19T12:00:00.000Z");
  const { dependencies, state } = memoryDependencies({ now, quota: {} });

  await applyTrafficEntitlement("sub-1", { ...local, mode: "REMNAWAVE" }, "TARIFF_CHANGE", now, dependencies);

  assert.equal(state.quota, null);
  assert.deepEqual(state.remnaWrites, []);
});

test("grant scopes bind to the current period or tariff and revoke writes an audit event", async () => {
  const now = new Date("2026-07-19T12:00:00.000Z");
  const { dependencies, state } = memoryDependencies({ now, quota: {} });

  const current = await grantTrafficBytes("sub-1", 10n, "CURRENT_PERIOD", "admin-1", dependencies);
  const tariff = await grantTrafficBytes("sub-1", 20n, "WHILE_TARIFF_ACTIVE", "admin-1", dependencies);
  await revokeTrafficGrant(tariff.id, "admin-2", dependencies, now);

  assert.equal(current.validPeriodStartAt?.toISOString(), state.quota?.periodStartedAt.toISOString());
  assert.equal(current.tariffIdAtGrant, null);
  assert.equal(tariff.validPeriodStartAt, null);
  assert.equal(tariff.tariffIdAtGrant, "tariff-1");
  assert.equal(state.grants.find((grant) => grant.id === tariff.id)?.status, "REVOKED");
  assert.equal(state.events.at(-1)?.kind, "GRANT_REVOKED");
  assert.deepEqual(state.events.at(-1)?.detail, { grantId: tariff.id, actorId: "admin-2" });
});

test("invalid LOCAL_SQUAD policy fails before the actual activation path performs a Remnawave call", async () => {
  assert.throws(() => validateTrafficEntitlement({ ...local, meteredSquadUuid: "not-assigned" }));

  const calls: string[] = [];
  const result = await extendSecondarySubscription(
    "sub-1",
    "client-1",
    { ...local, meteredSquadUuid: "not-assigned", trafficLimitMode: local.mode, id: "tariff-2", durationDays: 30, deviceLimit: 1, includedDevices: 1 },
    undefined,
    undefined,
    undefined,
    true,
    false,
    {
      findSubscription: async () => ({
        id: "sub-1", remnawaveUuid: "owning-uuid", tariffId: "tariff-1", ownerId: "client-1",
        giftedToClientId: null, deletionRequestedAt: null, customPrice: 100, extraDevices: 0,
        extraDevicesMonthlyPrice: 0, trialId: null, currentPricePerDay: 1,
      }),
      getUser: async () => { calls.push("get-user"); return { status: 200, data: {} }; },
      updateUser: async () => { calls.push("update-user"); return { status: 200, data: {} }; },
      updateSubscription: async () => { calls.push("update-subscription"); return {}; },
      applyEntitlement: async () => { calls.push("apply-entitlement"); return null; },
    } as any,
  );

  assert.equal(result.ok, false);
  assert.deepEqual(calls, ["get-user"]);
});

test("actual activation integration writes LOCAL policy to the one owning UUID, then applies lifecycle state", async () => {
  const calls: Array<[string, Record<string, unknown>?]> = [];
  const result = await extendSecondarySubscription(
    "sub-1",
    "client-1",
    { ...local, trafficLimitMode: local.mode, id: "tariff-2", durationDays: 30, deviceLimit: 1, includedDevices: 1 },
    undefined,
    undefined,
    undefined,
    true,
    false,
    {
      findSubscription: async () => ({
        id: "sub-1", remnawaveUuid: "owning-uuid", tariffId: "tariff-1", ownerId: "client-1",
        giftedToClientId: null, deletionRequestedAt: null, customPrice: 100, extraDevices: 0,
        extraDevicesMonthlyPrice: 0, trialId: null, currentPricePerDay: 1,
      }),
      getUser: async () => ({ status: 200, data: {} }),
      resetUserTraffic: async () => { calls.push(["reset"]); return { status: 200, data: {} }; },
      updateUser: async (data: Record<string, unknown>) => { calls.push(["update", data]); return { status: 200, data: {} }; },
      updateSubscription: async () => { calls.push(["subscription"]); return {}; },
      applyEntitlement: async (subscriptionId: string, input: Record<string, unknown>) => {
        calls.push(["entitlement", { subscriptionId, ...input }]);
        return null;
      },
    } as any,
  );

  assert.equal(result.ok, true);
  assert.equal(calls.some(([name]) => name === "reset"), false);
  const update = calls.find(([name]) => name === "update")?.[1];
  assert.equal(update?.uuid, "owning-uuid");
  assert.equal(update?.trafficLimitBytes, 0);
  assert.equal(update?.trafficLimitStrategy, "NO_RESET");
  const entitlement = calls.find(([name]) => name === "entitlement")?.[1];
  assert.equal(entitlement?.subscriptionId, "sub-1");
  assert.equal(entitlement?.mode, "LOCAL_SQUAD");
  assert.ok(calls.findIndex(([name]) => name === "update") < calls.findIndex(([name]) => name === "entitlement"));
});

test("Trial to paid starts a new LOCAL_SQUAD quota period without carrying trial usage", async () => {
  const now = new Date("2026-07-19T12:00:00.000Z");
  const { dependencies, state } = memoryDependencies({
    now,
    quota: { usedBytes: 75n, tariffIdAtPeriodStart: "trial-tariff" },
  });

  await applyTrafficEntitlement("sub-1", { ...local, tariffId: "paid-tariff", trafficLimitBytes: 200n }, "TARIFF_CHANGE", now, dependencies);

  assert.equal(state.quota?.tariffIdAtPeriodStart, "paid-tariff");
  assert.equal(state.quota?.usedBytes, 0n);
  assert.equal(state.quota?.periodStartedAt.toISOString(), now.toISOString());
});

test("admin grant-tariff applies LOCAL_SQUAD entitlement instead of a Remnawave byte limit", async () => {
  const source = await readFile(new URL("../admin/admin.routes.ts", import.meta.url), "utf8");
  const route = source.slice(
    source.indexOf('adminRouter.post("/clients/:id/grant-tariff"'),
    source.indexOf("const grantExtendSchema"),
  );
  assert.match(route, /validateTrafficEntitlement\(/);
  assert.match(route, /trafficLimitBytes:\s*entitlement\.mode\s*===\s*"LOCAL_SQUAD"\s*\?\s*0n\s*:\s*effectiveTrafficLimit/);
  assert.match(route, /await applyTrafficEntitlement\(subResult\.data\.subscriptionId,\s*entitlement,\s*"NEW_PURCHASE"\)/);
});

test("client subscription list exposes the local traffic quota used by the bot", async () => {
  const source = await readFile(new URL("../client/client.routes.ts", import.meta.url), "utf8");
  const route = source.slice(
    source.indexOf('clientRouter.get("/subscription/all"'),
    source.indexOf('clientRouter.get("/subscription/:id/cooldown"'),
  );
  assert.match(route, /trafficQuota:\s*\{\s*include:\s*\{\s*grants:\s*true/);
  assert.match(route, /trafficQuota:\s*toClientTrafficQuota\(sub\.trafficQuota\)/);
});
