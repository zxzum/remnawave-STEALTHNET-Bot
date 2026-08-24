import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { prisma } from "../../db.js";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";

const service = (await import("./single-subscription-lifecycle.service.js").catch(() => ({}))) as Record<string, unknown>;
const maintenance = (await import("./subscription-maintenance.cron.js").catch(() => ({}))) as Record<string, unknown>;
const syncService = (await import("../sync/sync.service.js").catch(() => ({}))) as Record<string, unknown>;

type Request = (uuid: string) => Promise<{ data?: unknown; error?: string; status: number }>;
type Operation = (subscriptionId: string, request?: Request) => Promise<{
  failures: Array<{ error: string }>;
  requiredFailure: boolean;
}>;

function mockSubscription(row: Record<string, unknown> | null) {
  const delegate = prisma.subscription as unknown as Record<string, unknown>;
  const originalFindUnique = delegate.findUnique;
  const originalUpdate = delegate.update;
  const updates: Array<Record<string, unknown>> = [];
  delegate.findUnique = async () => row;
  delegate.update = async (args: Record<string, unknown>) => {
    updates.push(args);
    return row;
  };
  return {
    updates,
    restore() {
      delegate.findUnique = originalFindUnique;
      delegate.update = originalUpdate;
    },
  };
}

function mockDeletion(row: Record<string, unknown>) {
  const subscription = prisma.subscription as unknown as Record<string, unknown>;
  const client = prisma.client as unknown as Record<string, unknown>;
  const db = prisma as unknown as Record<string, unknown>;
  const originals = {
    updateMany: subscription.updateMany,
    findUnique: subscription.findUnique,
    update: subscription.update,
    delete: subscription.delete,
    clientUpdate: client.update,
    transaction: db.$transaction,
  };
  const marked: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const deletes: Array<Record<string, unknown>> = [];
  const clientUpdates: Array<Record<string, unknown>> = [];
  const transactions: unknown[] = [];
  subscription.updateMany = async (args: Record<string, unknown>) => {
    marked.push(args);
    return { count: 1 };
  };
  subscription.findUnique = async () => row;
  subscription.update = async (args: Record<string, unknown>) => {
    updates.push(args);
    return row;
  };
  subscription.delete = (args: Record<string, unknown>) => {
    deletes.push(args);
    return Promise.resolve(row);
  };
  client.update = (args: Record<string, unknown>) => {
    clientUpdates.push(args);
    return Promise.resolve({});
  };
  db.$transaction = async (args: unknown) => {
    transactions.push(args);
    if (typeof args === "function") {
      return args({ subscription: { ...subscription, findFirst: async () => null }, client });
    }
    return [];
  };
  return {
    marked,
    updates,
    deletes,
    clientUpdates,
    transactions,
    restore() {
      subscription.updateMany = originals.updateMany;
      subscription.findUnique = originals.findUnique;
      subscription.update = originals.update;
      subscription.delete = originals.delete;
      client.update = originals.clientUpdate;
      db.$transaction = originals.transaction;
    },
  };
}

function mockExpiredSubscriptions(rows: Array<Record<string, unknown>>) {
  const subscription = prisma.subscription as unknown as Record<string, unknown>;
  const originals = {
    findMany: subscription.findMany,
    findUnique: subscription.findUnique,
    update: subscription.update,
  };
  const queries: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  subscription.findMany = async (args: Record<string, unknown>) => {
    queries.push(args);
    return rows;
  };
  subscription.findUnique = async (args: Record<string, unknown>) => {
    const id = (args.where as Record<string, unknown>).id;
    const row = rows.find((candidate) => candidate.id === id);
    // Полная строка для race-перечитывания под локом (expireAt/graceUntil сравниваются).
    return row ? {
      remnawaveUuid: row.remnawaveUuid,
      expireAt: row.expireAt ?? null,
      graceUntil: row.graceUntil ?? null,
      lazeikaOnlyNotificationSentFor: row.lazeikaOnlyNotificationSentFor ?? null,
      deletionRequestedAt: null,
      extraDevices: row.extraDevices ?? 0,
      tariffId: null,
    } : null;
  };
  subscription.update = async (args: Record<string, unknown>) => {
    updates.push(args);
    return {};
  };
  return {
    queries,
    updates,
    restore() {
      subscription.findMany = originals.findMany;
      subscription.findUnique = originals.findUnique;
      subscription.update = originals.update;
    },
  };
}

type ExpiredConfig = {
  expiredGraceEnabled: boolean;
  expiredGraceDays: number;
  expiredGraceSquadUuid: string | null;
};

type ProcessExpired = (
  limit: number,
  request: (body: Record<string, unknown>) => Promise<{ data?: unknown; error?: string; status: number }>,
  configLoader: () => Promise<ExpiredConfig>,
  now: Date,
  lazeikaGateLoader?: (config: ExpiredConfig) => Promise<{ enabled: boolean; days: number; squadUuid: string | null; ready: boolean }>,
  lock?: <T>(clientId: string, fn: () => Promise<T>) => Promise<T>,
  notify?: (telegramId: string, subscriptionId: string, daysLeft: number) => Promise<boolean>,
) => Promise<{ checked: number; grace: number; disabled: number; failed: number }>;

const noLock = async <T>(_clientId: string, fn: () => Promise<T>): Promise<T> => fn();

type SyncToRemna = (
  dependencies: {
    isConfigured: () => boolean;
    updateUser: (body: Record<string, unknown>) => Promise<{ data?: unknown; error?: string; status: number }>;
  },
  now: Date,
) => Promise<{ ok: boolean; updated: number; unlinked: number; errors: string[] }>;

const tariff = {
  trafficLimitBytes: 5_000n,
  trafficResetMode: "monthly",
  includedDevices: 2,
  internalSquadUuids: ["ordinary-squad"],
};

test("admin sync skips an active grace subscription instead of revoking grace", async () => {
  assert.equal(typeof syncService.syncToRemna, "function");
  const now = new Date("2026-07-18T12:00:00.000Z");
  const subscription = prisma.subscription as unknown as Record<string, unknown>;
  const originalFindMany = subscription.findMany;
  const calls: Array<Record<string, unknown>> = [];
  subscription.findMany = async () => [{
    id: "sub-grace-sync",
    remnawaveUuid: "remna-grace-sync",
    expireAt: new Date("2026-07-16T12:00:00.000Z"),
    graceUntil: new Date("2026-07-23T12:00:00.000Z"),
    extraDevices: 0,
    owner: { isBlocked: false, telegramId: null, email: null },
    tariff,
  }];
  try {
    const result = await (syncService.syncToRemna as SyncToRemna)({
      isConfigured: () => true,
      updateUser: async (body) => {
        calls.push(body);
        return { status: 200, data: {} };
      },
    }, now);
    assert.deepEqual(result, { ok: true, updated: 0, unlinked: 0, errors: [] });
    assert.deepEqual(calls, []);
  } finally {
    subscription.findMany = originalFindMany;
  }
});

test("enable вызывает Remnawave ровно один раз для UUID подписки", async () => {
  assert.equal(typeof service.enableSingleSubscription, "function");
  const mock = mockSubscription({ remnawaveUuid: "remna-one" });
  const calls: string[] = [];
  try {
    const result = await (service.enableSingleSubscription as Operation)("sub-one", async (uuid) => {
      calls.push(uuid);
      return { status: 200, data: { response: { uuid } } };
    });
    assert.deepEqual(calls, ["remna-one"]);
    assert.equal(result.requiredFailure, false);
  } finally {
    mock.restore();
  }
});

test("отсутствующий UUID возвращает доменную ошибку", async () => {
  assert.equal(typeof service.requireSubscriptionRemnaUuid, "function");
  const mock = mockSubscription({ remnawaveUuid: null });
  try {
    await assert.rejects(
      () => (service.requireSubscriptionRemnaUuid as (id: string) => Promise<string>)("sub-missing"),
      new Error("Подписка не привязана к Remnawave"),
    );
  } finally {
    mock.restore();
  }
});

test("ошибка Remnawave ставит retry в PENDING", async () => {
  assert.equal(typeof service.disableSingleSubscription, "function");
  const mock = mockSubscription({ remnawaveUuid: "remna-retry" });
  try {
    const result = await (service.disableSingleSubscription as Operation)("sub-retry", async () => ({
      status: 503,
      error: "temporary outage",
    }));
    assert.equal(result.requiredFailure, true);
    assert.deepEqual(mock.updates[0], {
      where: { id: "sub-retry" },
      data: {
        syncStatus: "PENDING",
        syncAttempts: { increment: 1 },
        syncError: "temporary outage",
        syncRequiredAt: mock.updates[0]?.data && (mock.updates[0].data as Record<string, unknown>).syncRequiredAt,
      },
    });
    assert.ok((mock.updates[0]?.data as Record<string, unknown>).syncRequiredAt instanceof Date);
  } finally {
    mock.restore();
  }
});

test("revoke обновляет только выбранную subscription", async () => {
  assert.equal(typeof service.revokeSingleSubscription, "function");
  const mock = mockSubscription({ remnawaveUuid: "remna-revoke" });
  const calls: string[] = [];
  try {
    await (service.revokeSingleSubscription as Operation)("sub-selected", async (uuid) => {
      calls.push(uuid);
      return { status: 200, data: { response: { uuid } } };
    });
    assert.deepEqual(calls, ["remna-revoke"]);
    assert.deepEqual(mock.updates.map((update) => update.where), [{ id: "sub-selected" }]);
  } finally {
    mock.restore();
  }
});

test("delete сохраняет tombstone и retry при сетевой ошибке", async () => {
  assert.equal(typeof service.deleteSingleSubscription, "function");
  const mock = mockDeletion({ ownerId: "owner", subscriptionIndex: 1, remnawaveUuid: "remna-delete" });
  try {
    const result = await (service.deleteSingleSubscription as (
      id: string,
      operation: "DELETE",
      request: Request,
    ) => Promise<{ deleted: boolean }>)("sub-delete", "DELETE", async () => {
      throw new Error("network down");
    });
    assert.equal(result.deleted, false);
    assert.deepEqual(mock.marked[0]?.where, { id: "sub-delete" });
    const tombstone = mock.marked[0]?.data as Record<string, unknown>;
    assert.equal(tombstone.deletionOperation, "DELETE");
    assert.equal(tombstone.autoRenewEnabled, false);
    assert.equal(tombstone.syncStatus, "PENDING");
    assert.ok(tombstone.deletionRequestedAt instanceof Date);
    assert.ok(tombstone.syncRequiredAt instanceof Date);
    assert.deepEqual(mock.updates[0]?.where, { id: "sub-delete" });
    const retry = mock.updates[0]?.data as Record<string, unknown>;
    assert.equal(retry.syncStatus, "PENDING");
    assert.deepEqual(retry.syncAttempts, { increment: 1 });
    assert.equal(retry.syncError, "network down");
    assert.ok(retry.syncRequiredAt instanceof Date);
    assert.equal(mock.transactions.length, 0);
  } finally {
    mock.restore();
  }
});

test("delete без owning UUID физически удаляет локальную Subscription", async () => {
  const mock = mockDeletion({ ownerId: "owner", subscriptionIndex: 1, remnawaveUuid: null });
  try {
    const result = await (service.deleteSingleSubscription as (
      id: string,
      operation: "DELETE",
      request: Request,
    ) => Promise<{ deleted: boolean; requiredFailure: boolean; failures: Array<{ error: string }> }>)(
      "sub-missing-uuid",
      "DELETE",
      async () => { throw new Error("must not call Remnawave"); },
    );
    assert.equal(result.deleted, true);
    assert.equal(result.requiredFailure, false);
    assert.deepEqual(result.failures, []);
    assert.deepEqual(mock.deletes, [{ where: { id: "sub-missing-uuid" } }]);
    assert.equal(mock.transactions.length, 1);
    assert.equal(mock.updates.length, 0);
  } finally {
    mock.restore();
  }
});

test("delete при 404 физически удаляет Subscription и сбрасывает primary legacy fields", async () => {
  const mock = mockDeletion({ ownerId: "owner", subscriptionIndex: 0, remnawaveUuid: "remna-primary" });
  const calls: string[] = [];
  try {
    const result = await (service.deleteSingleSubscription as (
      id: string,
      operation: "DELETE",
      request: Request,
    ) => Promise<{ deleted: boolean }>)("sub-primary", "DELETE", async (uuid) => {
      calls.push(uuid);
      return { status: 404, error: "not found" };
    });
    assert.equal(result.deleted, true);
    assert.deepEqual(calls, ["remna-primary"]);
    assert.deepEqual(mock.deletes, [{ where: { id: "sub-primary" } }]);
    assert.equal(mock.transactions.length, 1);
    assert.equal(mock.updates.length, 0);
    assert.equal((mock.marked[0]?.data as Record<string, unknown>).autoRenewEnabled, false);
    assert.deepEqual(mock.clientUpdates[0]?.where, { id: "owner" });
    const data = mock.clientUpdates[0]?.data as Record<string, unknown>;
    assert.equal(data.remnawaveUuid, null);
    assert.equal(data.currentTariffId, null);
    assert.equal(data.autoRenewEnabled, false);
  } finally {
    mock.restore();
  }
});

test("expired access activates grace for exactly one owning Remnawave UUID", async () => {
  assert.equal(typeof service.processExpiredSingleSubscriptionAccess, "function");
  const now = new Date("2026-07-18T12:00:00.000Z");
  const expireAt = new Date("2026-07-16T12:00:00.000Z");
  const graceUntil = new Date("2026-07-23T12:00:00.000Z");
  const mock = mockExpiredSubscriptions([{
    id: "sub-grace",
    remnawaveUuid: "remna-grace",
    expireAt,
    graceUntil: null,
    extraDevices: 3,
    tariff,
  }]);
  const calls: Array<Record<string, unknown>> = [];
  try {
    const result = await (service.processExpiredSingleSubscriptionAccess as ProcessExpired)(
      10,
      async (body) => {
        calls.push(body);
        return { status: 200, data: {} };
      },
      async () => ({ expiredGraceEnabled: true, expiredGraceDays: 7, expiredGraceSquadUuid: "grace-squad" }),
      now,
      undefined,
      noLock,
    );
    assert.deepEqual(result, { checked: 1, grace: 1, disabled: 0, failed: 0 });
    assert.deepEqual(calls, [{
      uuid: "remna-grace",
      expireAt: graceUntil.toISOString(),
      status: "ACTIVE",
      trafficLimitBytes: 0,
      trafficLimitStrategy: "NO_RESET",
      hwidDeviceLimit: 5,
      activeInternalSquads: ["grace-squad"],
    }]);
    assert.deepEqual(mock.queries[0]?.where, { expireAt: { lte: now }, deletionRequestedAt: null });
    assert.equal(((mock.queries[0]?.select as Record<string, unknown>).remnawaveUuid), true);
    // Remna-успех пишется первым, graceUntil — только после него (§4.1.6).
    assert.equal(mock.updates.length, 2);
    assert.deepEqual(mock.updates[1], { where: { id: "sub-grace" }, data: { graceUntil } });
  } finally {
    mock.restore();
  }
});

test("grace sends a separate Telegram notice once and marks the delivery", async () => {
  const now = new Date("2026-07-18T12:00:00.000Z");
  const expireAt = new Date("2026-07-16T12:00:00.000Z");
  const graceUntil = new Date("2026-07-23T12:00:00.000Z");
  const mock = mockExpiredSubscriptions([{
    id: "sub-grace-notice",
    remnawaveUuid: "remna-grace-notice",
    expireAt,
    graceUntil: null,
    lazeikaOnlyNotificationSentFor: null,
    extraDevices: 0,
    ownerId: "owner-grace-notice",
    owner: { telegramId: "8848283400" },
    tariff,
  }]);
  const notices: Array<{ telegramId: string; subscriptionId: string; daysLeft: number }> = [];
  try {
    await (service.processExpiredSingleSubscriptionAccess as ProcessExpired)(
      10,
      async () => ({ status: 200, data: {} }),
      async () => ({ expiredGraceEnabled: true, expiredGraceDays: 7, expiredGraceSquadUuid: "grace-squad" }),
      now,
      undefined,
      noLock,
      async (telegramId, subscriptionId, daysLeft) => {
        notices.push({ telegramId, subscriptionId, daysLeft });
        return true;
      },
    );
    assert.deepEqual(notices, [{ telegramId: "8848283400", subscriptionId: "sub-grace-notice", daysLeft: 5 }]);
    assert.deepEqual(mock.updates[2], {
      where: { id: "sub-grace-notice" },
      data: { lazeikaOnlyNotificationSentFor: graceUntil },
    });
  } finally {
    mock.restore();
  }
});

test("elapsed grace disables one user without extending the original expiry", async () => {
  const now = new Date("2026-07-18T12:00:00.000Z");
  const expireAt = new Date("2026-07-08T12:00:00.000Z");
  const mock = mockExpiredSubscriptions([{
    id: "sub-elapsed",
    remnawaveUuid: "remna-elapsed",
    expireAt,
    graceUntil: new Date("2026-07-15T12:00:00.000Z"),
    extraDevices: 1,
    tariff,
  }]);
  const calls: Array<Record<string, unknown>> = [];
  try {
    const result = await (service.processExpiredSingleSubscriptionAccess as ProcessExpired)(
      10,
      async (body) => { calls.push(body); return { status: 200, data: {} }; },
      async () => ({ expiredGraceEnabled: true, expiredGraceDays: 7, expiredGraceSquadUuid: "grace-squad" }),
      now,
      undefined,
      noLock,
    );
    assert.deepEqual(result, { checked: 1, grace: 0, disabled: 1, failed: 0 });
    assert.equal(calls[0]?.uuid, "remna-elapsed");
    assert.equal(calls[0]?.expireAt, expireAt.toISOString());
    assert.equal(calls[0]?.status, "DISABLED");
    // §4.2: рабочий тарифный squad не оставляем.
    assert.deepEqual(calls[0]?.activeInternalSquads, []);
    assert.equal(mock.updates.length, 2);
    assert.deepEqual(mock.updates[1], {
      where: { id: "sub-elapsed" },
      data: { graceUntil: null, lazeikaOnlyNotificationSentFor: null },
    });
  } finally {
    mock.restore();
  }
});

test("disabled grace configuration preserves past expiry and disables access", async () => {
  const now = new Date("2026-07-18T12:00:00.000Z");
  const expireAt = new Date("2026-07-17T12:00:00.000Z");
  const mock = mockExpiredSubscriptions([{
    id: "sub-no-grace",
    remnawaveUuid: "remna-no-grace",
    expireAt,
    graceUntil: null,
    extraDevices: 0,
    tariff,
  }]);
  const calls: Array<Record<string, unknown>> = [];
  try {
    await (service.processExpiredSingleSubscriptionAccess as ProcessExpired)(
      10,
      async (body) => { calls.push(body); return { status: 200, data: {} }; },
      async () => ({ expiredGraceEnabled: false, expiredGraceDays: 7, expiredGraceSquadUuid: "grace-squad" }),
      now,
      undefined,
      noLock,
    );
    assert.equal(calls[0]?.expireAt, expireAt.toISOString());
    assert.equal(calls[0]?.status, "DISABLED");
    assert.equal(calls[0]?.hwidDeviceLimit, 2);
    assert.equal(mock.updates.length, 1, "only the shared success writer updates an unchanged graceUntil");
  } finally {
    mock.restore();
  }
});

test("active grace is not recomputed when the global days setting changes", async () => {
  const now = new Date("2026-07-18T12:00:00.000Z");
  const expireAt = new Date("2026-07-16T12:00:00.000Z");
  const fixedGraceUntil = new Date("2026-07-20T12:00:00.000Z"); // уже выдан по старым настройкам
  const mock = mockExpiredSubscriptions([{
    id: "sub-fixed",
    remnawaveUuid: "remna-fixed",
    expireAt,
    graceUntil: fixedGraceUntil,
    extraDevices: 0,
    tariff,
  }]);
  const calls: Array<Record<string, unknown>> = [];
  try {
    const result = await (service.processExpiredSingleSubscriptionAccess as ProcessExpired)(
      10,
      async (body) => { calls.push(body); return { status: 200, data: {} }; },
      async () => ({ expiredGraceEnabled: true, expiredGraceDays: 30, expiredGraceSquadUuid: "grace-squad" }),
      now,
      undefined,
      noLock,
    );
    assert.deepEqual(result, { checked: 1, grace: 1, disabled: 0, failed: 0 });
    // expireAt остаётся прежним graceUntil — пересчёта нет.
    assert.equal(calls[0]?.expireAt, fixedGraceUntil.toISOString());
    assert.equal(calls[0]?.status, "ACTIVE");
    // graceUntil не перезаписывается: только success-writer.
    assert.equal(mock.updates.length, 1);
  } finally {
    mock.restore();
  }
});

test("not-ready Lazeika-Only infrastructure disables instead of granting grace", async () => {
  const now = new Date("2026-07-18T12:00:00.000Z");
  const expireAt = new Date("2026-07-17T12:00:00.000Z");
  const mock = mockExpiredSubscriptions([{
    id: "sub-notready",
    remnawaveUuid: "remna-notready",
    expireAt,
    graceUntil: null,
    extraDevices: 0,
    tariff,
  }]);
  const calls: Array<Record<string, unknown>> = [];
  try {
    const result = await (service.processExpiredSingleSubscriptionAccess as ProcessExpired)(
      10,
      async (body) => { calls.push(body); return { status: 200, data: {} }; },
      async () => ({ expiredGraceEnabled: true, expiredGraceDays: 7, expiredGraceSquadUuid: null }),
      now,
      async () => ({ enabled: true, days: 7, squadUuid: "grace-squad", ready: false }),
      noLock,
    );
    assert.deepEqual(result, { checked: 1, grace: 0, disabled: 1, failed: 0 });
    assert.equal(calls[0]?.status, "DISABLED");
    assert.equal(mock.updates.length, 1, "no graceUntil write for disabled path");
  } finally {
    mock.restore();
  }
});

test("Remnawave failure does not persist graceUntil", async () => {
  const now = new Date("2026-07-18T12:00:00.000Z");
  const mock = mockExpiredSubscriptions([{
    id: "sub-fail",
    remnawaveUuid: "remna-fail",
    expireAt: new Date("2026-07-17T12:00:00.000Z"),
    graceUntil: null,
    extraDevices: 0,
    tariff,
  }]);
  try {
    const result = await (service.processExpiredSingleSubscriptionAccess as ProcessExpired)(
      10,
      async () => ({ status: 502, error: "boom" }),
      async () => ({ expiredGraceEnabled: true, expiredGraceDays: 7, expiredGraceSquadUuid: "grace-squad" }),
      now,
      undefined,
      noLock,
    );
    assert.deepEqual(result, { checked: 1, grace: 0, disabled: 0, failed: 1 });
    const failure = mock.updates[0]?.data as Record<string, unknown>;
    assert.equal(failure.syncStatus, "PENDING");
    assert.equal("graceUntil" in failure, false, "graceUntil не пишется до успеха");
  } finally {
    mock.restore();
  }
});

test("disabling the feature closes an already active grace on the next tick", async () => {
  const now = new Date("2026-07-18T12:00:00.000Z");
  const expireAt = new Date("2026-07-16T12:00:00.000Z");
  const fixedGraceUntil = new Date("2026-07-25T12:00:00.000Z");
  const mock = mockExpiredSubscriptions([{
    id: "sub-disable-grace",
    remnawaveUuid: "remna-disable-grace",
    expireAt,
    graceUntil: fixedGraceUntil,
    extraDevices: 0,
    tariff,
  }]);
  const calls: Array<Record<string, unknown>> = [];
  try {
    const result = await (service.processExpiredSingleSubscriptionAccess as ProcessExpired)(
      10,
      async (body) => { calls.push(body); return { status: 200, data: {} }; },
      async () => ({ expiredGraceEnabled: false, expiredGraceDays: 7, expiredGraceSquadUuid: null }),
      now,
      // Функция выключена после выдачи grace → активный доступ закрывается (§4.4 disable).
      async () => ({ enabled: false, days: 7, squadUuid: "grace-squad", ready: true }),
      noLock,
    );
    assert.deepEqual(result, { checked: 1, grace: 0, disabled: 1, failed: 0 });
    assert.equal(calls[0]?.status, "DISABLED");
    assert.deepEqual(calls[0]?.activeInternalSquads, []);
    assert.equal(mock.updates.length, 2);
    assert.deepEqual(mock.updates[1], {
      where: { id: "sub-disable-grace" },
      data: { graceUntil: null, lazeikaOnlyNotificationSentFor: null },
    });
  } finally {
    mock.restore();
  }
});

test("expired access missing UUID records PENDING without an API call", async () => {
  const now = new Date("2026-07-18T12:00:00.000Z");
  const mock = mockExpiredSubscriptions([{
    id: "sub-expired-missing",
    remnawaveUuid: null,
    expireAt: new Date("2026-07-17T12:00:00.000Z"),
    graceUntil: null,
    extraDevices: 0,
    tariff,
  }]);
  let calls = 0;
  try {
    const result = await (service.processExpiredSingleSubscriptionAccess as ProcessExpired)(
      10,
      async () => { calls++; return { status: 200 }; },
      async () => ({ expiredGraceEnabled: false, expiredGraceDays: 0, expiredGraceSquadUuid: null }),
      now,
      undefined,
      noLock,
    );
    assert.deepEqual(result, { checked: 1, grace: 0, disabled: 0, failed: 1 });
    assert.equal(calls, 0);
    const failure = mock.updates[0]?.data as Record<string, unknown>;
    assert.equal(failure.syncStatus, "PENDING");
    assert.equal(failure.syncError, "Подписка не привязана к Remnawave");
  } finally {
    mock.restore();
  }
});

test("maintenance retries only single-user deletion tombstones", async () => {
  assert.equal(typeof maintenance.retryPendingSubscriptionDeletions, "function");
  const delegate = prisma.subscription as unknown as Record<string, unknown>;
  const originalFindMany = delegate.findMany;
  const queries: Array<Record<string, unknown>> = [];
  const calls: unknown[][] = [];
  delegate.findMany = async (args: Record<string, unknown>) => {
    queries.push(args);
    return [
      { id: "delete-one", deletionOperation: "DELETE" },
      { id: "revoke-one", deletionOperation: "REVOKE" },
    ];
  };
  try {
    const result = await (maintenance.retryPendingSubscriptionDeletions as (
      limit: number,
      remove: (...args: unknown[]) => Promise<{ deleted: boolean }>,
    ) => Promise<{ deleted: number; failed: number }>)(10, async (...args) => {
      calls.push(args);
      return { deleted: true };
    });
    assert.deepEqual(calls, [["delete-one", "DELETE"], ["revoke-one", "REVOKE"]]);
    assert.deepEqual(result, { deleted: 2, failed: 0 });
    assert.deepEqual(queries[0]?.where, {
      deletionRequestedAt: { not: null },
      deletionOperation: { in: ["DELETE", "REVOKE"] },
      syncStatus: "PENDING",
      syncRequiredAt: { lte: queries[0]?.where && ((queries[0].where as Record<string, unknown>).syncRequiredAt as Record<string, unknown>).lte },
    });
  } finally {
    delegate.findMany = originalFindMany;
  }
});

test("maintenance runs single-user expiry before deletion retries", async () => {
  assert.equal(typeof maintenance.runSubscriptionMaintenance, "function");
  const calls: unknown[][] = [];
  const result = await (maintenance.runSubscriptionMaintenance as (
    expiry: (limit: number) => Promise<Record<string, number>>,
    deletions: (limit: number) => Promise<Record<string, number>>,
    extraOptions: (limit: number) => Promise<Record<string, number>>,
  ) => Promise<Record<string, unknown>>)(
    async (...args) => { calls.push(["expiry", ...args]); return { checked: 1, grace: 1, disabled: 0, failed: 0 }; },
    async (...args) => { calls.push(["deletions", ...args]); return { deleted: 1, failed: 0 }; },
    async (...args) => { calls.push(["extraOptions", ...args]); return { checked: 1, applied: 1, queued: 0, failed: 0 }; },
  );
  assert.deepEqual(calls, [["expiry", 200], ["deletions", 50], ["extraOptions", 50]]);
  assert.deepEqual(result, {
    expiry: { checked: 1, grace: 1, disabled: 0, failed: 0 },
    deletions: { deleted: 1, failed: 0 },
    extraOptions: { checked: 1, applied: 1, queued: 0, failed: 0 },
    expiryNotifications: 0,
    onboardingNotifications: 0,
  });
});

test("maintenance source has no component-service lifecycle dependency", async () => {
  const [source, lifecycle] = await Promise.all([
    readFile(new URL("./subscription-maintenance.cron.ts", import.meta.url), "utf8"),
    readFile(new URL("./single-subscription-lifecycle.service.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(
    source,
    /processExpiredSubscriptionAccess|subscription-components\.service|synchronizeSubscriptionComponents|reconcileSubscriptionComponents/,
  );
  assert.doesNotMatch(lifecycle, /subscription-components\.service|remnawaveComponent|synchronizeSubscriptionComponents/);
  assert.match(lifecycle, /tx\.subscription\.delete/);
  assert.match(source, /deleteSingleSubscription/);
  assert.match(source, /processExpiredSingleSubscriptionAccess/);
  assert.match(lifecycle, /hwidDeviceLimit:\s*Math\.max\(1,\s*subscription\.tariff\.includedDevices\s*\+\s*subscription\.extraDevices\)/);
});

test("HWID limit always uses includedDevices plus subscription extraDevices", async () => {
  const [bulk, sync, admin] = await Promise.all([
    readFile(new URL("../client/client-bulk-ops.service.ts", import.meta.url), "utf8"),
    readFile(new URL("../sync/sync.service.ts", import.meta.url), "utf8"),
    readFile(new URL("../admin/admin.routes.ts", import.meta.url), "utf8"),
  ]);
  assert.match(bulk, /hwidDeviceLimit:\s*Math\.max\(1,\s*tariff\.includedDevices\s*\+\s*sub\.extraDevices\)/);
  assert.match(bulk, /hwidDeviceLimit:\s*Math\.max\(1,\s*sub\.tariff\.includedDevices\s*\+\s*sub\.extraDevices\)/);
  assert.doesNotMatch(bulk, /hwidDeviceLimit:\s*sub\.tariff\.deviceLimit/);
  assert.match(sync, /hwidDeviceLimit:\s*Math\.max\(1,\s*subscription\.tariff\.includedDevices\s*\+\s*subscription\.extraDevices\)/);
  assert.match(admin, /deviceLimit:\s*sub\.tariff\s*\?\s*Math\.max\(1,\s*sub\.tariff\.includedDevices\s*\+\s*sub\.extraDevices\)/);
});

test("pull sync skips legacy managed component usernames", () => {
  assert.equal(typeof syncService.isLegacyManagedComponentUsername, "function");
  const isManaged = syncService.isLegacyManagedComponentUsername as (username: string | null) => boolean;
  assert.equal(isManaged("alice_c_whitelist_2"), true);
  assert.equal(isManaged("alice_WL"), true);
  assert.equal(isManaged("alice"), false);
  assert.equal(isManaged(null), false);
});
