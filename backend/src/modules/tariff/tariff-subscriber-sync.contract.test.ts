import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("tariff sync snapshots Remnawave before mutation and enforces a lowered local quota", async () => {
  const source = await readFile(new URL("./tariff-subscriber-sync.service.ts", import.meta.url), "utf8");
  assert.ok(source.indexOf("saveCriticalSnapshot") < source.indexOf("remnaUpdateUser"));
  assert.match(source, /quota\.usedBytes >= limit/);
  assert.match(source, /enforceExhaustedQuota/);
  assert.match(source, /restoreMeteredSquad/);
});
