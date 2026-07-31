import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const clientRoutes = readFileSync(new URL("../client/client.routes.ts", import.meta.url), "utf8");
const lifecycleService = readFileSync(new URL("./single-subscription-lifecycle.service.ts", import.meta.url), "utf8");

test("ghost primary: клиентский API выбирает первую оставшуюся подписку после revoke index 0", () => {
  const route = clientRoutes.slice(clientRoutes.indexOf('clientRouter.get("/subscription"'), clientRoutes.indexOf('/**\n * GET /api/client/subscription/by-uuid'));
  assert.doesNotMatch(route, /rootSub\?\.remnawaveUuid\s*\?\?\s*client\.remnawaveUuid/);
  assert.match(route, /orderBy:\s*\{\s*subscriptionIndex:\s*"asc"\s*\}/);
  assert.doesNotMatch(route, /subscriptionIndex:\s*0/);
});

test("ghost primary: аннулирование удаляет Subscription и очищает legacy client state", () => {
  const lifecycle = lifecycleService.slice(
    lifecycleService.indexOf("async function completeSubscriptionDeletion"),
    lifecycleService.indexOf("function notifyRevoked"),
  );

  assert.match(lifecycle, /subscriptionIndex\s*===\s*0/);
  assert.match(lifecycle, /prisma\.subscription\.delete/);
  assert.match(lifecycle, /remnawaveUuid:\s*null/);
  assert.match(lifecycle, /currentTariffId:\s*null/);
  assert.match(lifecycle, /autoRenewEnabled:\s*false/);
  assert.match(lifecycle, /autoRenewTariffId:\s*null/);
});
