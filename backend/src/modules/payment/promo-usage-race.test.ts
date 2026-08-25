import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("promo usage check and create are serialized without a pair uniqueness constraint", async () => {
  const source = await readFile(new URL("./promo-code-usage.util.ts", import.meta.url), "utf8");
  assert.match(source, /prisma\.\$transaction\(async \(tx\)/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /tx\.promoCodeUsage\.findFirst/);
  assert.match(source, /tx\.promoCodeUsage\.create/);
  assert.doesNotMatch(source, /@@unique\(\[promoCodeId, clientId\]\)/);
});
