import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://support-test:support-test@127.0.0.1:5432/support-test";

const { annulClientForMigration } = await import("./annul.service.js");

function fakeDb(client: { isBlocked: boolean; balance: number } | null) {
  const calls: Array<[string, unknown]> = [];
  const tx = {
    client: {
      findUnique: async () => (client ? { telegramId: "42", balance: client.balance } : null),
      updateMany: async (args: { where: { isBlocked: boolean } }) => {
        calls.push(["client.updateMany", args]);
        return { count: client && !client.isBlocked ? 1 : 0 };
      },
    },
    subscription: {
      findMany: async () => [{ id: "s1", remnawaveUuid: "101" }, { id: "s2", remnawaveUuid: null }],
      updateMany: async (args: unknown) => { calls.push(["subscription.updateMany", args]); return { count: 1 }; },
    },
    payment: { updateMany: async (args: unknown) => { calls.push(["payment.updateMany", args]); return { count: 2 }; } },
  };
  const db = { client: { findUnique: async () => (client ? { id: "c1" } : null) }, $transaction: async (cb: (t: typeof tx) => unknown) => cb(tx) };
  return { db: db as never, calls };
}

test("annul detaches panel link, zeroes balance and cancels pending payments", async () => {
  const { db, calls } = fakeDb({ isBlocked: false, balance: 150 });
  const result = await annulClientForMigration("c1", undefined, db);
  assert.deepEqual(result, { status: "annulled", telegramId: "42", zeroedBalance: 150, detachedRemnawaveUuids: ["101"], cancelledPayments: 2 });
  const detach = calls.find(([name, a]) => name === "subscription.updateMany" && (a as { data: Record<string, unknown> }).data.remnawaveUuid === null);
  assert.ok(detach);
  const clientUpdate = calls.find(([name]) => name === "client.updateMany")![1] as { data: Record<string, unknown> };
  assert.equal(clientUpdate.data.remnawaveUuid, null);
  assert.equal(clientUpdate.data.isBlocked, true);
  assert.deepEqual(calls.find(([name]) => name === "payment.updateMany")![1], { where: { clientId: "c1", status: "PENDING" }, data: { status: "FAILED" } });
});

test("annul is idempotent on an already blocked client", async () => {
  const { db, calls } = fakeDb({ isBlocked: true, balance: 0 });
  const result = await annulClientForMigration("c1", undefined, db);
  assert.deepEqual(result, { status: "already_blocked", telegramId: "42" });
  assert.equal(calls.filter(([name]) => name !== "client.updateMany").length, 0);
});

test("annul reports an unknown client", async () => {
  const { db } = fakeDb(null);
  assert.deepEqual(await annulClientForMigration("nope", undefined, db), { status: "not_found" });
});
