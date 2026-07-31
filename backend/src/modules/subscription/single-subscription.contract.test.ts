import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { extractRemnaSubscriptionUrl } from "./subscription-url.js";

const runtimeFiles = [
  "../admin/admin.routes.ts",
  "../bot-admin/bot-admin.routes.ts",
  "../client/client.routes.ts",
  "../client/client-bulk-ops.service.ts",
  "../contest/contest.admin.routes.ts",
  "../extra-options/extra-options.service.ts",
  "../gift/gift.service.ts",
  "../notification/telegram-notify.service.ts",
  "../sync/sync.service.ts",
  "../tariff/tariff-activation.service.ts",
  "./extras.helper.ts",
];

const subscriptionMutationFiles = [
  "../client/client.routes.ts",
  "../extra-options/extra-options.service.ts",
  "../gift/gift.service.ts",
  "../tariff/tariff-activation.service.ts",
  "./extras.helper.ts",
];

test("returns the direct Remnawave subscription URL", () => {
  assert.equal(
    extractRemnaSubscriptionUrl({ response: { subscriptionUrl: "https://sub.lazeika.xyz/w4Q1vC-beWy-Rzbg" } }),
    "https://sub.lazeika.xyz/w4Q1vC-beWy-Rzbg",
  );
});

test("rejects every non-production or non-short-id subscription URL", () => {
  const invalid = [
    "http://sub.lazeika.xyz/w4Q1vC-beWy-Rzbg",
    "https://evil.example/w4Q1vC-beWy-Rzbg",
    "https://sub.lazeika.xyz:8443/w4Q1vC-beWy-Rzbg",
    "https://user:pass@sub.lazeika.xyz/w4Q1vC-beWy-Rzbg",
    "https://sub.lazeika.xyz/w4Q1vC-beWy-Rzbg?x=1",
    "https://sub.lazeika.xyz/w4Q1vC-beWy-Rzbg#x",
    "https://sub.lazeika.xyz/one/two",
    "https://sub.lazeika.xyz/",
    "https://sub.lazeika.xyz/a%2Fb",
    "https://sub.lazeika.xyz/has.dot",
  ];
  for (const subscriptionUrl of invalid) {
    assert.equal(extractRemnaSubscriptionUrl({ response: { subscriptionUrl } }), null, subscriptionUrl);
  }
  for (const shortId of ["w4Q1vC-beWy-Rzbg", "abc_DEF-123"]) {
    assert.equal(
      extractRemnaSubscriptionUrl({ data: { subscriptionUrl: `https://sub.lazeika.xyz/${shortId}` } }),
      `https://sub.lazeika.xyz/${shortId}`,
    );
  }
});

test("runtime does not use composite component operations", async () => {
  const obsoleteOperations = new RegExp([
    ["select", "Component", "Targets"].join(""),
    ["synchronize", "Subscription", "Components"].join(""),
    ["run", "Subscription", "Component", "Operation"].join(""),
  ].join("|"));
  for (const relative of runtimeFiles) {
    const source = await readFile(new URL(relative, import.meta.url), "utf8");
    assert.doesNotMatch(source, obsoleteOperations);
  }
});

test("subscription mutation flows do not write component records", async () => {
  const sources = await Promise.all(subscriptionMutationFiles.map((relative) => readFile(new URL(relative, import.meta.url), "utf8")));
  assert.doesNotMatch(sources.join("\n"), /prisma\.remnawaveComponent\./);
});

test("owned subscription flows have no legacy component runtime tails", async () => {
  const sources = await Promise.all(subscriptionMutationFiles.map((relative) => readFile(new URL(relative, import.meta.url), "utf8")));
  assert.doesNotMatch(
    sources.join("\n"),
    /subscriptionRemnawaveUuids|mergeComponentDevices|componentQuotaFromRemna|deleteSubscriptionComponents|revokeSubscriptionComponents|components\s*:\s*\{\s*(?:where|select|orderBy)/,
  );
});

test("contest prizes and device extras update only the owning Remnawave UUID", async () => {
  const [contest, extras] = await Promise.all([
    readFile(new URL("../contest/contest.admin.routes.ts", import.meta.url), "utf8"),
    readFile(new URL("./extras.helper.ts", import.meta.url), "utf8"),
  ]);
  assert.match(contest, /remnaUpdateUser\(\{ uuid: subscription\.remnawaveUuid, expireAt: newExpireAt \}\)/);
  assert.match(extras, /removePaidExtrasFromRemna\(sub\.remnawaveUuid, includedDevices/);
  assert.match(extras, /remnaUpdateUser\(\{ uuid: sub\.remnawaveUuid, hwidDeviceLimit: newDevices \}\)/);
  assert.doesNotMatch([contest, extras].join("\n"), /\bcomponents\s*:/);
});

test("retained deletion tombstones are excluded from trial replacement and owned user lists", async () => {
  const [clientSource, giftSource, tariffSource] = await Promise.all([
    readFile(new URL("../client/client.routes.ts", import.meta.url), "utf8"),
    readFile(new URL("../gift/gift.service.ts", import.meta.url), "utf8"),
    readFile(new URL("../tariff/tariff-activation.service.ts", import.meta.url), "utf8"),
  ]);
  assert.match(tariffSource, /trialId:\s*\{ not: null \}[\s\S]{0,100}deletionRequestedAt:\s*null/);
  assert.match(clientSource, /deletionRequestedAt:\s*null/);
  assert.match(giftSource, /deletionRequestedAt:\s*null/);
});

test("admin subscription lists exclude pending deletion tombstones", async () => {
  const source = await readFile(new URL("../admin/admin.routes.ts", import.meta.url), "utf8");
  const overview = source.slice(
    source.indexOf('adminRouter.get("/clients/:id/subscriptions-overview"'),
    source.indexOf('adminRouter.post("/clients/:id/remna/link"'),
  );
  const clientList = source.slice(
    source.indexOf('adminRouter.get("/clients/:id/subscriptions"'),
    source.indexOf('/** GET Remna user данных для подписки'),
  );
  assert.match(overview, /deletionRequestedAt:\s*null/);
  assert.match(clientList, /deletionRequestedAt:\s*null/);
});

test("auto-renew excludes retained deletion tombstones from every subscription path", async () => {
  const source = await readFile(new URL("../payment/auto-renew.cron.ts", import.meta.url), "utf8");
  const orphanStart = source.indexOf("const orphans = await prisma.subscription.findMany");
  const secondaryStart = source.indexOf("const secondaries = await prisma.subscription.findMany");
  const primaryGuardStart = source.indexOf("const primaryHasAutoRenew = await prisma.subscription.findUnique");
  const orphanQuery = source.slice(orphanStart, source.indexOf("for (const o of orphans)", orphanStart));
  const secondaryQuery = source.slice(secondaryStart, source.indexOf("for (const sec of secondaries)", secondaryStart));
  const primaryGuard = source.slice(primaryGuardStart, source.indexOf("\n    try {", primaryGuardStart));
  assert.match(orphanQuery, /deletionRequestedAt:\s*null/);
  assert.match(secondaryQuery, /deletionRequestedAt:\s*null/);
  assert.match(primaryGuard, /deletionRequestedAt:\s*true/);
  assert.match(primaryGuard, /primaryHasAutoRenew\?\.deletionRequestedAt/);
});

test("gift identity binding uses retry-aware single-subscription operations", async () => {
  const source = await readFile(new URL("../gift/gift.service.ts", import.meta.url), "utf8");
  assert.match(source, /runSingleSubscriptionOperation/);
  assert.equal(source.match(/bindGiftSubscriptionIdentity\(/g)?.length, 3);
  assert.doesNotMatch(source, /remnaUpdateUser\([\s\S]{0,300}\.catch\(/);
});

test("purchase, renewal, gift, and extra-option flows create at most one Remnawave user", async () => {
  const [tariffSource, giftSource, extraOptionSource] = await Promise.all([
    readFile(new URL("../tariff/tariff-activation.service.ts", import.meta.url), "utf8"),
    readFile(new URL("../gift/gift.service.ts", import.meta.url), "utf8"),
    readFile(new URL("../extra-options/extra-options.service.ts", import.meta.url), "utf8"),
  ]);
  const flows = [
    tariffSource.slice(tariffSource.indexOf("export async function activateTariffForClient"), tariffSource.indexOf("export async function extendSecondarySubscription")),
    tariffSource.slice(tariffSource.indexOf("export async function extendSecondarySubscription"), tariffSource.indexOf("export async function findConvertibleSubscription")),
    giftSource.slice(giftSource.indexOf("export async function createAdditionalSubscription"), giftSource.indexOf("export async function activateForSelf")),
    extraOptionSource.slice(extraOptionSource.indexOf("export async function applyExtraOptionByPaymentId")),
  ];
  for (const source of flows) {
    assert.ok((source.match(/\bremnaCreateUser\s*\(/g)?.length ?? 0) <= 1);
  }
  const giftFlow = flows[2];
  assert.equal(giftFlow.match(/\bcreateRemnaGiftUserOnce\s*\(/g)?.length ?? 0, 1);
  assert.doesNotMatch(giftFlow, /\bsecondaryRemnaUsername\s*\(|\bremnaCreateUser\s*\(|(?:const|let)\s+\w+\s*=\s*createRemnaGiftUserOnce/);
  assert.doesNotMatch(giftFlow, /\b(?:for|while)\s*\(|\bdo\s*\{/);
});

test("runtime does not expose STEALTHNET subscription proxy routes", async () => {
  const app = await readFile(new URL("../../app.ts", import.meta.url), "utf8");
  const frontendApp = await readFile(new URL("../../../../frontend/src/App.tsx", import.meta.url), "utf8");
  const sources = await Promise.all(runtimeFiles.map((relative) => readFile(new URL(relative, import.meta.url), "utf8")));
  assert.doesNotMatch([app, frontendApp, ...sources].join("\n"), /publicSubscriptionToken|publicSubscriptionUrlForRequest|buildPublicSubscriptionUrl|\/api\/sub|\/api\/public-subscription|public\/subscription-page/);
});

test("backend cannot fetch public subscription bodies on behalf of clients", async () => {
  const source = await readFile(new URL("../remna/remna.client.ts", import.meta.url), "utf8");
  const obsoleteFetch = new RegExp(["remna", "Fetch", "Subscription"].join(""), "i");
  assert.doesNotMatch(source, obsoleteFetch);
  assert.doesNotMatch(source, /clientHeaders|Subscription upstream error/);
});

test("client subscription URL paths stay direct and revoke one Remnawave user", async () => {
  const source = await readFile(new URL("../client/client.routes.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /encryptSubscriptionUrlInPlace|revokeSubscriptionComponents/);
  assert.match(source, /await remnaRevokeUserSubscription\(sub\.remnawaveUuid\)/);
});

test("admin subscription URLs use the owning Subscription Remnawave UUID", async () => {
  const source = await readFile(new URL("../admin/admin.routes.ts", import.meta.url), "utf8");
  assert.equal(
    source.match(/subscriptionUrl:\s*extractRemnaSubscriptionUrl\(ownerResult\?\.data\)/g)?.length,
    3,
  );
  assert.doesNotMatch(source, /subscriptionUrl:\s*extractRemnaSubscriptionUrl\((?:r|required\.result)\.data\)/);
});
