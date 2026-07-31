import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../../db.js";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";

const service = (await import("./gift.service.js").catch(() => ({}))) as Record<string, unknown>;

test("additional subscription username is searchable by tg id and number", () => {
  assert.equal(typeof service.secondaryRemnaUsername, "function");
  const username = (service.secondaryRemnaUsername as (
    client: { id: string; telegramUsername: string; telegramId: string },
    index: number,
    entropy: string,
  ) => string)({ id: "client", telegramUsername: "alice", telegramId: "42" }, 2, "deadbeef");
  assert.equal(username, "tg42-3");
  assert.ok(username.length <= 36);
});

test("createAdditionalSubscription sends one exact Remnawave payload on collision failure", async () => {
  assert.equal(typeof service.createAdditionalSubscription, "function");
  const calls: Array<Record<string, unknown>> = [];
  const result = await (service.createAdditionalSubscription as (
    rootClientId: string,
    tariff: Record<string, unknown>,
    options: Record<string, unknown>,
    dependencies: Record<string, unknown>,
  ) => Promise<{ ok: boolean; error?: string; status?: number }>)(
    "client",
    {
      id: "tariff",
      durationDays: 30,
      trafficLimitBytes: 5_000n,
      deviceLimit: null,
      includedDevices: 2,
      maxExtraDevices: 4,
      internalSquadUuids: ["squad-a"],
      trafficResetMode: "monthly",
    },
    { skipConfigCheck: true, extraDevices: 3, purchasedAsGift: false },
    {
      isConfigured: () => true,
      loadConfig: async () => ({ giftSubscriptionsEnabled: true, maxAdditionalSubscriptions: 5 }),
      findRootClient: async () => ({
        id: "client",
        telegramUsername: "alice",
        telegramId: "42",
        email: " gift@example.com ",
      }),
      countSubscriptions: async () => 0,
      nextSubscriptionIndex: async () => 2,
      now: () => Date.parse("2026-07-19T12:00:00.000Z"),
      entropy: "deadbeef",
      request: async (body: Record<string, unknown>) => {
        calls.push(body);
        return { status: 400, error: "already exists" };
      },
    },
  );
  assert.deepEqual(calls, [
    {
      username: "tg42-3",
      trafficLimitBytes: 5_000,
      trafficLimitStrategy: "MONTH",
      expireAt: "2026-08-18T12:00:00.000Z",
      hwidDeviceLimit: 5,
      activeInternalSquads: ["squad-a"],
      telegramId: 42,
      email: "gift@example.com",
    },
  ]);
  assert.deepEqual(result, { ok: false, error: "Ошибка создания VPN-пользователя", status: 502 });
});

test("createRemnaGiftUserOnce safely retries a transient Remnawave create failure", async () => {
  const calls: Array<Record<string, unknown>> = [];
  let attempts = 0;
  const result = await (service.createRemnaGiftUserOnce as (
    input: Record<string, unknown>,
    request: (body: Record<string, unknown>) => Promise<Record<string, unknown>>,
    lookup: (username: string) => Promise<Record<string, unknown>>,
  ) => Promise<Record<string, unknown>>)(
    {
      rootClient: { id: "client", telegramUsername: "alice", telegramId: "42", email: "a@example.com" },
      subscriptionIndex: 0,
      entropy: "deadbeef",
      trafficLimitBytes: 5_000,
      trafficLimitStrategy: "NO_RESET",
      expireAt: "2026-08-18T12:00:00.000Z",
      hwidDeviceLimit: 2,
      internalSquadUuids: ["squad-a"],
      activeInternalSquads: ["squad-a"],
      purchasedAsGift: false,
    },
    async (body) => {
      calls.push(body);
      attempts++;
      return attempts === 1
        ? { status: 500, error: "fetch failed" }
        : { status: 201, data: { response: { uuid: "remna-recovered" } } };
    },
    async () => ({ status: 404, error: "not found" }),
  );
  assert.equal((result.data as { response?: { uuid?: string } })?.response?.uuid, "remna-recovered");
  assert.equal(attempts, 2);
  assert.equal(calls[0]?.username, "tg42");
  assert.deepEqual(calls[1], calls[0]);
});

test("createAdditionalSubscription persists the exact Remnawave username", async () => {
  const subscription = prisma.subscription as unknown as Record<string, unknown>;
  const client = prisma.client as unknown as Record<string, unknown>;
  const giftHistory = prisma.giftHistory as unknown as Record<string, unknown>;
  const originals = {
    subscriptionCreate: subscription.create,
    clientUpdate: client.update,
    giftHistoryCreate: giftHistory.create,
  };
  let createdData: Record<string, unknown> | undefined;
  subscription.create = async ({ data }: { data: Record<string, unknown> }) => {
    createdData = data;
    return { id: "sub-1" };
  };
  client.update = async () => ({});
  giftHistory.create = async () => ({});
  try {
    const result = await (service.createAdditionalSubscription as (
      rootClientId: string,
      tariff: Record<string, unknown>,
      options: Record<string, unknown>,
      dependencies: Record<string, unknown>,
    ) => Promise<{ ok: boolean }>)(
      "client",
      {
        id: "tariff",
        durationDays: 30,
        trafficLimitBytes: 0n,
        deviceLimit: 2,
        internalSquadUuids: ["squad-a"],
      },
      { skipConfigCheck: true },
      {
        isConfigured: () => true,
        loadConfig: async () => ({ giftSubscriptionsEnabled: true, maxAdditionalSubscriptions: 5 }),
        findRootClient: async () => ({ id: "client", telegramId: "42", telegramUsername: "alice" }),
        countSubscriptions: async () => 0,
        nextSubscriptionIndex: async () => 0,
        now: () => Date.parse("2026-07-19T12:00:00.000Z"),
        entropy: "deadbeef",
        request: async () => ({ status: 201, data: { response: { uuid: "remna-1" } } }),
      },
    );
    assert.equal(result.ok, true);
    assert.equal(createdData?.remnawaveUsername, "tg42");
  } finally {
    subscription.create = originals.subscriptionCreate;
    client.update = originals.clientUpdate;
    giftHistory.create = originals.giftHistoryCreate;
  }
});

test("gift identity binding records returned Remnawave errors for retry", async () => {
  assert.equal(typeof service.bindGiftSubscriptionIdentity, "function");
  const subscription = prisma.subscription as unknown as Record<string, unknown>;
  const originals = { findUnique: subscription.findUnique, update: subscription.update };
  const updates: Array<Record<string, unknown>> = [];
  const calls: Array<Record<string, unknown>> = [];
  subscription.findUnique = async () => ({ remnawaveUuid: "remna-gift" });
  subscription.update = async (args: Record<string, unknown>) => {
    updates.push(args);
    return {};
  };
  try {
    const result = await (service.bindGiftSubscriptionIdentity as (
      subscriptionId: string,
      identity: { telegramId?: number; email?: string },
      request: (body: Record<string, unknown>) => Promise<{ status: number; error?: string }>,
    ) => Promise<{ requiredFailure: boolean }>)(
      "sub-gift",
      { telegramId: 42, email: "gift@example.com" },
      async (body) => {
        calls.push(body);
        return { status: 503, error: "identity unavailable" };
      },
    );
    assert.equal(result.requiredFailure, true);
    assert.deepEqual(calls, [{ uuid: "remna-gift", telegramId: 42, email: "gift@example.com" }]);
    assert.equal((updates[0]?.data as Record<string, unknown>).syncStatus, "PENDING");
    assert.equal((updates[0]?.data as Record<string, unknown>).syncError, "identity unavailable");
  } finally {
    subscription.findUnique = originals.findUnique;
    subscription.update = originals.update;
  }
});
