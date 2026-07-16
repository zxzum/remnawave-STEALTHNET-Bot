import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const clientRoutes = readFileSync(new URL("../client/client.routes.ts", import.meta.url), "utf8");
const componentsService = readFileSync(new URL("./subscription-components.service.ts", import.meta.url), "utf8");

test("ghost primary: клиентский API не использует legacy UUID без Subscription index 0", () => {
  assert.doesNotMatch(clientRoutes, /rootSub\?\.remnawaveUuid\s*\?\?\s*client\.remnawaveUuid/);
  assert.match(clientRoutes, /if \(!rootSub\?\.remnawaveUuid\)/);
});

test("ghost primary: аннулирование удаляет Remnawave user и очищает legacy client state", () => {
  const lifecycle = componentsService.slice(
    componentsService.indexOf("async function removeSubscriptionRecord"),
    componentsService.indexOf("export function buildComponentUsername"),
  );

  assert.match(lifecycle, /remnaDeleteUser\(remnawaveUuid\)/);
  assert.match(lifecycle, /subscriptionIndex\s*===\s*0/);
  assert.match(lifecycle, /remnawaveUuid:\s*null/);
  assert.match(lifecycle, /currentTariffId:\s*null/);
  assert.match(lifecycle, /autoRenewEnabled:\s*false/);
  assert.match(lifecycle, /autoRenewTariffId:\s*null/);
});
