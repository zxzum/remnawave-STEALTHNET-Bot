import assert from "node:assert/strict";
import test from "node:test";

const traffic = (await import("./traffic.js").catch(() => ({}))) as Record<string, unknown>;

test("локальная квота отображается в боте числом и понятной шкалой", () => {
  assert.equal(typeof traffic.formatTrafficLine, "function");
  const line = (traffic.formatTrafficLine as (input: Record<string, unknown>) => string)({
    remoteUsedBytes: 100 * 1024 ** 2,
    remoteLimitBytes: 0,
    localQuota: {
      usedBytes: String(100 * 1024 ** 2),
      limitBytes: String(20 * 1024 ** 3),
    },
  });
  assert.equal(line, "📈 Трафик — 0.10 / 20.00 GB\n█░░░░░░░░░ 0.5%");
});
