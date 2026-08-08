import assert from "node:assert/strict";
import test from "node:test";
import { api } from "../src/lib/api.ts";

test("parallel balance payments with the same payload share one request", async () => {
  const originalFetch = globalThis.fetch;
  const expected = { message: "ok", paymentId: "payment-1", newBalance: 1640 };
  let calls = 0;
  let release: (() => void) | undefined;

  globalThis.fetch = async () => {
    calls += 1;
    await new Promise<void>((resolve) => { release = resolve; });
    return new Response(JSON.stringify(expected), { status: 200 });
  };

  try {
    const payload = { tariffId: "tariff-1", tariffPriceOptionId: "price-1" };
    const first = api.clientPayByBalance("client-token", payload);
    const second = api.clientPayByBalance("client-token", payload);

    await Promise.resolve();
    assert.equal(calls, 1);
    assert.ok(release);
    release();
    assert.deepEqual(await Promise.all([first, second]), [expected, expected]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
