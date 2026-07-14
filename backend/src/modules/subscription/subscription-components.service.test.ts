import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";

const service = (await import("./subscription-components.service.js").catch(() => ({}))) as Record<string, unknown>;

type ComponentTarget = { key: string; required: boolean; mergeOrder: number };

const components: ComponentTarget[] = [
  { key: "primary", required: true, mergeOrder: 0 },
  { key: "limited", required: false, mergeOrder: 10 },
];

test("частичная ошибка необязательного компонента не становится required failure", async () => {
  assert.equal(typeof service.runComponentOperations, "function");

  const run = service.runComponentOperations as (
    targets: ComponentTarget[],
    operation: (component: ComponentTarget) => Promise<void>,
  ) => Promise<{ failures: Array<{ key: string }>; requiredFailure: boolean }>;
  const result = await run(components, async (component) => {
    if (component.key === "limited") throw new Error("temporary outage");
  });

  assert.equal(result.requiredFailure, false);
  assert.deepEqual(result.failures.map((failure) => failure.key), ["limited"]);
});

test("ошибка обязательного компонента помечается required failure", async () => {
  assert.equal(typeof service.runComponentOperations, "function");

  const run = service.runComponentOperations as (
    targets: ComponentTarget[],
    operation: (component: ComponentTarget) => Promise<void>,
  ) => Promise<{ failures: Array<{ key: string }>; requiredFailure: boolean }>;
  const result = await run(components, async (component) => {
    if (component.required) throw new Error("main unavailable");
  });

  assert.equal(result.requiredFailure, true);
  assert.deepEqual(result.failures.map((failure) => failure.key), ["primary"]);
});

test("имя компонента детерминировано и помещается в лимит Remnawave", () => {
  assert.equal(typeof service.buildComponentUsername, "function");

  const build = service.buildComponentUsername as (base: string, key: string, index: number) => string;
  const username = build("very-long-existing-remnawave-username", "Corporate Streaming", 12);

  assert.equal(username.length <= 36, true);
  assert.match(username, /^[a-zA-Z0-9_-]+$/);
  assert.equal(username, build("very-long-existing-remnawave-username", "Corporate Streaming", 12));
});

test("собирает уникальные Remnawave UUID обязательного и дополнительных компонентов", () => {
  assert.equal(typeof service.subscriptionRemnawaveUuids, "function");
  const collect = service.subscriptionRemnawaveUuids as (subscription: unknown) => string[];
  assert.deepEqual(collect({
    remnawaveUuid: "main",
    components: [
      { remnawaveUuid: "main", mergeOrder: 0 },
      { remnawaveUuid: "limited", mergeOrder: 10 },
      { remnawaveUuid: null, mergeOrder: 20 },
    ],
  }), ["main", "limited"]);
});

test("объединяет одинаковый HWID нескольких компонентов в одно устройство", () => {
  assert.equal(typeof service.mergeComponentDevices, "function");
  const mergeDevices = service.mergeComponentDevices as (payloads: unknown[]) => Array<{ hwid: string }>;
  const result = mergeDevices([
    { response: { devices: [{ hwid: "same", platform: "iOS" }, { hwid: "main-only" }] } },
    { response: { devices: [{ hwid: "same", deviceModel: "iPhone" }, { hwid: "limited-only" }] } },
  ]);
  assert.deepEqual(result.map((device) => device.hwid), ["same", "main-only", "limited-only"]);
});

test("формирует клиентскую квоту компонента из traffic статистики Remnawave", () => {
  assert.equal(typeof service.componentQuotaFromRemna, "function");
  const quota = service.componentQuotaFromRemna as (component: unknown, payload: unknown, now?: Date) => Record<string, unknown>;
  assert.deepEqual(quota({
    key: "limited",
    quotaDisplayName: "WhiteList",
    trafficLimitBytes: 100n,
    trafficResetMode: "monthly",
  }, {
    response: { status: "LIMITED", userTraffic: { usedTrafficBytes: 70 } },
  }, new Date("2026-07-14T12:00:00.000Z")), {
    key: "limited",
    displayName: "WhiteList",
    limitBytes: "100",
    usedBytes: "70",
    remainingBytes: "30",
    resetMode: "monthly",
    nextResetAt: "2026-08-01T00:00:00.000Z",
    status: "LIMITED",
  });
});
