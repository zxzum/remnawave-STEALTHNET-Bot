import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";

const { enforceExhaustedQuota, restoreMeteredSquad } = await import("./traffic-enforcement.service.js");

function memoryEnforcement(options: { squads?: unknown[]; getError?: string; updateError?: string; status?: string } = {}) {
  const quota = {
    id: "quota-1", subscriptionId: "sub-1", meteredSquadUuid: "whitelist", status: options.status ?? "EXHAUSTED",
    usedBytes: 100n, baseLimitBytes: 100n, subscription: { remnawaveUuid: "owning-user" },
  };
  const events: Array<Record<string, unknown>> = [];
  const patches: Array<Record<string, unknown>> = [];
  const dependencies = {
    prisma: {
      squadTrafficQuota: { findUnique: async () => quota },
      trafficQuotaEvent: { create: async ({ data }: { data: Record<string, unknown> }) => events.push(data) },
    },
    getRemnaUser: async () => options.getError
      ? { error: options.getError, status: 504 }
      : { data: { response: { activeInternalSquads: options.squads ?? ["default", "whitelist", "other"] } }, status: 200 },
    updateRemnaUser: async (body: Record<string, unknown>) => {
      patches.push(body);
      return options.updateError ? { error: options.updateError, status: 502 } : { data: {}, status: 200 };
    },
  };
  return { dependencies, events, patches };
}

test("exhaustion removes only the metered squad from the current owning user", async () => {
  const { dependencies, patches } = memoryEnforcement();
  const result = await enforceExhaustedQuota("sub-1", dependencies);

  assert.equal(result.ok, true);
  assert.deepEqual(patches, [{ uuid: "owning-user", activeInternalSquads: ["default", "other"] }]);
  assert.equal("expireAt" in patches[0]!, false);
  assert.equal("hwidDeviceLimit" in patches[0]!, false);
  assert.equal("trafficLimitBytes" in patches[0]!, false);
});

test("restore adds only the metered squad and both operations are idempotent", async () => {
  const restore = memoryEnforcement({ squads: ["default", "other"] });
  await restoreMeteredSquad("sub-1", restore.dependencies);
  assert.deepEqual(restore.patches, [{ uuid: "owning-user", activeInternalSquads: ["default", "other", "whitelist"] }]);

  const alreadyRemoved = memoryEnforcement({ squads: ["default", "other"] });
  await enforceExhaustedQuota("sub-1", alreadyRemoved.dependencies);
  assert.equal(alreadyRemoved.patches.length, 0);

  const alreadyRestored = memoryEnforcement();
  await restoreMeteredSquad("sub-1", alreadyRestored.dependencies);
  assert.equal(alreadyRestored.patches.length, 0);
});

test("object-form current squads are preserved and only the metered UUID is changed", async () => {
  const { dependencies, patches } = memoryEnforcement({ squads: [{ uuid: "default" }, { uuid: "whitelist" }, { uuid: "other" }] });
  await enforceExhaustedQuota("sub-1", dependencies);

  assert.deepEqual(patches[0]?.activeInternalSquads, ["default", "other"]);
});

test("Remnawave failure leaves quota fail-open and records a retryable event", async () => {
  const { dependencies, events, patches } = memoryEnforcement({ updateError: "patch failed" });
  const result = await enforceExhaustedQuota("sub-1", dependencies);

  assert.equal(result.ok, false);
  assert.equal(patches.length, 1);
  assert.equal(events[0]?.kind, "ENFORCEMENT_RETRYABLE");
  assert.equal((events[0]?.detail as { action?: string } | undefined)?.action, "REMOVE_METERED_SQUAD");
});
