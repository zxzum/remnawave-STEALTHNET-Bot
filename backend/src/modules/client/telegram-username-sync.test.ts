import assert from "node:assert/strict";
import test from "node:test";
import { changedTelegramUsername } from "./telegram-username-sync.js";

test("returns only a changed non-empty Telegram username", () => {
  assert.equal(changedTelegramUsername("old_name", "new_name"), "new_name");
  assert.equal(changedTelegramUsername("same_name", "same_name"), null);
  assert.equal(changedTelegramUsername("old_name", undefined), null);
  assert.equal(changedTelegramUsername("old_name", "  "), null);
});
