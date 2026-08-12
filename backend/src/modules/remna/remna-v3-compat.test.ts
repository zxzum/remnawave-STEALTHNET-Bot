import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";
process.env.REMNA_API_URL = "https://remna.test";
process.env.REMNA_ADMIN_TOKEN = "test-token";

const {
  extractRemnaUuid,
  remnaDeleteUserHwidDevice,
  remnaDropConnections,
  remnaGetUserByEmail,
  remnaGetUserByTelegramId,
  remnaUpdateUser,
  remnaUsersBulkResetTraffic,
} = await import("./remna.client.js");

type RequestRecord = { url: string; init?: RequestInit };

async function withFetchResponses(
  responses: Array<{ status: number; body?: unknown }>,
  run: (requests: RequestRecord[]) => Promise<void>,
) {
  const originalFetch = globalThis.fetch;
  const requests: RequestRecord[] = [];
  let index = 0;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    const response = responses[index++] ?? { status: 500, body: { message: "unexpected request" } };
    return new Response(response.body === undefined ? "" : JSON.stringify(response.body), {
      status: response.status,
    });
  }) as typeof fetch;

  try {
    await run(requests);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("extractRemnaUuid accepts v3 numeric user ids", () => {
  assert.equal(extractRemnaUuid({ response: { id: 42 } }), "42");
  assert.equal(extractRemnaUuid({ response: { users: [{ id: 43 }] } }), "43");
});

test("v3 user lookup falls back from removed email route to users stream", async () => {
  await withFetchResponses([
    { status: 404, body: { message: "Not found" } },
    { status: 200, body: { response: { users: [{ id: 42 }] } } },
  ], async (requests) => {
    const result = await remnaGetUserByEmail("alice@example.com");

    assert.equal(result.status, 200);
    assert.equal(extractRemnaUuid(result.data), "42");
    assert.equal(requests.length, 2);
    assert.equal(new URL(requests[0]!.url).pathname, "/api/users/by-email/alice%40example.com");
    const streamUrl = new URL(requests[1]!.url);
    assert.equal(streamUrl.pathname, "/api/users/stream");
    assert.deepEqual(Object.fromEntries(streamUrl.searchParams), {
      size: "1",
      email: "alice@example.com",
    });
  });
});

test("v3 telegram lookup uses the same stream fallback", async () => {
  await withFetchResponses([
    { status: 404, body: { message: "Not found" } },
    { status: 200, body: { response: { users: [{ id: 44 }] } } },
  ], async (requests) => {
    const result = await remnaGetUserByTelegramId("12345");

    assert.equal(result.status, 200);
    assert.equal(requests.length, 2);
    const streamUrl = new URL(requests[1]!.url);
    assert.equal(streamUrl.pathname, "/api/users/stream");
    assert.deepEqual(Object.fromEntries(streamUrl.searchParams), {
      size: "1",
      telegramId: "12345",
    });
  });
});

test("numeric local Remna id is sent as v3 id while legacy UUID stays unchanged", async () => {
  await withFetchResponses([
    { status: 200, body: { response: { id: 42 } } },
    { status: 200, body: { response: { uuid: "legacy" } } },
  ], async (requests) => {
    await remnaUpdateUser({ uuid: "42", status: "ACTIVE" });
    await remnaUpdateUser({ uuid: "legacy", status: "ACTIVE" });

    assert.deepEqual(JSON.parse(String(requests[0]!.init?.body)), { id: 42, status: "ACTIVE" });
    assert.deepEqual(JSON.parse(String(requests[1]!.init?.body)), { uuid: "legacy", status: "ACTIVE" });
  });
});

test("numeric bulk ids and HWID ids use v3 field names", async () => {
  await withFetchResponses([
    { status: 200, body: {} },
    { status: 200, body: {} },
  ], async (requests) => {
    await remnaUsersBulkResetTraffic(["42", "43"]);
    await remnaDeleteUserHwidDevice("42", "hwid-1");

    assert.deepEqual(JSON.parse(String(requests[0]!.init?.body)), { userIds: [42, 43] });
    assert.deepEqual(JSON.parse(String(requests[1]!.init?.body)), { userId: 42, hwid: "hwid-1" });
  });
});

test("drop connections uses the v3 route and translates numeric user ids", async () => {
  await withFetchResponses([{ status: 200, body: {} }], async (requests) => {
    await remnaDropConnections({ userUuids: ["42", "43"] });

    assert.equal(new URL(requests[0]!.url).pathname, "/api/connections/drop");
    assert.deepEqual(JSON.parse(String(requests[0]!.init?.body)), {
      dropBy: { userIds: [42, 43] },
    });
  });
});
