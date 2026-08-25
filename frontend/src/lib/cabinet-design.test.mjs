import test from "node:test";
import assert from "node:assert/strict";
import { resolveCabinetDesign } from "./cabinet-design.ts";

test("resolves only the supported cabinet designs and defaults everything else", () => {
  assert.equal(resolveCabinetDesign("aurora"), "aurora");
  assert.equal(resolveCabinetDesign("default"), "default");
  assert.equal(resolveCabinetDesign(undefined), "default");
  assert.equal(resolveCabinetDesign(null), "default");
  assert.equal(resolveCabinetDesign("unknown"), "default");
});
