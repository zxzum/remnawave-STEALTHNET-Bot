import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/cabinet/store/AppContext.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../src/lib/api.ts", import.meta.url), "utf8");

test("linking reserves a synchronous popup and handles iOS page restoration", () => {
  assert.match(source, /window\.open\("about:blank"/);
  assert.match(source, /pageshow/);
  assert.match(source, /inFlight|linkPromise|telegramLinkPromise|telegramLinkActive|linkSession/);
});

test("active cabinet exposes unlink API", () => {
  assert.match(api, /clientUnlinkTelegram/);
  assert.match(api, /\/client\/unlink-telegram/);
});
