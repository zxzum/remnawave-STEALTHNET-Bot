import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";

const {
  buildCutoverInventory,
  buildReplacementPayload,
  parseCutoverArgs,
  parseDuplicateCleanupArgs,
  runCutoverInventory,
  runDuplicateCleanup,
  runReplacementCutover,
  cleanupLegacyUsers,
  buildDuplicateCleanupInventory,
  computeDuplicateCleanupPlanHash,
} = await import("./migrate-composite-to-single.js");

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

const duplicateRows = [
  {
    id: "vss-old", ownerId: "vss-client", subscriptionIndex: 0, remnawaveUuid: "old-uuid", remnawaveShortUuid: "old-short", remnawaveUsername: "vss-old",
    expireAt: new Date("2026-08-01"), deletionRequestedAt: null, syncStatus: "SYNCED", tariffId: "ordinary", tariff: { id: "ordinary", name: "Обычный ВПН" }, owner: { telegramUsername: "vssarovv" },
  },
  {
    id: "vss-current", ownerId: "vss-client", subscriptionIndex: 1, remnawaveUuid: "active-uuid", remnawaveShortUuid: "active-short", remnawaveUsername: "vss-active",
    expireAt: new Date("2026-09-01"), deletionRequestedAt: null, syncStatus: "SYNCED", tariffId: "standard", tariff: { id: "standard", name: "Стандарт" }, owner: { telegramUsername: "vssarovv" },
  },
  {
    id: "sally-ordinary", ownerId: "sally-client", subscriptionIndex: 0, remnawaveUuid: "ordinary-uuid", remnawaveShortUuid: "ordinary-short", remnawaveUsername: "sally-old",
    expireAt: new Date("2026-08-01"), deletionRequestedAt: null, syncStatus: "SYNCED", tariffId: "ordinary", tariff: { id: "ordinary", name: "Обычный ВПН" }, owner: { telegramUsername: "sallyqx" },
  },
  {
    id: "sally-standard", ownerId: "sally-client", subscriptionIndex: 1, remnawaveUuid: "standard-uuid", remnawaveShortUuid: "standard-short", remnawaveUsername: "sally-standard",
    expireAt: new Date("2026-09-01"), deletionRequestedAt: null, syncStatus: "SYNCED", tariffId: "standard", tariff: { id: "standard", name: "Стандарт" }, owner: { telegramUsername: "sallyqx" },
  },
];

test("duplicate cleanup is explicit and dry-run by default", () => {
  assert.deepEqual(parseDuplicateCleanupArgs(["--cleanup-duplicates"]), { cleanupDuplicates: true, apply: false, dryRun: true });
  assert.deepEqual(parseDuplicateCleanupArgs(["--cleanup-duplicates", "--apply"]), { cleanupDuplicates: true, apply: true, dryRun: false });
});

test("duplicate inventory includes client and subscription identity and special preservation decisions", async () => {
  const inventory = buildDuplicateCleanupInventory(duplicateRows as any, new Date("2026-08-13T00:00:00.000Z"));
  const vss = inventory.find((client) => client.clientId === "vss-client");
  const sally = inventory.find((client) => client.clientId === "sally-client");

  assert.equal(vss?.status, "planned");
  assert.deepEqual(vss?.subscriptions.map((subscription) => [subscription.subscriptionId, subscription.action, subscription.remnawaveUuid, subscription.remnawaveShortUuid, subscription.status]), [
    ["vss-old", "delete", "old-uuid", "old-short", "EXPIRED"],
    ["vss-current", "preserve", "active-uuid", "active-short", "ACTIVE"],
  ]);
  assert.equal(sally?.subscriptions.find((subscription) => subscription.tariffName === "Стандарт")?.action, "preserve");
  assert.equal(sally?.subscriptions.find((subscription) => subscription.tariffName === "Обычный ВПН")?.action, "delete");
});

test("clients with one subscription are unchanged and never call remote deletion", async () => {
  let deletes = 0;
  let journals = 0;
  const result = await runDuplicateCleanup(parseDuplicateCleanupArgs(["--cleanup-duplicates"]), {
    listSubscriptions: async () => [duplicateRows[0]] as any,
    deleteSubscription: async () => { deletes++; return { deleted: true, failures: [] }; },
    writeJournal: async () => { journals++; },
  }, new Date("2026-08-13T00:00:00.000Z"));

  assert.equal(result.mutated, false);
  assert.equal(result.inventory[0]?.status, "unchanged");
  assert.equal(deletes, 0);
  assert.equal(journals, 0);
});

test("duplicate cleanup plan hash is deterministic for row order", () => {
  const first = buildDuplicateCleanupInventory(duplicateRows as any, new Date("2026-08-13T00:00:00.000Z"));
  const second = buildDuplicateCleanupInventory([...duplicateRows].reverse() as any, new Date("2026-08-13T00:00:00.000Z"));
  assert.equal(computeDuplicateCleanupPlanHash(first), computeDuplicateCleanupPlanHash(second));
});

test("apply rereads inventory and stops before deletion when the plan hash changes", async () => {
  let reads = 0;
  let deletes = 0;
  await assert.rejects(runDuplicateCleanup(parseDuplicateCleanupArgs(["--cleanup-duplicates", "--apply"]), {
    listSubscriptions: async () => {
      reads++;
      return (reads === 1 ? duplicateRows : duplicateRows.slice(0, 3)) as any;
    },
    deleteSubscription: async () => { deletes++; return { deleted: true, failures: [] }; },
    writeJournal: async () => {},
  }, new Date("2026-08-13T00:00:00.000Z")), /plan changed/i);
  assert.equal(reads, 2);
  assert.equal(deletes, 0);
});

test("duplicate username, unexpected count, and unclear tariff block all mutations", async () => {
  const cases = [
    duplicateRows.slice(0, 2).map((row) => ({ ...row, remnawaveUsername: "same-user" })),
    [...duplicateRows.slice(0, 2), { ...duplicateRows[0], id: "vss-third", subscriptionIndex: 2 }],
    duplicateRows.slice(0, 2).map((row) => ({ ...row, owner: { telegramUsername: "other-user" }, tariff: { id: "unknown", name: "Неясный" } })),
  ];
  for (const rowsToBlock of cases) {
    let deletes = 0;
    await assert.rejects(runDuplicateCleanup(parseDuplicateCleanupArgs(["--cleanup-duplicates", "--apply"]), {
      listSubscriptions: async () => rowsToBlock as any,
      deleteSubscription: async () => { deletes++; return { deleted: true, failures: [] }; },
      writeJournal: async () => {},
    }, new Date("2026-08-13T00:00:00.000Z")), /blocked|duplicate|unexpected|tariff/i);
    assert.equal(deletes, 0);
  }
});

test("apply deletes only the selected old subscription and leaves failures retryable", async () => {
  const calls: string[] = [];
  const result = await runDuplicateCleanup(parseDuplicateCleanupArgs(["--cleanup-duplicates", "--apply"]), {
    listSubscriptions: async () => duplicateRows as any,
    deleteSubscription: async (subscriptionId) => {
      calls.push(subscriptionId);
      return subscriptionId === "vss-old" ? { deleted: false, failures: [{ error: "upstream timeout" }] } : { deleted: true, failures: [] };
    },
    writeJournal: async (kind, payload) => { calls.push(`${kind}:${payload.subscriptionId}`); },
  }, new Date("2026-08-13T00:00:00.000Z"));

  assert.deepEqual(calls, [
    "sally-ordinary",
    "subscription.duplicate_cleanup.deleted:sally-ordinary",
    "vss-old",
    "subscription.duplicate_cleanup.failed:vss-old",
  ]);
  assert.equal(result.results.find((item) => item.subscriptionId === "vss-old")?.status, "retryable");
  assert.equal(result.results.find((item) => item.subscriptionId === "sally-ordinary")?.status, "deleted");
});
