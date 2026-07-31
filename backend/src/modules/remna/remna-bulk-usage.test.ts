import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";
process.env.REMNA_API_URL = "https://remna.test";
process.env.REMNA_ADMIN_TOKEN = "test-token";

const {
  remnaGetNodesUsersUsage,
  remnaGetSquadAccessibleNodeUuids,
} = await import("./remna.client.js");

async function withFetchResponse(body: unknown, run: (requests: Array<{ url: string; init?: RequestInit }>) => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;

  try {
    await run(requests);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("bulk node usage posts UTC bounds and node UUIDs, then parses safe totals", async () => {
  await withFetchResponse({
    response: { topUsers: [{ username: "alice", total: 42 }] },
  }, async (requests) => {
    const result = await remnaGetNodesUsersUsage(
      ["node-b", "node-a"],
      "2026-07-19T00:00:00.000Z",
      "2026-07-20T00:00:00.000Z",
      500,
    );

    assert.deepEqual(result.data, { topUsers: [{ username: "alice", total: 42 }] });
    assert.equal(result.error, undefined);
    assert.equal(requests.length, 1);
    const request = requests[0]!;
    const url = new URL(request.url);
    assert.equal(url.pathname, "/api/bandwidth-stats/nodes/users");
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      start: "2026-07-19T00:00:00.000Z",
      end: "2026-07-20T00:00:00.000Z",
      topUsersLimit: "500",
    });
    assert.equal(request.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(request.init?.body)), { nodesUuids: ["node-b", "node-a"] });
  });
});

for (const total of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  test(`bulk node usage rejects invalid total ${total}`, async () => {
    await withFetchResponse({ response: { topUsers: [{ username: "alice", total }] } }, async () => {
      const result = await remnaGetNodesUsersUsage(["node-a"], "2026-07-19T00:00:00.000Z", "2026-07-20T00:00:00.000Z", 1);

      assert.equal(result.data, undefined);
      assert.match(result.error ?? "", /invalid.*total/i);
      assert.equal(result.status, 502);
    });
  });
}

test("bulk node usage rejects malformed responses", async () => {
  await withFetchResponse({ response: { topUsers: [{ username: "alice" }] } }, async () => {
    const result = await remnaGetNodesUsersUsage(["node-a"], "2026-07-19T00:00:00.000Z", "2026-07-20T00:00:00.000Z", 1);

    assert.equal(result.data, undefined);
    assert.match(result.error ?? "", /malformed/i);
    assert.equal(result.status, 502);
  });
});

test("accessible node UUIDs are sorted and deduplicated", async () => {
  await withFetchResponse({ response: [{ uuid: "node-b" }, { uuid: "node-a" }, { uuid: "node-b" }] }, async () => {
    const result = await remnaGetSquadAccessibleNodeUuids("squad-1");

    assert.deepEqual(result.data, ["node-a", "node-b"]);
    assert.equal(result.error, undefined);
  });
});

test("accessible node UUIDs parse the Remnawave accessibleNodes envelope", async () => {
  await withFetchResponse({ response: { squadUuid: "squad-1", accessibleNodes: [{ uuid: "node-b" }, { uuid: "node-a" }] } }, async () => {
    const result = await remnaGetSquadAccessibleNodeUuids("squad-1");

    assert.deepEqual(result.data, ["node-a", "node-b"]);
    assert.equal(result.error, undefined);
  });
});

test("empty accessible nodes are a configuration error", async () => {
  await withFetchResponse({ response: [] }, async () => {
    const result = await remnaGetSquadAccessibleNodeUuids("squad-1");

    assert.equal(result.data, undefined);
    assert.match(result.error ?? "", /no accessible nodes/i);
    assert.equal(result.status, 422);
  });
});
