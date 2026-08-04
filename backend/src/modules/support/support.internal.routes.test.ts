import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://support-test:support-test@127.0.0.1:5432/support-test";

const { isSupportApiKeyValid, isSupportRequestIdValid } = await import("./support.internal.routes.js");

test("Support API key validation rejects wrong and empty secrets", () => {
  assert.equal(isSupportApiKeyValid("secret", "secret"), true);
  assert.equal(isSupportApiKeyValid("wrong", "secret"), false);
  assert.equal(isSupportApiKeyValid("", "secret"), false);
  assert.equal(isSupportApiKeyValid("secret", ""), false);
});

test("Support request id must be a UUID", () => {
  assert.equal(isSupportRequestIdValid("019fccb3-125d-7ac3-be89-1433e50adb4c"), true);
  assert.equal(isSupportRequestIdValid("not-a-request-id"), false);
});
