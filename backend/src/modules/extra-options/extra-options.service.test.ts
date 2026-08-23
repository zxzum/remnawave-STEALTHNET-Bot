import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../../db.js";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";
process.env.REMNA_API_URL = "https://remna.test";
process.env.REMNA_ADMIN_TOKEN = "test-token";

const service = await import("./extra-options.service.js");

function queueHarness(options: {
  localFailures?: number;
  stalePrelockCustomPrice?: number;
  blockFirstLeasedValidation?: boolean;
  blockFirstPatch?: boolean;
  patchFailure?: "network" | number;
} = {}) {
  const paymentDelegate = prisma.payment as unknown as Record<string, unknown>;
  const subscriptionDelegate = prisma.subscription as unknown as Record<string, unknown>;
  const clientDelegate = prisma.client as unknown as Record<string, unknown>;
  const db = prisma as unknown as Record<string, unknown>;
  const originals = {
    payment: { ...paymentDelegate }, subscription: { ...subscriptionDelegate }, client: { ...clientDelegate },
    transaction: db.$transaction, fetch: globalThis.fetch,
  };
  const makePayment = (id: string, bytes: number, amount: number) => ({
    id, clientId: "client-1", subscriptionId: "sub-1", status: "PAID", amount,
    metadata: JSON.stringify({ keep: id, extraOption: { kind: "traffic", trafficBytes: bytes }, targetSubscriptionId: "sub-1" }),
    extraOptionState: "NEEDS_PLAN", extraOptionClaimToken: null, extraOptionNextAttemptAt: new Date(0), createdAt: new Date(id === "p1" ? 1 : 2),
  });
  const payments = new Map([["p1", makePayment("p1", 50, 5)], ["p2", makePayment("p2", 30, 7)]]);
  let remoteTraffic = 100;
  let local = { customPrice: 10, extraDevices: 0, extraDevicesMonthlyPrice: 0 };
  let localFailures = options.localFailures ?? 0;
  const patches: number[] = [];
  let txTail = Promise.resolve();
  let subscriptionReads = 0;
  let validationBlocked = false;
  let signalValidation!: () => void;
  let releaseValidation!: () => void;
  const validationReached = new Promise<void>((resolve) => { signalValidation = resolve; });
  const validationRelease = new Promise<void>((resolve) => { releaseValidation = resolve; });
  let patchCalls = 0;
  let signalPatch!: () => void;
  let releasePatch!: () => void;
  const patchReached = new Promise<void>((resolve) => { signalPatch = resolve; });
  const patchRelease = new Promise<void>((resolve) => { releasePatch = resolve; });

  const matches = (row: Record<string, unknown>, where: Record<string, unknown>): boolean => {
    if (where.id && typeof where.id === "string" && row.id !== where.id) return false;
    if (where.extraOptionState) {
      const expected = where.extraOptionState as string | { in?: string[] };
      if (typeof expected === "string" ? row.extraOptionState !== expected : !expected.in?.includes(String(row.extraOptionState))) return false;
    }
    if (where.extraOptionClaimToken && row.extraOptionClaimToken !== where.extraOptionClaimToken) return false;
    return true;
  };
  const paymentApi = {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const row = payments.get(where.id) ?? null;
      if (options.blockFirstLeasedValidation && row?.extraOptionState === "PENDING" && row.extraOptionClaimToken && !validationBlocked) {
        validationBlocked = true;
        signalValidation();
        await validationRelease;
      }
      return payments.get(where.id) ?? null;
    },
    findFirst: async ({ where }: { where: Record<string, unknown> }) => [...payments.values()].find((p) => {
      if (where.id && typeof where.id === "object" && (where.id as { not?: string }).not === p.id) return false;
      return matches(p, where);
    }) ?? null,
    findMany: async () => [...payments.values()].map(({ id }) => ({ id })),
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = payments.get(where.id)!; Object.assign(row, data); return row;
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const row = [...payments.values()].find((candidate) => matches(candidate, where));
      if (!row) return { count: 0 }; Object.assign(row, data); return { count: 1 };
    },
  };
  const subscriptionApi = {
    findUnique: async () => ({ graceUntil: null }),
    findFirst: async () => {
      subscriptionReads++;
      return {
        id: "sub-1", remnawaveUuid: "uuid-1", ownerId: "client-1", giftedToClientId: null,
        deletionRequestedAt: null,
        ...local,
        ...(subscriptionReads === 1 && options.stalePrelockCustomPrice !== undefined
          ? { customPrice: options.stalePrelockCustomPrice }
          : {}),
      };
    },
    update: async ({ data }: { data: Record<string, number> }) => {
      if (localFailures-- > 0) throw new Error("local write failed");
      local = { ...local, ...data }; return local;
    },
  };
  Object.assign(paymentDelegate, paymentApi);
  Object.assign(subscriptionDelegate, subscriptionApi);
  clientDelegate.update = async () => ({});
  clientDelegate.findUnique = async () => null;
  db.$transaction = async (callback: (tx: Record<string, unknown>) => Promise<unknown>) => {
    const previous = txTail;
    let release!: () => void;
    txTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await callback({ payment: paymentApi, subscription: { ...subscriptionApi, findUnique: async () => ({ graceUntil: null }) }, client: clientDelegate, $queryRawUnsafe: async () => [], $executeRaw: async () => 1 }); }
    finally { release(); }
  };
  globalThis.fetch = async (_input, init) => {
    if (!init?.method || init.method === "GET") return new Response(JSON.stringify({ response: { trafficLimitBytes: remoteTraffic, hwidDeviceLimit: 1, activeInternalSquads: [] } }), { status: 200 });
    const body = JSON.parse(String(init.body)) as { trafficLimitBytes: number };
    patchCalls++;
    patches.push(body.trafficLimitBytes);
    if (options.blockFirstPatch && patchCalls === 1) {
      signalPatch();
      await patchRelease;
    }
    if (options.patchFailure === "network") throw new Error("socket closed after write");
    if (typeof options.patchFailure === "number") {
      return new Response(JSON.stringify({ message: "explicit rejection" }), { status: options.patchFailure });
    }
    remoteTraffic = body.trafficLimitBytes;
    return new Response(JSON.stringify({ response: {} }), { status: 200 });
  };
  return {
    payments, patches,
    get remoteTraffic() { return remoteTraffic; }, get local() { return local; },
    setLocalCustomPrice(value: number) { local.customPrice = value; },
    async waitForLeasedValidation() {
      await Promise.race([
        validationReached,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("leased validation was not reached")), 50)),
      ]);
    },
    releaseLeasedValidation() { releaseValidation(); },
    async waitForPatch() {
      await Promise.race([
        patchReached,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("PATCH was not reached")), 50)),
      ]);
    },
    releasePatch() { releasePatch(); },
    restore() {
      for (const [key, value] of Object.entries(originals.payment)) paymentDelegate[key] = value;
      for (const [key, value] of Object.entries(originals.subscription)) subscriptionDelegate[key] = value;
      for (const [key, value] of Object.entries(originals.client)) clientDelegate[key] = value;
      db.$transaction = originals.transaction; globalThis.fetch = originals.fetch;
    },
  };
}

test("remote success plus local failure is quarantined and never replayed", async () => {
  const h = queueHarness({ localFailures: 1 });
  try {
    const first = await service.applyExtraOptionByPaymentId("p1");
    assert.equal(first.ok, false);
    if (!first.ok) assert.equal(first.phase, "PENDING");
    assert.equal(h.payments.get("p1")?.extraOptionState, "MANUAL_REVIEW");
    h.payments.get("p1")!.extraOptionNextAttemptAt = new Date(0);
    const replay = await service.applyExtraOptionByPaymentId("p1");
    assert.equal(replay.ok, false);
    assert.deepEqual(h.patches, [150]);
    assert.equal(h.remoteTraffic, 150);
    assert.equal(h.local.customPrice, 10);
  } finally { h.restore(); }
});

test("two distinct payments for one subscription serialize and both apply cumulatively", async () => {
  const h = queueHarness();
  try {
    const [a, b] = await Promise.all([service.applyExtraOptionByPaymentId("p1"), service.applyExtraOptionByPaymentId("p2")]);
    assert.ok(a.ok && b.ok);
    assert.equal([a, b].filter((r) => r.ok && r.outcome === "QUEUED").length, 1);
    const queuedId = h.payments.get("p1")?.extraOptionState === "APPLIED" ? "p2" : "p1";
    assert.deepEqual(await service.applyExtraOptionByPaymentId(queuedId), { ok: true, outcome: "APPLIED" });
    assert.equal(h.remoteTraffic, 180);
    assert.equal(h.local.customPrice, 22);
    assert.equal(h.payments.get("p1")?.extraOptionState, "APPLIED");
    assert.equal(h.payments.get("p2")?.extraOptionState, "APPLIED");
  } finally { h.restore(); }
});

test("stale PLANNING lease is reclaimed but a live lease remains queued", async () => {
  const h = queueHarness();
  try {
    const p1 = h.payments.get("p1")!;
    p1.extraOptionState = "PLANNING";
    p1.extraOptionNextAttemptAt = new Date(Date.now() + 60_000);
    assert.deepEqual(await service.applyExtraOptionByPaymentId("p1"), { ok: true, outcome: "QUEUED" });
    p1.extraOptionNextAttemptAt = new Date(0);
    assert.deepEqual(await service.applyExtraOptionByPaymentId("p1"), { ok: true, outcome: "APPLIED" });
  } finally { h.restore(); }
});

test("maintenance drain applies queued payments in deterministic order", async () => {
  const h = queueHarness();
  try {
    assert.deepEqual(await service.drainPaidExtraOptionQueue(10), { checked: 2, applied: 2, queued: 0, failed: 0 });
    assert.deepEqual(h.patches, [150, 180]);
  } finally { h.restore(); }
});

test("balance refund eligibility stops exactly at durable PENDING", () => {
  assert.equal(typeof service.canRefundExtraOptionFailure, "function");
  assert.equal(service.canRefundExtraOptionFailure({ ok: false, phase: "PRE_PENDING" }), true);
  assert.equal(service.canRefundExtraOptionFailure({ ok: false, phase: "PENDING" }), false);
  assert.equal(service.canRefundExtraOptionFailure({ ok: true, outcome: "QUEUED" }), false);
});

test("a stale PENDING worker loses its lease before PATCH and cannot overwrite newer payments", async () => {
  const h = queueHarness({ blockFirstLeasedValidation: true });
  try {
    const p1 = h.payments.get("p1")!;
    p1.extraOptionState = "PENDING";
    p1.extraOptionNextAttemptAt = new Date(0);
    p1.metadata = JSON.stringify({
      keep: "p1",
      extraOption: { kind: "traffic", trafficBytes: 50 },
      targetSubscriptionId: "sub-1",
      extraOptionApplication: {
        state: "PENDING", subscriptionId: "sub-1", uuid: "uuid-1",
        remote: { trafficLimitBytes: 150 }, local: { customPrice: 15 },
      },
    });

    const delayed = service.applyExtraOptionByPaymentId("p1");
    await h.waitForLeasedValidation();
    p1.extraOptionNextAttemptAt = new Date(0);
    assert.deepEqual(await service.applyExtraOptionByPaymentId("p1"), { ok: true, outcome: "APPLIED" });
    assert.deepEqual(await service.applyExtraOptionByPaymentId("p2"), { ok: true, outcome: "APPLIED" });
    h.releaseLeasedValidation();
    assert.deepEqual(await delayed, { ok: true, outcome: "QUEUED" });
    assert.deepEqual(h.patches, [150, 180]);
  } finally { h.releaseLeasedValidation(); h.restore(); }
});

test("a persisted plan whose UUID no longer owns the live subscription is quarantined without PATCH", async () => {
  const h = queueHarness();
  try {
    const p1 = h.payments.get("p1")!;
    p1.extraOptionState = "PENDING";
    p1.extraOptionNextAttemptAt = new Date(0);
    p1.metadata = JSON.stringify({
      extraOption: { kind: "traffic", trafficBytes: 50 },
      extraOptionApplication: {
        state: "PENDING", subscriptionId: "sub-1", uuid: "replaced-uuid",
        remote: { trafficLimitBytes: 150 }, local: { customPrice: 15 },
      },
    });
    const result = await service.applyExtraOptionByPaymentId("p1");
    assert.equal(result.ok, false);
    assert.equal(p1.extraOptionState, "MANUAL_REVIEW");
    assert.equal(p1.extraOptionClaimToken, null);
    assert.equal(p1.extraOptionNextAttemptAt, null);
    assert.deepEqual(h.patches, []);
    assert.match(p1.metadata, /binding/i);
  } finally { h.restore(); }
});

test("planning uses the subscription snapshot reread after FOR UPDATE", async () => {
  const h = queueHarness({ stalePrelockCustomPrice: 10 });
  try {
    h.setLocalCustomPrice(30);
    assert.deepEqual(await service.applyExtraOptionByPaymentId("p1"), { ok: true, outcome: "APPLIED" });
    assert.equal(h.local.customPrice, 35);
  } finally { h.restore(); }
});

test("a corrupt durable plan is quarantined once and removed from the retry loop", async () => {
  const h = queueHarness();
  try {
    const p1 = h.payments.get("p1")!;
    p1.extraOptionState = "PENDING";
    p1.extraOptionNextAttemptAt = new Date(0);
    p1.metadata = JSON.stringify({ extraOptionApplication: { broken: true } });
    const result = await service.applyExtraOptionByPaymentId("p1");
    assert.equal(result.ok, false);
    assert.equal(p1.extraOptionState, "MANUAL_REVIEW");
    assert.equal(p1.extraOptionNextAttemptAt, null);
    assert.deepEqual(h.patches, []);
  } finally { h.restore(); }
});

test("an in-flight APPLYING PATCH cannot be reclaimed or followed by a newer PATCH", async () => {
  const h = queueHarness({ blockFirstPatch: true });
  let workerA: ReturnType<typeof service.applyExtraOptionByPaymentId> | null = null;
  try {
    const p1 = h.payments.get("p1")!;
    p1.extraOptionState = "PENDING";
    p1.extraOptionNextAttemptAt = new Date(0);
    p1.metadata = JSON.stringify({
      extraOption: { kind: "traffic", trafficBytes: 50 },
      extraOptionApplication: {
        state: "PENDING", subscriptionId: "sub-1", uuid: "uuid-1",
        remote: { trafficLimitBytes: 150 }, local: { customPrice: 15 },
      },
    });

    workerA = service.applyExtraOptionByPaymentId("p1");
    await h.waitForPatch();
    assert.equal(p1.extraOptionState, "APPLYING");
    p1.extraOptionNextAttemptAt = new Date(0);
    const staleAttempt = await service.applyExtraOptionByPaymentId("p1");
    assert.equal(staleAttempt.ok, false);
    assert.equal(p1.extraOptionState, "MANUAL_REVIEW");
    assert.deepEqual(await service.applyExtraOptionByPaymentId("p2"), { ok: true, outcome: "QUEUED" });
    assert.deepEqual(h.patches, [150]);
    h.releasePatch();
    const delayedResult = await workerA;
    assert.equal(delayedResult.ok, false);
    assert.equal(p1.extraOptionState, "MANUAL_REVIEW");
    assert.deepEqual(h.patches, [150]);
  } finally {
    h.releasePatch();
    await workerA?.catch(() => {});
    h.restore();
  }
});

test("unknown PATCH outcome quarantines APPLYING instead of replaying it", async () => {
  const h = queueHarness({ patchFailure: "network" });
  try {
    const result = await service.applyExtraOptionByPaymentId("p1");
    assert.equal(result.ok, false);
    assert.equal(h.payments.get("p1")?.extraOptionState, "MANUAL_REVIEW");
    assert.equal(h.payments.get("p1")?.extraOptionNextAttemptAt, null);
    assert.deepEqual(h.patches, [150]);
  } finally { h.restore(); }
});

test("explicit definitive no-mutation PATCH rejection safely returns APPLYING to PENDING", async () => {
  const h = queueHarness({ patchFailure: 422 });
  try {
    const result = await service.applyExtraOptionByPaymentId("p1");
    assert.equal(result.ok, false);
    assert.equal(h.payments.get("p1")?.extraOptionState, "PENDING");
    assert.equal(h.payments.get("p1")?.extraOptionClaimToken, null);
    assert.ok(h.payments.get("p1")?.extraOptionNextAttemptAt instanceof Date);
    assert.deepEqual(h.patches, [150]);
  } finally { h.restore(); }
});

test("existing APPLIED and active APPLYING never report a fresh application", async () => {
  const h = queueHarness();
  try {
    const p1 = h.payments.get("p1")!;
    p1.extraOptionState = "APPLIED";
    assert.deepEqual(await service.applyExtraOptionByPaymentId("p1"), { ok: true, outcome: "ALREADY_APPLIED" });

    const p2 = h.payments.get("p2")!;
    p2.extraOptionState = "APPLYING";
    (p2 as unknown as { extraOptionClaimToken: string | null }).extraOptionClaimToken = "active-worker";
    p2.extraOptionNextAttemptAt = new Date(Date.now() + 60_000);
    assert.deepEqual(await service.applyExtraOptionByPaymentId("p2"), { ok: true, outcome: "QUEUED" });
    assert.deepEqual(h.patches, []);
  } finally { h.restore(); }
});
