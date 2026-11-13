import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("platega device pack pro-rata uses targetSubscriptionId, not the primary subscription", async () => {
  const source = await readFile(new URL("./client.routes.ts", import.meta.url), "utf8");
  const start = source.indexOf('clientRouter.post("/payments/platega"');
  const kind = source.indexOf('extraOption.kind === "devices"', start);
  const body = source.slice(kind, source.indexOf("metadataExtra = { extraOption: { kind: \"devices\"", kind));

  assert.match(body, /calculateDevicesProrataPriceCoefficient\(extraOption\.targetSubscriptionId\)/);
  assert.doesNotMatch(body, /primarySub/);
});
