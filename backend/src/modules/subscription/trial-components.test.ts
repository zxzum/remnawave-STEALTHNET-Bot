import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { copyTrialComponents } from "./trial-components.js";

const GiB = 1024 ** 3;

test("копирует компоненты тарифа в независимый snapshot триала", () => {
  const source = [
    { key: "primary", internalSquadUuids: ["default"], trafficLimitBytes: null },
    { key: "whitelist", internalSquadUuids: ["white"], trafficLimitBytes: 20 * GiB },
  ];

  const copy = copyTrialComponents(source);
  copy[1].internalSquadUuids.push("changed");
  copy[1].trafficLimitBytes = 5 * GiB;

  assert.deepEqual(source[1].internalSquadUuids, ["white"]);
  assert.equal(source[1].trafficLimitBytes, 20 * GiB);
});

test("backfill создаёт snapshots идемпотентно и задаёт whitelist 5 GiB", () => {
  const sql = readFileSync(
    new URL("../../../prisma/migrations/20260715120000_trial_component_snapshots/migration.sql", import.meta.url),
    "utf8",
  );

  assert.match(sql, /ON CONFLICT \("trial_id", "key"\) DO NOTHING/);
  assert.match(sql, /WHEN c\."key" = 'whitelist' THEN 5368709120/);
});
