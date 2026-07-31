import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";

const { buildCutoverInventory, buildReplacementPayload, parseCutoverArgs, runCutoverInventory, runReplacementCutover, cleanupLegacyUsers } = await import("./migrate-composite-to-single.js");

const rows = [
  { id: "active", ownerId: "c1", createdAt: new Date("2026-01-01"), expireAt: new Date("2026-08-01"), tariffId: "t1", remnawaveUuid: "single", deletionRequestedAt: null, tariff: { internalSquadUuids: ["wl"], trafficLimitMode: "LOCAL_SQUAD" } },
  { id: "expired", ownerId: "c2", createdAt: new Date("2026-01-01"), expireAt: new Date("2026-02-01"), tariffId: "t1", remnawaveUuid: "old", deletionRequestedAt: null, tariff: { internalSquadUuids: ["wl"], trafficLimitMode: "REMNAWAVE" } },
  { id: "tombstone", ownerId: "c3", createdAt: new Date("2026-01-01"), expireAt: null, tariffId: null, remnawaveUuid: "deleted", deletionRequestedAt: new Date("2026-03-01"), tariff: null },
];

test("default CLI arguments are dry-run and apply is explicit", () => {
  assert.deepEqual(parseCutoverArgs([]), { apply: false, dryRun: true, resume: false, cleanupLegacy: false, subscriptionId: null });
  assert.equal(parseCutoverArgs(["--apply", "--subscription", "active"]).apply, true);
});

test("inventory includes active, expired, and already-single subscriptions", async () => {
  const inventory = await buildCutoverInventory(rows as any, async () => null);

  assert.deepEqual(inventory.map((item) => item.subscriptionId), ["active", "expired", "tombstone"]);
  assert.equal(inventory[0]?.canonicalUuid, "single");
  assert.equal(inventory[1]?.active, false);
  assert.deepEqual(inventory[2]?.blockers, ["CLEANUP_ONLY_TOMBSTONE"]);
});

test("tariffless non-tombstone subscription is an apply blocker", async () => {
  const inventory = await buildCutoverInventory([{
    ...rows[1], id: "tariffless", tariffId: null, tariff: null,
  }] as any, async () => null);

  assert.deepEqual(inventory[0]?.blockers, ["MISSING_TARIFF"]);
});

test("trial subscription uses its trial policy instead of requiring a paid tariff", async () => {
  const inventory = await buildCutoverInventory([{
    ...rows[1], id: "trial-sub", tariffId: "paid-tariff", tariff: { internalSquadUuids: ["paid-squad"], trafficLimitMode: "REMNAWAVE" }, trialId: "trial-1",
    trial: { trafficLimitMode: "LOCAL_SQUAD", tariff: { internalSquadUuids: ["trial-squad"], trafficLimitMode: "REMNAWAVE" } },
  }] as any, async () => null);

  assert.deepEqual(inventory[0]?.targetSquads, ["trial-squad"]);
  assert.equal(inventory[0]?.trafficLimitMode, "LOCAL_SQUAD");
  assert.deepEqual(inventory[0]?.blockers, []);
});

test("LOCAL_SQUAD cutover preserves the trial byte limit", async () => {
  const script = await import("./migrate-composite-to-single.js");
  assert.equal(script.localSquadQuotaLimit("5368709120"), 5368709120n);
});

test("post-cleanup inventory retains only the current subscription UUID", async () => {
  const inventory = await buildCutoverInventory([rows[0]] as any, async () => null);
  assert.deepEqual(inventory[0]?.oldUuids, ["single"]);
});

test("dry-run never writes a journal or calls Remnawave", async () => {
  let writes = 0;
  let remnaReads = 0;
  const result = await runCutoverInventory(parseCutoverArgs([]), {
    listSubscriptions: async () => rows as any,
    getCanonicalUser: async () => { remnaReads++; return null; },
    writeJournal: async () => { writes++; },
  });

  assert.equal(result.mutated, false);
  assert.equal(writes, 0);
  assert.equal(remnaReads, 0);
});

test("apply journals a snapshot for each eligible inventory row", async () => {
  const kinds: string[] = [];
  const result = await runCutoverInventory(parseCutoverArgs(["--apply"]), {
    listSubscriptions: async () => rows as any,
    getCanonicalUser: async () => null,
    writeJournal: async (kind) => { kinds.push(kind); },
  });

  assert.equal(result.mutated, true);
  assert.deepEqual(kinds, ["subscription.cutover.snapshot", "subscription.cutover.snapshot", "subscription.cutover.snapshot"]);
});

test("apply stops before journaling when a subscription lacks its tariff", async () => {
  let writes = 0;
  await assert.rejects(runCutoverInventory(parseCutoverArgs(["--apply"]), {
    listSubscriptions: async () => [{ ...rows[1], tariffId: null, tariff: null }] as any,
    getCanonicalUser: async () => null,
    writeJournal: async () => { writes++; },
  }), /MISSING_TARIFF/);
  assert.equal(writes, 0);
});

test("LOCAL_SQUAD replacement payload preserves exact dates and starts Remnawave at zero", () => {
  const payload = buildReplacementPayload({
    subscriptionId: "sub-1", username: "ordinary-sub-1", createdAt: "2026-01-01T00:00:00.000Z", expireAt: "2026-02-01T00:00:00.000Z",
    squads: ["wl"], deviceLimit: 3, trafficLimitMode: "LOCAL_SQUAD", trafficLimitBytes: 999n,
  });
  assert.deepEqual(payload, { username: "ordinary-sub-1", createdAt: "2026-01-01T00:00:00.000Z", expireAt: "2026-02-01T00:00:00.000Z", status: "ACTIVE", activeInternalSquads: ["wl"], trafficLimitBytes: 0, trafficLimitStrategy: "NO_RESET", hwidDeviceLimit: 3 });
});

test("replacement payload carries searchable owner identity", () => {
  const payload = buildReplacementPayload({
    subscriptionId: "sub-1", username: "tg42-2", telegramId: "42", email: " user@example.com ",
    createdAt: "2026-01-01T00:00:00.000Z", expireAt: "2026-02-01T00:00:00.000Z",
    squads: ["wl"], deviceLimit: 1, trafficLimitMode: "REMNAWAVE", trafficLimitBytes: 100n,
  });
  assert.equal(payload.telegramId, 42);
  assert.equal(payload.email, "user@example.com");
});

test("replacement verifies direct URL, owner identity, and tariff before atomic local switch", async () => {
  const calls: string[] = [];
  const result = await runReplacementCutover({ subscriptionId: "sub-1", ownerId: "c1", subscriptionIndex: 0, telegramId: "42", email: "user@example.com", createdAt: "2026-01-01T00:00:00.000Z", expireAt: "2026-02-01T00:00:00.000Z", squads: ["wl"], deviceLimit: 1, trafficLimitMode: "LOCAL_SQUAD", trafficLimitBytes: 100n }, {
    createUser: async () => { calls.push("create"); return { uuid: "new", username: "tg42", shortUuid: "short", subscriptionUrl: "https://sub.lazeika.xyz/short" }; },
    getUser: async () => { calls.push("verify-user"); return { username: "tg42", telegramId: 42, email: "user@example.com", createdAt: "2026-01-01T00:00:00.000Z", expireAt: "2026-02-01T00:00:00.000Z", activeInternalSquads: [{ uuid: "wl", name: "Whitelist" }], trafficLimitBytes: 0, trafficLimitStrategy: "NO_RESET" }; },
    writeJournal: async (kind) => { calls.push(kind); },
    switchLocal: async () => { calls.push("switch"); },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["create", "subscription.cutover.replacement_created", "verify-user", "subscription.cutover.verified", "switch", "subscription.cutover.switched"]);
});

test("non-direct URL blocks local switch and journals failure", async () => {
  const calls: string[] = [];
  const result = await runReplacementCutover({ subscriptionId: "sub-1", ownerId: "c1", createdAt: "2026-01-01T00:00:00.000Z", expireAt: "2026-02-01T00:00:00.000Z", squads: [], deviceLimit: 1, trafficLimitMode: "REMNAWAVE", trafficLimitBytes: 100n }, {
    createUser: async () => ({ uuid: "new", username: "ordinary", shortUuid: "short", subscriptionUrl: "https://wrong.example/short" }),
    getUser: async () => ({}), writeJournal: async (kind) => { calls.push(kind); }, switchLocal: async () => { calls.push("switch"); },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(calls, ["subscription.cutover.replacement_created", "subscription.cutover.failed"]);
});

test("cleanup requires verified and switched proof, then never targets replacement/current UUID", async () => {
  const calls: string[] = [];
  const result = await cleanupLegacyUsers({ oldUuids: ["old", "new"], replacementUuid: "new", currentUuid: "new", verified: true, switched: true }, {
    revoke: async (uuid) => { calls.push(`revoke:${uuid}`); }, getUser: async (uuid) => { calls.push(`get:${uuid}`); return null; }, deleteUser: async (uuid) => { calls.push(`delete:${uuid}`); }, writeJournal: async (kind) => { calls.push(kind); },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["revoke:old", "delete:old", "get:old", "subscription.cutover.legacy_cleaned"]);
});

test("cleanup without proof is blocked before remote mutation", async () => {
  const result = await cleanupLegacyUsers({ oldUuids: ["old"], replacementUuid: "new", currentUuid: "new", verified: false, switched: true }, {
    revoke: async () => assert.fail("must not revoke"), getUser: async () => null, deleteUser: async () => assert.fail("must not delete"), writeJournal: async () => {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "REPLACEMENT_NOT_VERIFIED");
});
