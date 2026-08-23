import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("proxy and Sing-box slots have nullable payment linkage and transaction indexes", async () => {
  const schema = await readFile(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");
  const proxy = await readFile(new URL("../proxy/proxy-slots-activation.service.ts", import.meta.url), "utf8");
  const singbox = await readFile(new URL("../singbox/singbox-slots-activation.service.ts", import.meta.url), "utf8");
  assert.match(schema, /paymentId\s+String\?\s+@map\("payment_id"\)/);
  assert.match(schema, /@@index\(\[paymentId\]\)/);
  for (const source of [proxy, singbox]) {
    assert.match(source, /prisma\.\$transaction\(async \(tx\)/);
    assert.match(source, /FOR UPDATE/);
    assert.match(source, /paymentId/);
    assert.match(source, /alreadyApplied/);
  }
});

test("slot linkage migration is additive and forward-only", async () => {
  const { readdir, readFile: read } = await import("node:fs/promises");
  const migrations = await readdir(new URL("../../../prisma/migrations", import.meta.url));
  const migration = migrations.find((name) => name.includes("payment_slot_linkage"));
  assert.ok(migration);
  const sql = await read(new URL(`../../../prisma/migrations/${migration}/migration.sql`, import.meta.url), "utf8");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS/);
  assert.doesNotMatch(sql, /DROP COLUMN|ALTER COLUMN .* NOT NULL/i);
});

test("slot activation barrier migration is replay-safe and deterministically blocks legacy PAID payments", async () => {
  const schema = await readFile(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");
  assert.match(schema, /slotActivationState\s+String\?\s+@default\("ELIGIBLE"\)\s+@map\("slot_activation_state"\)/);

  const { readdir, readFile: read } = await import("node:fs/promises");
  const migrations = await readdir(new URL("../../../prisma/migrations", import.meta.url));
  const migration = migrations.find((name) => name.includes("payment_slot_activation_barrier"));
  assert.ok(migration);
  const sql = await read(new URL(`../../../prisma/migrations/${migration}/migration.sql`, import.meta.url), "utf8");

  assert.match(sql, /ADD COLUMN IF NOT EXISTS "slot_activation_state" TEXT/);
  assert.match(sql, /SET "slot_activation_state" = 'LEGACY_BLOCKED'[\s\S]*"status" = 'PAID'/);
  assert.match(sql, /SET "slot_activation_state" = 'ELIGIBLE'[\s\S]*"status" = 'PENDING'/);
  assert.equal(sql.match(/"slot_activation_state" IS NULL/g)?.length, 2);
  assert.match(sql, /ALTER COLUMN "slot_activation_state" SET DEFAULT 'ELIGIBLE'/);
  assert.doesNotMatch(sql, /UPDATE\s+"proxy_slots"|UPDATE\s+"singbox_slots"/i);
  assert.doesNotMatch(sql, /DROP COLUMN|ALTER COLUMN .* NOT NULL/i);
});
