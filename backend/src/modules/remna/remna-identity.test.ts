import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";

const { remnaUsernameFromClient } = await import("./remna.client.js");

test("Remnawave username uses tg id and stable subscription number", () => {
  assert.equal(remnaUsernameFromClient({ telegramUsername: "alice", telegramId: "5548521968", subscriptionIndex: 0 }), "tg5548521968");
  assert.equal(remnaUsernameFromClient({ telegramUsername: "alice", telegramId: "5548521968", subscriptionIndex: 19 }), "tg5548521968-20");
});
