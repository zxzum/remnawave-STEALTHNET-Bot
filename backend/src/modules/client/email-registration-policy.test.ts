import assert from "node:assert/strict";
import test from "node:test";
import {
  EMAIL_VERIFICATION_IP_MAX,
  getEmailRegistrationRetryAfter,
} from "./email-registration-policy.js";

const now = new Date("2026-08-09T12:00:00.000Z");

test("limits the same email for 60 seconds", async () => {
  assert.equal(
    getEmailRegistrationRetryAfter(now, new Date("2026-08-09T11:59:30.000Z"), []),
    30,
  );
});

test("limits the fifth IP send until the oldest send leaves the hour", async () => {
  const sends = Array.from({ length: EMAIL_VERIFICATION_IP_MAX }, (_, index) =>
    new Date(now.getTime() - (10 + index * 10) * 60_000),
  );
  assert.equal(getEmailRegistrationRetryAfter(now, null, sends), 600);
});

test("allows a request outside both windows", async () => {
  assert.equal(getEmailRegistrationRetryAfter(now, new Date("2026-08-09T11:00:00.000Z"), []), null);
});
