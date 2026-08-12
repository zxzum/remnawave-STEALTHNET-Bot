import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";

const { runTrialPurchaseCleanup } = await import("./cleanup-trial-purchase-lock.js");

test("dry-run only reads candidates and never marks or deletes", async () => {
  const calls: string[] = [];
  const result = await runTrialPurchaseCleanup({ apply: false, batchSize: 10 }, {
    findPaidClients: async (afterId) => afterId ? [] : [{ id: "client-1", trialUsed: false }],
    markClient: async () => { calls.push("mark"); return { count: 1 }; },
    findTrialSubscriptions: async (afterId) => afterId ? [] : [{ id: "trial-1", ownerId: "client-1" }],
    deleteTrial: async () => { calls.push("delete"); return { deleted: true }; },
  });

  assert.deepEqual(result, {
    mode: "dry-run",
    paidClients: 1,
    flagsToSet: 1,
    trialCandidates: 1,
    deleted: 0,
    failed: 0,
  });
  assert.deepEqual(calls, []);
});

test("apply marks each owner before lifecycle deletion and keeps failures for retry", async () => {
  const calls: string[] = [];
  const result = await runTrialPurchaseCleanup({ apply: true, batchSize: 10 }, {
    findPaidClients: async (afterId) => afterId ? [] : [{ id: "client-1", trialUsed: false }],
    markClient: async (id) => { calls.push(`mark:${id}`); return { count: 1 }; },
    findTrialSubscriptions: async (afterId) => afterId ? [] : [
      { id: "trial-ok", ownerId: "client-1" },
      { id: "trial-retry", ownerId: "client-1" },
    ],
    deleteTrial: async (id) => {
      calls.push(`delete:${id}`);
      return { deleted: id === "trial-ok" };
    },
  });

  assert.deepEqual(result, {
    mode: "apply",
    paidClients: 1,
    flagsToSet: 1,
    trialCandidates: 2,
    deleted: 1,
    failed: 1,
  });
  assert.deepEqual(calls, ["mark:client-1", "mark:client-1", "delete:trial-ok", "mark:client-1", "delete:trial-retry"]);
});

test("apply continues when one lifecycle call throws", async () => {
  const calls: string[] = [];
  const result = await runTrialPurchaseCleanup({ apply: true, batchSize: 10 }, {
    findPaidClients: async (afterId) => afterId ? [] : [],
    markClient: async (id) => { calls.push(`mark:${id}`); return { count: 1 }; },
    findTrialSubscriptions: async (afterId) => afterId ? [] : [
      { id: "trial-throws", ownerId: "client-1" },
      { id: "trial-ok", ownerId: "client-1" },
    ],
    deleteTrial: async (id) => {
      calls.push(`delete:${id}`);
      if (id === "trial-throws") throw new Error("Remnawave unavailable");
      return { deleted: true };
    },
  });

  assert.equal(result.failed, 1);
  assert.equal(result.deleted, 1);
  assert.deepEqual(calls, ["mark:client-1", "delete:trial-throws", "mark:client-1", "delete:trial-ok"]);
});
