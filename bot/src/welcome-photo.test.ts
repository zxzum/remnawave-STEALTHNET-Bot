import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("welcome photo is uploaded by the bot instead of fetched by Telegram", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");

  assert.doesNotMatch(
    source,
    /const banner = screenBannerUrl\(config, "welcome"\);\s*if \(banner\) \{\s*const sent = await ctx\.replyWithPhoto\(banner/s,
  );
  assert.doesNotMatch(source, /media:\s*banner/);
  assert.match(source, /api\.getScreenAsset\("welcome"\)/);
  assert.match(source, /const image = await api\.getOnboardingAsset\("welcome\.png"\)\.catch\(\(\) => null\);/);
  assert.match(source, /new InputFile\(image, "welcome\.png"\)/);
});

test("bot has a single error reporter for Telegram API failures", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const apiSource = await readFile(new URL("./api.ts", import.meta.url), "utf8");

  assert.match(source, /botErrorContext\.run\(ctx, next\)/);
  assert.match(source, /b\.api\.config\.use/);
  assert.match(source, /api\.reportBotError/);
  assert.match(apiSource, /reportBotError/);
});

test("returning-user menu keeps onboarding first and reuses renewal payment flow", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const welcome = source.indexOf("shouldShowBotWelcome({");
  const summary = source.indexOf("buildMainMenuSummary({");

  assert.ok(welcome >= 0 && summary > welcome);
  assert.match(source, /selectPrimarySubscription\(allSubsRes\.items/);
  assert.match(source, /supportUrl: supportBotLink\(\)/);
  assert.match(source, /renewTariffId: primarySubscription\?\.tariffId/);
  assert.match(source, /if \(data === "menu:info"\)/);
  assert.match(source, /if \(data === "menu:renew"\)/);
  assert.match(source, /data\.startsWith\("pay_tariff:"\)/);
});
