import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";

import express from "express";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";

const { createPublicWhitelistQuotaRouter } = await import("./public-whitelist-quota.routes.js");

async function withServer(run: (baseUrl: string) => Promise<void>, options: {
  maxRequests?: number;
  getRemnaUser?: (token: string) => Promise<{ data?: unknown; status: number }>;
} = {}) {
  const app = express();
  app.use("/v1/whitelist", createPublicWhitelistQuotaRouter({
    maxRequests: options.maxRequests,
    getRemnaUser: options.getRemnaUser ?? (async (token) => token === "known-token"
      ? { data: { response: { uuid: "remna-user" } }, status: 200 }
      : { status: 404 }),
    findSubscription: async (uuid) => uuid === "remna-user" ? { id: "sub-1" } : null,
    findQuota: async () => ({
      tariffIdAtPeriodStart: "tariff-1", baseLimitBytes: 100n, usedBytes: 25n, status: "ACTIVE",
      periodStartedAt: new Date("2026-08-07T10:00:00.000Z"), updatedAt: new Date("2026-08-07T10:00:00.000Z"), grants: [],
    }),
  }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("public whitelist route requires a verified bearer and ignores browser identity", async () => {
  await withServer(async (baseUrl) => {
    const missing = await fetch(`${baseUrl}/v1/whitelist/quota?userId=other`, { method: "POST" });
    assert.equal(missing.status, 401);

    const ready = await fetch(`${baseUrl}/v1/whitelist/quota?shortUuid=other`, {
      method: "POST", headers: { Authorization: "Bearer known-token", Origin: "https://sub.lazeika.xyz" },
    });
    assert.equal(ready.status, 200);
    assert.match(ready.headers.get("x-request-id") || "", /^[0-9a-f-]{36}$/);
    assert.deepEqual(await ready.json(), {
      status: "ready", usedBytes: 25, limitBytes: 100, remainingBytes: 75, percent: 25, asOf: "2026-08-07T10:00:00.000Z",
    });
    assert.equal(ready.headers.get("cache-control"), "private, no-store");
  });
});

test("public whitelist route hides invalid credentials and Remnawave outages", async () => {
  await withServer(async (baseUrl) => {
    const invalid = await fetch(`${baseUrl}/v1/whitelist/quota`, {
      method: "POST", headers: { Authorization: "Bearer invalid-token" },
    });
    assert.equal(invalid.status, 401);
    assert.deepEqual(await invalid.json(), { message: "Unauthorized" });
  });

  await withServer(async (baseUrl) => {
    const unavailable = await fetch(`${baseUrl}/v1/whitelist/quota`, {
      method: "POST", headers: { Authorization: "Bearer known-token" },
    });
    assert.equal(unavailable.status, 200);
    assert.deepEqual(await unavailable.json(), { status: "unavailable" });
  }, { getRemnaUser: async () => ({ status: 504 }) });

  await withServer(async (baseUrl) => {
    const unavailable = await fetch(`${baseUrl}/v1/whitelist/quota`, {
      method: "POST", headers: { Authorization: "Bearer known-token" },
    });
    assert.equal(unavailable.status, 200);
    assert.deepEqual(await unavailable.json(), { status: "unavailable" });
  }, { getRemnaUser: async () => { throw new Error("timeout"); } });
});

test("public whitelist route permits only the production CORS origin", async () => {
  await withServer(async (baseUrl) => {
    const allowed = await fetch(`${baseUrl}/v1/whitelist/quota`, {
      method: "OPTIONS", headers: { Origin: "https://sub.lazeika.xyz", "Access-Control-Request-Method": "POST" },
    });
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get("access-control-allow-origin"), "https://sub.lazeika.xyz");

    const denied = await fetch(`${baseUrl}/v1/whitelist/quota`, {
      method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" },
    });
    assert.equal(denied.status, 403);
  });
});

test("public whitelist route limits repeated requests", async () => {
  await withServer(async (baseUrl) => {
    const headers = { Authorization: "Bearer known-token", Origin: "https://sub.lazeika.xyz" };
    assert.equal((await fetch(`${baseUrl}/v1/whitelist/quota`, { method: "POST", headers })).status, 200);
    const limited = await fetch(`${baseUrl}/v1/whitelist/quota`, { method: "POST", headers });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "60");
  }, { maxRequests: 1 });
});

test("application mounts the public quota router", async () => {
  const appSource = await readFile(new URL("../../app.ts", import.meta.url), "utf8");
  assert.match(appSource, /app\.use\("\/v1\/whitelist", publicWhitelistQuotaRouter\)/);
});
