import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("reissue is owned by the guarded router and is not duplicated in client routes", async () => {
  const [app, clientRoutes, botApi, frontendApi] = await Promise.all([
    readFile(new URL("../../app.ts", import.meta.url), "utf8"),
    readFile(new URL("../client/client.routes.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../../bot/src/api.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../../frontend/src/lib/api.ts", import.meta.url), "utf8"),
  ]);

  assert.match(app, /app\.use\("\/api\/client", subscriptionLinkRotationRouter\);\s*app\.use\("\/api\/client", clientRouter\);/s);
  assert.equal((clientRoutes.match(/clientRouter\.post\("\/subscription\/:type\/:id\/reissue"/g) ?? []).length, 0);

  const botReissue = botApi.slice(botApi.indexOf("export async function reissueSubscription"), botApi.indexOf("\n}", botApi.indexOf("export async function reissueSubscription")));
  const frontendReissue = frontendApi.slice(frontendApi.indexOf("async reissueSubscription("), frontendApi.indexOf("\n  },", frontendApi.indexOf("async reissueSubscription(")));
  assert.match(botReissue, /body:\s*\{\s*confirmed:\s*true\s*\}/s);
  assert.match(frontendReissue, /body:\s*JSON\.stringify\(\{\s*confirmed:\s*true\s*\}\)/s);
});
