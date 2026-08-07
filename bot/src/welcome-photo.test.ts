import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("welcome photo is uploaded by the bot instead of fetched by Telegram", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");

  assert.doesNotMatch(
    source,
    /const banner = screenBannerUrl\(config, "welcome"\);\s*if \(banner\) \{\s*const sent = await ctx\.replyWithPhoto\(banner/s,
  );
  assert.match(source, /const image = await api\.getOnboardingAsset\("welcome\.png"\)\.catch\(\(\) => null\);/);
  assert.match(source, /new InputFile\(image, "welcome\.png"\)/);
});
