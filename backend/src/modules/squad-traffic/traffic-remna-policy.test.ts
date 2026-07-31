import assert from "node:assert/strict";
import test from "node:test";

import { remnaTrafficSettings } from "./traffic-remna-policy.js";

test("uses an unlimited Remnawave limit for a locally metered squad", () => {
  assert.deepEqual(
    remnaTrafficSettings({
      trafficLimitBytes: 322_122_547n,
      trafficLimitMode: "LOCAL_SQUAD",
      trafficResetMode: "monthly",
    }),
    { trafficLimitBytes: 0, trafficLimitStrategy: "NO_RESET" },
  );
});

test("preserves the tariff limit for the Remnawave mode", () => {
  assert.deepEqual(
    remnaTrafficSettings({
      trafficLimitBytes: 322_122_547n,
      trafficLimitMode: "REMNAWAVE",
      trafficResetMode: "monthly",
    }),
    { trafficLimitBytes: 322_122_547, trafficLimitStrategy: "MONTH" },
  );
});
