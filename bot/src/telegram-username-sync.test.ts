import assert from "node:assert/strict";
import test from "node:test";
import { createTelegramUsernameSync } from "./telegram-username-sync.js";

test("syncs first and changed non-empty usernames only", async () => {
  const calls: Array<[number, string]> = [];
  const sync = createTelegramUsernameSync(async (id, username) => {
    calls.push([id, username]);
  });

  await sync(7, "first_name");
  await sync(7, "first_name");
  await sync(7, undefined);
  await sync(7, "  ");
  await sync(7, "second_name");

  assert.deepEqual(calls, [[7, "first_name"], [7, "second_name"]]);
});

test("retries a username after a failed request", async () => {
  let attempts = 0;
  const sync = createTelegramUsernameSync(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("offline");
  });

  await assert.rejects(sync(7, "name"), /offline/);
  await sync(7, "name");

  assert.equal(attempts, 2);
});
