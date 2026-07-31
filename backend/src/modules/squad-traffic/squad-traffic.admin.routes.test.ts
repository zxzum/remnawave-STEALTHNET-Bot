import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("traffic quota admin routes require auth, validate actions, and audit mutations", async () => {
  const [source, app] = await Promise.all([
    readFile(new URL("./squad-traffic.admin.routes.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app.ts", import.meta.url), "utf8"),
  ]);

  assert.match(source, /trafficQuotaAdminRouter\.use\(requireAuth\)/);
  assert.match(source, /trafficQuotaAdminRouter\.use\(requireAdminSection\)/);
  assert.match(source, /bytes: z\.string\(\)\.regex\(/);
  assert.match(source, /z\.enum\(\["CURRENT_PERIOD", "WHILE_TARIFF_ACTIVE"\]\)/);
  assert.match(source, /prisma\.subscription\.findUnique/);
  assert.match(source, /grantTrafficBytes\(subscriptionId, BigInt\(parsed\.data\.bytes\), parsed\.data\.scope, adminId\)/);
  assert.match(source, /revokeTrafficGrant\(req\.params\.id, adminId\)/);
  assert.match(source, /\["suspend", suspendTrafficQuota, "traffic_quota\.suspend"\]/);
  assert.match(source, /\["resume", resumeTrafficQuota, "traffic_quota\.resume"\]/);
  assert.match(source, /logAdmin\(req, "traffic_quota\.grant"/);
  assert.match(source, /logAdmin\(req, "traffic_quota\.revoke"/);
  assert.match(source, /logAdmin\(req, kind/);
  assert.match(source, /"traffic_quota\.suspend"/);
  assert.match(source, /"traffic_quota\.resume"/);
  assert.match(app, /app\.use\("\/api\/admin", trafficQuotaAdminRouter\)/);
});

test("traffic quota detail is bounded and excludes checkpoints and Remnawave credentials", async () => {
  const source = await readFile(new URL("./squad-traffic.admin.routes.ts", import.meta.url), "utf8");

  assert.match(source, /trafficQuotaEvent\.findMany\([\s\S]*take: 50/);
  assert.match(source, /status: "ACTIVE"/);
  assert.doesNotMatch(source, /checkpoint/i);
  assert.doesNotMatch(source, /REMNA_ADMIN_TOKEN|remnawaveToken|adminToken/);
});

test("missing local quota or grant is a controlled 404 while other failures propagate", async () => {
  const source = await readFile(new URL("./squad-traffic.admin.routes.ts", import.meta.url), "utf8");

  assert.match(source, /function isMissingQuotaResource/);
  assert.match(source, /"Локальная квота подписки не найдена"/);
  assert.match(source, /"Начисление трафика не найдено"/);
  assert.match(source, /return res\.status\(404\)\.json\(\{ message: error\.message \}\)/);
  assert.match(source, /throw error/);
});
