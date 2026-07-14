import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";

const remna = (await import("./remna.client.js").catch(() => ({}))) as Record<string, unknown>;

test("raw subscription fetch передаёт только полученные клиентские headers", async () => {
  assert.equal(typeof remna.remnaFetchSubscription, "function");
  const originalFetch = globalThis.fetch;
  let capturedHeaders: Record<string, string> = {};
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    capturedHeaders = Object.fromEntries(new Headers(init?.headers).entries());
    return new Response("dmxlc3M6Ly9tYWlu", {
      status: 200,
      headers: {
        "content-type": "text/plain",
        "subscription-userinfo": "upload=1; download=2; total=0; expire=3",
      },
    });
  }) as typeof fetch;

  try {
    const run = remna.remnaFetchSubscription as (
      url: string,
      headers: Record<string, string>,
    ) => Promise<{ status: number; body?: string; headers?: Record<string, string>; error?: string }>;
    const result = await run("https://sub.example/sub/token", {
      "user-agent": "Happ/3",
      "x-hwid": "same-device",
    });

    assert.equal(result.status, 200);
    assert.equal(result.body, "dmxlc3M6Ly9tYWlu");
    assert.equal(result.headers?.["subscription-userinfo"], "upload=1; download=2; total=0; expire=3");
    assert.equal(capturedHeaders["user-agent"], "Happ/3");
    assert.equal(capturedHeaders["x-hwid"], "same-device");
    assert.equal(capturedHeaders.authorization, undefined);
    assert.equal(capturedHeaders.cookie, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("raw subscription fetch отклоняет небезопасный протокол", async () => {
  assert.equal(typeof remna.remnaFetchSubscription, "function");
  const run = remna.remnaFetchSubscription as (
    url: string,
    headers: Record<string, string>,
  ) => Promise<{ status: number; error?: string }>;
  const result = await run("file:///etc/passwd", {});
  assert.equal(result.status, 400);
  assert.match(result.error ?? "", /protocol/i);
});
