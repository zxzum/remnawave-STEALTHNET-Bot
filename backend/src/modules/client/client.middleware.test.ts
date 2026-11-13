import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://mw-test:mw-test@127.0.0.1:5432/mw-test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";

const { blockKindOf } = await import("./client.middleware.js");

test("blockKindOf exposes a fixed flag, never the reason text", () => {
  assert.equal(blockKindOf("Мигрирован в Invoxy VPN (@invoxy_bot)"), "INVOXY_MIGRATED");
  assert.equal(blockKindOf("Community Blacklist"), null);
  assert.equal(blockKindOf(null), null);
});
