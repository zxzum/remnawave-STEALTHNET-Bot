import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";
process.env.REMNA_API_URL = "https://remna.test";
process.env.REMNA_ADMIN_TOKEN = "test-token";

const { prisma } = await import("../../db.js");
const { invalidateSystemConfigCache } = await import("../client/client.service.js");
const { redeemGiftCode } = await import("./gift.service.js");

type AnyRecord = Record<string, any>;

const future = new Date("2030-01-01T00:00:00.000Z");
const created = new Date("2029-12-01T00:00:00.000Z");

function makeHarness(options: { multi?: boolean; canonical?: boolean; failCanonicalUpdate?: boolean } = {}) {
  const canonical = options.canonical === false ? null : {
    id: "canonical-sub",
    ownerId: "recipient",
    remnawaveUuid: "working-uuid",
    remnawaveUsername: "recipient-user",
    remnawaveShortUuid: "working-short",
    subscriptionIndex: 0,
    tariffId: "old-tariff",
    giftStatus: null,
    giftedToClientId: null,
    purchasedAsGift: false,
    deletionRequestedAt: null,
    expireAt: future,
    createdAt: created,
    customPrice: 10,
    currentPricePerDay: 1,
    extraDevices: 0,
    extraDevicesMonthlyPrice: 0,
    trialId: null,
    trial: null,
  };
  const giftTariff = {
    id: "gift-tariff",
    name: "Gift tariff",
    durationDays: 30,
    trafficLimitBytes: 1_000n,
    price: 30,
    currency: "usd",
    deviceLimit: 1,
    includedDevices: 1,
    pricePerExtraDevice: 0,
    maxExtraDevices: 0,
    deviceDiscountTiers: null,
    internalSquadUuids: ["gift-squad"],
    trafficResetMode: "no_reset",
    trafficLimitMode: "REMNAWAVE" as const,
    meteredSquadUuid: null,
  };
  const giftSubscription: AnyRecord = {
    id: "gift-reserve",
    ownerId: "donor",
    remnawaveUuid: "gift-uuid",
    remnawaveUsername: "gift-user",
    remnawaveShortUuid: "gift-short",
    subscriptionIndex: 1,
    tariffId: giftTariff.id,
    giftStatus: "GIFT_RESERVED",
    giftedToClientId: null,
    purchasedAsGift: true,
    deletionRequestedAt: null,
    expireAt: future,
    createdAt: created,
    tariff: giftTariff,
  };
  const giftCode: AnyRecord = {
    id: "gift-code",
    code: "ABCD-EFGH-JKLM",
    status: "ACTIVE",
    expiresAt: future,
    creatorId: "donor",
    recipientRootClientId: null,
    redeemedById: null,
    redeemedAt: null,
    giftMessage: "Here",
    createdByAdmin: false,
    subscriptionId: giftSubscription.id,
    subscription: giftSubscription,
  };
  const state = {
    canonical,
    giftSubscription,
    giftCode,
    claimed: false,
    clientUpdates: [] as AnyRecord[],
    subscriptionUpdates: [] as AnyRecord[],
    deletedRows: [] as string[],
    deletedRemna: [] as string[],
    remnaCreates: [] as string[],
    remnaPatches: [] as AnyRecord[],
    giftHistory: [] as AnyRecord[],
  };

  const delegates = [
    [prisma.systemSetting, "findMany", async () => [
      { key: "gift_subscriptions_enabled", value: "true" },
      { key: "gift_code_expiry_hours", value: "72" },
      { key: "max_additional_subscriptions", value: "5" },
      { key: "gift_referral_enabled", value: "false" },
      { key: "multi_subscriptions_enabled", value: options.multi ? "true" : "false" },
    ]],
    [prisma.giftCode, "findFirst", async () => state.giftCode],
    [prisma.giftCode, "updateMany", async ({ data }: AnyRecord) => {
      if (state.claimed) return { count: 0 };
      state.claimed = true;
      Object.assign(state.giftCode, data);
      return { count: 1 };
    }],
    [prisma.giftCode, "update", async ({ data }: AnyRecord) => {
      Object.assign(state.giftCode, data);
      return state.giftCode;
    }],
    [prisma.client, "findUnique", async ({ where }: AnyRecord) => where.id === "recipient"
      ? { id: "recipient", telegramId: null, email: null }
      : { id: "donor", telegramId: null }],
    [prisma.client, "update", async ({ data }: AnyRecord) => {
      state.clientUpdates.push(data);
      return {};
    }],
    [prisma.subscription, "count", async () => state.canonical ? 1 : 0],
    [prisma.subscription, "findMany", async ({ where }: AnyRecord) => {
      if (where?.ownerId !== "recipient") return [];
      return state.canonical ? [state.canonical] : [];
    }],
    [prisma.subscription, "findUnique", async ({ where }: AnyRecord) => {
      if (where.ownerId_subscriptionIndex?.ownerId === "recipient" && where.ownerId_subscriptionIndex?.subscriptionIndex === 0) {
        return state.canonical;
      }
      if (where.id === "canonical-sub") return state.canonical;
      if (where.id === "gift-reserve") return state.giftSubscription;
      return null;
    }],
    [prisma.subscription, "update", async ({ where, data }: AnyRecord) => {
      state.subscriptionUpdates.push({ where, data });
      if (where.id === "canonical-sub" && state.canonical) {
        if (options.failCanonicalUpdate && data.expireAt) throw new Error("canonical database update failed");
        Object.assign(state.canonical, data);
      }
      if (where.id === "gift-reserve") Object.assign(state.giftSubscription, data);
      return where.id === "canonical-sub" ? state.canonical : state.giftSubscription;
    }],
    [prisma.subscription, "updateMany", async ({ where, data }: AnyRecord) => {
      if (where.id === "gift-reserve") Object.assign(state.giftSubscription, data);
      return { count: 1 };
    }],
    [prisma.subscription, "delete", async ({ where }: AnyRecord) => {
      state.deletedRows.push(where.id);
      return {};
    }],
    [prisma.giftHistory, "create", async ({ data }: AnyRecord) => {
      state.giftHistory.push(data);
      return {};
    }],
    [prisma.squadTrafficQuota, "findUnique", async () => null],
    [prisma.squadTrafficQuota, "deleteMany", async () => ({ count: 0 })],
  ] as const;

  const originals: Array<{ target: AnyRecord; key: string; value: unknown }> = [];
  for (const [target, key, value] of delegates) {
    const record = target as unknown as AnyRecord;
    originals.push({ target: record, key, value: record[key] });
    record[key] = value;
  }

  const prismaRecord = prisma as unknown as AnyRecord;
  originals.push({ target: prismaRecord, key: "$transaction", value: prismaRecord.$transaction });
  prismaRecord.$transaction = async (callback: (tx: AnyRecord) => Promise<unknown>) => callback({
    subscription: { delete: async ({ where }: AnyRecord) => {
      state.deletedRows.push(where.id);
      return {};
    } },
    squadTrafficQuota: { findUnique: async () => null, deleteMany: async () => ({ count: 0 }) },
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "POST") {
      if (!url.includes("/actions/")) state.remnaCreates.push(url);
      return new Response("{}", { status: 201 });
    }
    if (method === "DELETE") {
      state.deletedRemna.push(url.split("/").pop() ?? "");
      return new Response("{}", { status: 200 });
    }
    if (method === "PATCH") {
      const body = JSON.parse(String(init?.body ?? "{}")) as AnyRecord;
      state.remnaPatches.push(body);
      if (options.failCanonicalUpdate && body.uuid === "working-uuid") {
        return new Response(JSON.stringify({ message: "canonical update failed" }), { status: 503 });
      }
      return new Response("{}", { status: 200 });
    }
    const shortUuid = url.endsWith("working-uuid") ? "working-short" : "gift-short";
    return new Response(JSON.stringify({ response: {
      expireAt: "2029-12-20T00:00:00.000Z",
      activeInternalSquads: ["old-squad"],
      trafficLimitBytes: 100,
      userTraffic: { usedTrafficBytes: 0 },
      subscriptionUrl: `https://sub.lazeika.xyz/${shortUuid}`,
    } }), { status: 200 });
  };

  invalidateSystemConfigCache();

  return {
    state,
    async restore() {
      globalThis.fetch = originalFetch;
      invalidateSystemConfigCache();
      for (const original of originals.reverse()) original.target[original.key] = original.value;
    },
  };
}

async function redeem(harness: ReturnType<typeof makeHarness>) {
  try {
    const result = await redeemGiftCode("recipient", "ABCD-EFGH-JKLM");
    await new Promise<void>((resolve) => setImmediate(resolve));
    return result;
  } finally {
    await harness.restore();
  }
}

test("single-mode applies a gift to the recipient canonical subscription and preserves its UUID", async () => {
  const harness = makeHarness();
  const result = await redeem(harness);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.subscriptionId, "canonical-sub");
  assert.equal(result.data.subscriptionIndex, 0);
  assert.equal(harness.state.canonical?.remnawaveUuid, "working-uuid");
  assert.equal(harness.state.canonical?.remnawaveShortUuid, "working-short");
  assert.equal(harness.state.canonical?.remnawaveUsername, "recipient-user");
  assert.equal(result.data.subscriptionUrl, "https://sub.lazeika.xyz/working-short");
  assert.equal(harness.state.canonical?.tariffId, "gift-tariff");
  assert.deepEqual(harness.state.remnaCreates, []);
  assert.deepEqual(harness.state.deletedRemna, ["gift-uuid"]);
  assert.deepEqual(harness.state.deletedRows, ["gift-reserve"]);
  assert.ok(harness.state.remnaPatches.some((body) => body.uuid === "working-uuid"));
});

test("single-mode moves a gift reserve to index zero when the recipient has no subscription", async () => {
  const harness = makeHarness({ canonical: false });
  const result = await redeem(harness);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.subscriptionId, "gift-reserve");
  assert.equal(result.data.subscriptionIndex, 0);
  assert.equal(harness.state.giftSubscription.ownerId, "recipient");
  assert.equal(harness.state.giftSubscription.subscriptionIndex, 0);
  assert.equal(harness.state.giftSubscription.remnawaveUuid, "gift-uuid");
  assert.equal(harness.state.giftSubscription.remnawaveShortUuid, "gift-short");
  assert.equal(harness.state.giftSubscription.remnawaveUsername, "gift-user");
  assert.equal(result.data.subscriptionUrl, "https://sub.lazeika.xyz/gift-short");
  assert.ok(harness.state.clientUpdates.some((data) => data.remnawaveUuid === "gift-uuid"));
  assert.deepEqual(harness.state.deletedRows, []);
});

test("multi-mode keeps the gift as a separate subscription", async () => {
  const harness = makeHarness({ multi: true });
  const result = await redeem(harness);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.subscriptionId, "gift-reserve");
  assert.equal(result.data.subscriptionIndex, 1);
  assert.equal(harness.state.giftSubscription.ownerId, "recipient");
  assert.equal(harness.state.canonical?.remnawaveUuid, "working-uuid");
  assert.deepEqual(harness.state.deletedRows, []);
});

test("parallel redeem of one gift succeeds only once", async () => {
  const harness = makeHarness();
  try {
    const results = await Promise.all([
      redeemGiftCode("recipient", "ABCD-EFGH-JKLM"),
      redeemGiftCode("recipient", "ABCD-EFGH-JKLM"),
    ]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(results.filter((result) => !result.ok).length, 1);
    assert.equal(harness.state.claimed, true);
  } finally {
    await harness.restore();
  }
});

test("single-mode failure restores the gift claim without replacing the recipient UUID", async () => {
  const harness = makeHarness({ failCanonicalUpdate: true });
  const result = await redeem(harness);

  assert.equal(result.ok, false);
  assert.equal(harness.state.giftCode.status, "ACTIVE");
  assert.equal(harness.state.giftCode.redeemedById, null);
  assert.equal(harness.state.canonical?.remnawaveUuid, "working-uuid");
  assert.deepEqual(harness.state.deletedRows, []);
});
