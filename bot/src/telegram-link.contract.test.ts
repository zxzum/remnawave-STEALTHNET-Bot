import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

test("deep-link success responses provide a route to the main menu", () => {
  const successBlock = source.slice(source.indexOf("async function handleTelegramLink"), source.indexOf("const DEFAULT_BOT_WELCOME_TEXT"));
  assert.match(successBlock, /reply_markup/);
  assert.match(successBlock, /menu:main/);

  const mergeBlock = source.slice(source.indexOf('if (data.startsWith("link_merge:"))'), source.indexOf('if (data.startsWith("setup:"))'));
  assert.match(mergeBlock, /reply_markup/);
  assert.match(mergeBlock, /menu:main/);
});
