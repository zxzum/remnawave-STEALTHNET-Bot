import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "grammy";
import { isRetryingGetUpdatesError } from "./telegram-error-reporting.js";

test("network retry for getUpdates is not escalated", () => {
  assert.equal(isRetryingGetUpdatesError("getUpdates", new HttpError("failed", new Error("offline"))), true);
  assert.equal(isRetryingGetUpdatesError("sendMessage", new HttpError("failed", new Error("offline"))), false);
});
