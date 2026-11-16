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

test("Migration notice retries after a network error and stops on 4xx", async () => {
  const { notifyClientMigrated } = await import("./support.internal.routes.js");
  const realFetch = globalThis.fetch;
  const realToken = process.env.BOT_TOKEN;
  process.env.BOT_TOKEN = "test-token";
  try {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) throw new TypeError("fetch failed: EAI_AGAIN");
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    await notifyClientMigrated("1", undefined, [0, 0]);
    assert.equal(calls, 2);

    calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("Forbidden: bot was blocked by the user", { status: 403 });
    }) as typeof fetch;
    await notifyClientMigrated("1", undefined, [0, 0]);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = realFetch;
    if (realToken === undefined) delete process.env.BOT_TOKEN;
    else process.env.BOT_TOKEN = realToken;
  }
});
