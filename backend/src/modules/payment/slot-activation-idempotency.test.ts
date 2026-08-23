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
