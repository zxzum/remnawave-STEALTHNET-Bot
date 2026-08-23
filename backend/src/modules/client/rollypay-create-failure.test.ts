import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET ??= "test-secret-at-least-thirty-two-characters";

test("classifies RollyPay create failures by retry safety", async () => {
  const service = await import("../rollypay/rollypay.service.js") as unknown as {
    rollypayCreateFailure?: (error: string, status?: number) => { kind: string; status: number };
  };
  assert.equal(typeof service.rollypayCreateFailure, "function");
  assert.equal(service.rollypayCreateFailure?.("timeout").kind, "transient");
  assert.equal(service.rollypayCreateFailure?.("busy", 503).kind, "transient");
  assert.equal(service.rollypayCreateFailure?.("rejected", 422).kind, "permanent_rejection");
});

test("RollyPay route retains ambiguous local payments and deletes only confirmed rejection", async () => {
  const source = await readFile(new URL("./client.routes.ts", import.meta.url), "utf8");
  const start = source.indexOf('clientRouter.post("/rollypay/create-payment"');
  const end = source.indexOf('clientRouter.post("/lava/create-payment"', start);
  const route = source.slice(start, end > start ? end : undefined);
  const failureStart = route.lastIndexOf("if (!result.ok)");
  const failure = route.slice(failureStart, route.indexOf("const url =", failureStart));
  assert.match(failure, /result\.kind === "transient"/);
  assert.match(failure, /res\.status\(503\)/);
  assert.match(failure, /result\.kind === "permanent_rejection"/);
  assert.match(failure, /prisma\.payment\.delete/);
  assert.equal((route.match(/createRollypayPayment\(\{/g) ?? []).length, 1);
});
