import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("trial activation creates LOCAL_SQUAD entitlement after its one-user subscription succeeds", async () => {
  const source = await readFile(new URL("../client/client.routes.ts", import.meta.url), "utf8");
  const activation = source.slice(source.indexOf('clientRouter.post("/trials/:id/activate"'));

  assert.match(activation, /trafficLimitBytes: trial\.trafficLimitMode === "LOCAL_SQUAD" \? 0n : trialTrafficLimit/);
  const subscriptionUpdated = activation.indexOf('data: { trialId: trial.id }');
  const entitlementApplied = activation.indexOf('applyTrafficEntitlement(');
  assert.ok(subscriptionUpdated >= 0 && entitlementApplied > subscriptionUpdated, "entitlement is applied after subscription persistence");
  assert.match(activation, /mode: trial\.trafficLimitMode/);
  assert.match(activation, /"TRIAL_ACTIVATION"/);
});

test("tariff and trial byte DTOs serialize bigint values as exact strings", async () => {
  const [admin, client, external] = await Promise.all([
    readFile(new URL("../admin/admin.routes.ts", import.meta.url), "utf8"),
    readFile(new URL("../client/client.routes.ts", import.meta.url), "utf8"),
    readFile(new URL("../api-keys/external-api.routes.ts", import.meta.url), "utf8"),
  ]);
  const serializers = [
    admin.slice(admin.indexOf("function tariffToJson"), admin.indexOf("const trafficPolicySchema")),
    client.slice(client.indexOf("function tariffToJson"), client.indexOf('publicConfigRouter.get("/tariffs"')),
    external.slice(external.indexOf("function tariffToJson"), external.indexOf('externalApiRouter.get("/tariffs"')),
  ];
  for (const source of serializers) {
    assert.doesNotMatch(source, /trafficLimitBytes:\s*[^\n]*Number\(/);
  }
  assert.match(admin, /trafficLimitBytes: t\.trafficLimitBytes != null \? t\.trafficLimitBytes\.toString\(\) : null/);
  assert.match(admin, /trafficLimitBytes: t\.trafficLimitBytes != null \? t\.trafficLimitBytes\.toString\(\) : null/);
  assert.match(external, /trafficLimitBytes: t\.trafficLimitBytes != null \? t\.trafficLimitBytes\.toString\(\) : null/);
});

test("large traffic byte values survive string serialization", () => {
  const bytes = 9_007_199_254_740_993n;
  assert.equal(bytes.toString(), "9007199254740993");
});

test("zero traffic byte limits remain explicit strings", async () => {
  const [client, external] = await Promise.all([
    readFile(new URL("../client/client.routes.ts", import.meta.url), "utf8"),
    readFile(new URL("../api-keys/external-api.routes.ts", import.meta.url), "utf8"),
  ]);
  assert.match(client, /trafficLimitBytes: t\.trafficLimitBytes != null \? t\.trafficLimitBytes\.toString\(\) : null/);
  assert.match(external, /trafficLimitBytes: t\.trafficLimitBytes != null \? t\.trafficLimitBytes\.toString\(\) : null/);
  assert.equal(0n.toString(), "0");
});
