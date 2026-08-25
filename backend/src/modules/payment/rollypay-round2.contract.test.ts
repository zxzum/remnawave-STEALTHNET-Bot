import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("RollyPay validates explicit option targets before creating local or external payments", async () => {
  const source = await readFile(new URL("../client/client.routes.ts", import.meta.url), "utf8");
  const routeStart = source.indexOf('clientRouter.post("/rollypay/create-payment"');
  const routeEnd = source.indexOf('clientRouter.post("/lava/create-payment"', routeStart);
  assert.ok(routeStart >= 0);
  const route = source.slice(routeStart, routeEnd > routeStart ? routeEnd : undefined);

  const extraStart = route.indexOf("} else if (extraOption) {");
  const queryStart = route.indexOf("const targetSubscription = await prisma.subscription.findFirst", extraStart);
  const validationStart = route.lastIndexOf("if (extraOption.targetSubscriptionId)", queryStart);
  const localCreateStart = route.indexOf("const payment = await createPayment", extraStart);
  const externalCreateStart = route.indexOf("const result = await createRollypayPayment", localCreateStart);
  assert.ok(extraStart >= 0);
  assert.ok(queryStart > extraStart);
  assert.ok(validationStart > extraStart);
  assert.ok(localCreateStart > validationStart);
  assert.ok(externalCreateStart > localCreateStart);

  const validation = route.slice(validationStart, localCreateStart);
  assert.match(validation, /if \(extraOption\.targetSubscriptionId\)/);
  assert.match(validation, /id: extraOption\.targetSubscriptionId/);
  assert.match(validation, /deletionRequestedAt: null/);
  assert.match(validation, /OR: \[\{ ownerId: clientId \}, \{ giftedToClientId: clientId \}\]/);
  assert.match(validation, /if \(!targetSubscription\) return res\.status\(400\)\.json\(\{ message: "Подписка для опции не найдена" \}\)/);
  assert.match(validation, /select: \{ id: true \}/);
});
