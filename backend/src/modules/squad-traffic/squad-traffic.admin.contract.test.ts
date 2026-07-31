import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { toClientTrafficQuota } from "./squad-traffic.client.js";

test("admin traffic policy contract validates LOCAL_SQUAD membership across tariff and trial schemas", async () => {
  const source = await readFile(new URL("../admin/admin.routes.ts", import.meta.url), "utf8");
  assert.match(source, /const trafficPolicySchema = z\.object\([\s\S]*trafficLimitMode[\s\S]*meteredSquadUuid[\s\S]*\.superRefine/);
  assert.match(source, /createTariffSchema[\s\S]*validateTrafficPolicy/);
  assert.match(source, /updateTariffSchema[\s\S]*validateTrafficPolicy/);
  assert.match(source, /createTrialSchema[\s\S]*trafficLimitMode[\s\S]*meteredSquadUuid/);
  assert.match(source, /updateTrialSchema[\s\S]*trafficLimitMode[\s\S]*meteredSquadUuid/);
  assert.match(source, /trafficLimitMode: t\.trafficLimitMode/);
  assert.match(source, /meteredSquadUuid: t\.meteredSquadUuid/);
});

test("tariff policy fields appear in nested admin and external tariff JSON", async () => {
  const [admin, external, client] = await Promise.all([
    readFile(new URL("../admin/admin.routes.ts", import.meta.url), "utf8"),
    readFile(new URL("../api-keys/external-api.routes.ts", import.meta.url), "utf8"),
    readFile(new URL("../client/client.routes.ts", import.meta.url), "utf8"),
  ]);
  assert.match(admin, /tariffs: c\.tariffs\.map\(tariffToJson\)/);
  assert.match(admin, /trafficLimitMode: t\.trafficLimitMode/);
  assert.match(external, /trafficLimitMode: t\.trafficLimitMode/);
  assert.match(external, /meteredSquadUuid: t\.meteredSquadUuid/);
  assert.match(client, /publicConfigRouter\.get\("\/tariffs"[\s\S]*tariffToJson/);
  assert.match(client, /trafficLimitMode: t\.trafficLimitMode/);
  assert.match(client, /meteredSquadUuid: t\.meteredSquadUuid/);
});

test("client quota DTO serializes bigint fields and ISO period boundaries", () => {
  assert.deepEqual(toClientTrafficQuota({
    tariffIdAtPeriodStart: "tariff-1",
    baseLimitBytes: 100n,
    usedBytes: 30n,
    status: "ACTIVE",
    periodStartedAt: new Date("2026-07-01T00:00:00.000Z"),
    periodEndsAt: new Date("2026-08-01T00:00:00.000Z"),
    grants: [{ status: "ACTIVE", scope: "CURRENT_PERIOD", bytes: 20n, tariffIdAtGrant: null, validPeriodStartAt: new Date("2026-07-01T00:00:00.000Z") }],
  }), {
    status: "ACTIVE",
    usedBytes: "30",
    limitBytes: "120",
    remainingBytes: "90",
    remainingPercent: 75,
    periodStartedAt: "2026-07-01T00:00:00.000Z",
    periodEndsAt: "2026-08-01T00:00:00.000Z",
  });
});
