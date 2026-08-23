import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("top-up payment flip and balance credit share one payment-lock transaction", async () => {
  const source = await readFile(new URL("./mark-paid.service.ts", import.meta.url), "utf8");
  const topupStart = source.indexOf("const isTopUp =");
  const activationStart = source.indexOf("let activation:", topupStart);
  const block = source.slice(topupStart, activationStart);
  assert.match(block, /prisma\.\$transaction\(async \(tx\)/);
  assert.match(block, /FOR UPDATE/);
  assert.match(block, /tx\.client\.update/);
  assert.match(block, /tx\.payment\.update/);
  assert.doesNotMatch(block, /prisma\.client\.update\(/);
});

test("a concurrent PAID flip re-enters activation recovery instead of short-circuiting", async () => {
  const source = await readFile(new URL("./mark-paid.service.ts", import.meta.url), "utf8");
  const flipStart = source.indexOf("if (flip.count === 0)");
  const activationStart = source.indexOf("let activation:", flipStart);
  const concurrentBranch = source.slice(flipStart, activationStart);
  assert.match(concurrentBranch, /updated\?\.status === "PAID"/);
  assert.match(concurrentBranch, /return markPaymentPaid\(paymentId, options\)/);
});

test("FAILED recovery is evaluated under the same payment row lock as top-up credit", async () => {
  const source = await readFile(new URL("./mark-paid.service.ts", import.meta.url), "utf8");
  const topupStart = source.indexOf("const isTopUp =");
  const activationStart = source.indexOf("let activation:", topupStart);
  const lockedCompletion = source.slice(topupStart, activationStart);
  assert.match(lockedCompletion, /canTransitionPaymentToPaid\(fresh\.status, options\.allowFailedRecovery === true\)/);
  assert.match(lockedCompletion, /FOR UPDATE/);
  assert.match(lockedCompletion, /tx\.payment\.update/);
  assert.match(lockedCompletion, /tx\.client\.update/);
});

test("slot activation failure is retryable and PAID retries attempt incomplete activation", async () => {
  const source = await readFile(new URL("./mark-paid.service.ts", import.meta.url), "utf8");
  assert.match(source, /shouldRetryPaidSlotActivation/);
  assert.match(source, /if \(shouldRetryPaidSlotActivation\(payment\)\)/);
  assert.match(source, /proxySlots: { ok: false/);
  assert.match(source, /return { ok: false, payment: updated/);
});
