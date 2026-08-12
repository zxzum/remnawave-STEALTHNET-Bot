import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adminUrl = new URL("./admin.routes.ts", import.meta.url);
const clientsUrl = new URL("../../../../frontend/src/pages/clients.tsx", import.meta.url);
const tariffsUrl = new URL("../../../../frontend/src/pages/cabinet/client-tariffs.tsx", import.meta.url);
const onboardingUrl = new URL("../../../../frontend/src/pages/cabinet/client-onboarding.tsx", import.meta.url);
const settingsUrl = new URL("../../../../frontend/src/pages/settings.tsx", import.meta.url);
const trialsUrl = new URL("../../../../frontend/src/pages/trials.tsx", import.meta.url);

test("admin clients list is subscription-aware and supports subscription filters", async () => {
  const source = await readFile(adminUrl, "utf8");
  const route = source.slice(source.indexOf('adminRouter.get("/clients"'), source.indexOf('adminRouter.post("/clients/online-statuses"'));
  assert.match(route, /req\.query\.subscription/);
  assert.match(route, /ownedSubscriptions/);
  assert.match(route, /receivedSubscriptions/);
  assert.match(route, /return \{ \.\.\.client, subscriptions, remnawaveUuids \}/);
  assert.doesNotMatch(route, /activeInternalSquads\[0\]/);
  assert.match(route, /req\.query\.tariffId/);
  assert.match(route, /req\.query\.subscriptionType/);
  assert.match(route, /subscriptionType === "received"/);
  assert.match(source, /lastConnectedNodeUuid/);
  assert.match(source, /lastConnectedNode/);
});

test("client monitoring and trial conversion routes are present", async () => {
  const source = await readFile(adminUrl, "utf8");
  assert.match(source, /adminRouter\.get\("\/clients\/:id\/sessions"/);
  assert.match(source, /requestLogs: \{/);
  assert.match(source, /adminRouter\.get\("\/clients\/:id\/activity"/);
  assert.match(source, /redactAdminActivityPayload/);
  assert.match(source, /adminRouter\.post\("\/subscriptions\/:subId\/convert-trial"/);
  assert.match(source, /extendSecondarySubscription\(sub\.id/);
  assert.match(source, /convertMode=true/);
});

test("admin subscription grants permanently consume the client's trial", async () => {
  const source = await readFile(adminUrl, "utf8");
  assert.match(source, /lockTrialAfterSubscription/);

  const grantTariff = source.slice(
    source.indexOf('adminRouter.post("/clients/:id/grant-tariff"'),
    source.indexOf("const grantExtendSchema"),
  );
  assert.match(grantTariff, /lockTrialAfterSubscription\(clientId\)/);

  const grantExtend = source.slice(
    source.indexOf('adminRouter.post("/subscriptions/:subId/grant-extend"'),
    source.indexOf("const convertTrialSchema"),
  );
  assert.match(grantExtend, /lockTrialAfterSubscription\(sub\.ownerId\)/);

  const convertTrial = source.slice(
    source.indexOf('adminRouter.post("/subscriptions/:subId/convert-trial"'),
    source.indexOf("const attachRemnaSchema"),
  );
  assert.match(convertTrial, /lockTrialAfterSubscription\(sub\.ownerId\)/);

  const attachRemna = source.slice(
    source.indexOf('adminRouter.post("/clients/:id/attach-remna-subscription"'),
    source.indexOf("const squadActionSchema"),
  );
  assert.match(attachRemna, /lockTrialAfterSubscription\(clientId\)/);
});

test("empty clients keep all tabs and never render @null", async () => {
  const source = await readFile(clientsUrl, "utf8");
  assert.doesNotMatch(source, /\(editing\.remnawaveUuid \|\| secondarySubs\.length > 0\) &&/);
  assert.doesNotMatch(source, /editing\.email \|\| editing\.telegramUsername \? `@\$\{editing\.telegramUsername\}`/);
  assert.match(source, /editing\.email/);
  assert.match(source, /`tg\$\{editing\.telegramId\}`/);
  assert.match(source, /setSearchApplied\(search\)/);
  assert.match(source, /pageSize/);
  assert.match(source, /value=\{filterTariffId\}/);
  assert.match(source, /value=\{filterSubscriptionType\}/);
  assert.match(source, /value="traffic"/);
  assert.match(source, /value="activity"/);
});

test("cabinet tariff cards distinguish unlimited VPN from local whitelist quota and use included devices", async () => {
  const source = await readFile(tariffsUrl, "utf8");
  assert.match(source, /trafficLimitMode\?: "REMNAWAVE" \| "LOCAL_SQUAD"/);
  assert.match(source, /Безлимит трафика/);
  assert.match(source, /Белые списки/);
  assert.match(source, /tariff\.includedDevices/);
  assert.doesNotMatch(source, /tf\.deviceLimit != null && tf\.deviceLimit > 0/);
});

test("tariff limit propagation updates only quota base limits", async () => {
  const source = await readFile(adminUrl, "utf8");
  const route = source.slice(source.indexOf('adminRouter.patch("/tariffs/:id"'), source.indexOf('adminRouter.delete("/tariffs/:id"'));
  assert.match(route, /squadTrafficQuota\.updateMany/);
  assert.match(route, /subscription:\s*\{\s*trialId:\s*null\s*\}/);
  assert.match(route, /data:\s*\{\s*baseLimitBytes:/);
  assert.doesNotMatch(route, /data:\s*\{[^}]*usedBytes:/s);
  assert.doesNotMatch(route, /data:\s*\{[^}]*periodStartedAt:/s);
});

test("trial limit propagation updates only quotas belonging to that trial", async () => {
  const source = await readFile(adminUrl, "utf8");
  const route = source.slice(source.indexOf('adminRouter.patch("/trials/:id"'), source.indexOf('adminRouter.delete("/trials/:id"'));
  assert.match(route, /squadTrafficQuota\.updateMany/);
  assert.match(route, /subscription:\s*\{\s*trialId:\s*updatedTrial\.id\s*\}/);
  assert.match(route, /data:\s*\{\s*baseLimitBytes:\s*updatedTrial\.trafficLimitBytes/);
  assert.doesNotMatch(route, /data:\s*\{[^}]*usedBytes:/s);
});

test("trial form resolves inherited squad UUIDs to Remnawave squad names", async () => {
  const source = await readFile(trialsUrl, "utf8");
  assert.match(source, /squads\.find\(\(s\) => s\.uuid === uuid\)/);
  assert.doesNotMatch(source, /\{ uuid, name: uuid \}/);
});

test("registration onboarding 2FA step can be disabled globally", async () => {
  const [admin, onboarding, settings] = await Promise.all([
    readFile(adminUrl, "utf8"),
    readFile(onboardingUrl, "utf8"),
    readFile(settingsUrl, "utf8"),
  ]);
  assert.match(admin, /onboarding2faEnabled/);
  assert.match(onboarding, /config\?\.onboarding2faEnabled/);
  assert.match(settings, /onboarding2faEnabled/);
});
