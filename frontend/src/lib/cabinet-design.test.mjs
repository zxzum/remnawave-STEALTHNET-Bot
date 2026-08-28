import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveCabinetDesign } from "./cabinet-design.ts";

test("resolves only the supported cabinet designs and defaults everything else", () => {
  assert.equal(resolveCabinetDesign("aurora"), "aurora");
  assert.equal(resolveCabinetDesign("default"), "default");
  assert.equal(resolveCabinetDesign(undefined), "default");
  assert.equal(resolveCabinetDesign(null), "default");
  assert.equal(resolveCabinetDesign("unknown"), "default");
});

test("tariff editor exposes the best-choice checkbox", async () => {
  const tariffs = await readFile(new URL("../pages/tariffs.tsx", import.meta.url), "utf8");
  assert.match(tariffs, /id="tariff-best-choice"/);
  assert.match(tariffs, /type="checkbox"/);
  assert.match(tariffs, /checked=\{isBestChoice\}/);
  assert.match(tariffs, /setIsBestChoice\(event\.target\.checked\)/);
});

test("tariff rows separate metadata from actions for clean wrapping", async () => {
  const tariffs = await readFile(new URL("../pages/tariffs.tsx", import.meta.url), "utf8");
  assert.match(tariffs, /data-tariff-meta/);
  assert.match(tariffs, /data-tariff-actions/);
});
