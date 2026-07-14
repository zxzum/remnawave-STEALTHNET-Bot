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

test("каждый Remnawave-компонент получает уникальный upstream shortUuid", () => {
  assert.equal(typeof service.generateUpstreamShortUuid, "function");
  const generate = service.generateUpstreamShortUuid as () => string;
  const main = generate();
  const whitelist = generate();

  assert.equal(main.length, 32);
  assert.equal(whitelist.length, 32);
  assert.notEqual(main, whitelist);
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

test("нормализует состояние Remnawave для reconciliation", () => {
  assert.equal(typeof service.extractRemnawaveComponentSnapshot, "function");
  const extract = service.extractRemnawaveComponentSnapshot as (payload: unknown) => Record<string, unknown>;
  assert.deepEqual(extract({
    response: {
      uuid: "user-1",
      shortUuid: "shared-token",
      expireAt: "2026-08-14T12:00:00.000Z",
      status: "ACTIVE",
      hwidDeviceLimit: 3,
      trafficLimitBytes: "53687091200",
      activeInternalSquads: [{ uuid: "default" }, { uuid: "reserve" }],
    },
  }), {
    uuid: "user-1",
    shortUuid: "shared-token",
    expireAt: "2026-08-14T12:00:00.000Z",
    status: "ACTIVE",
    hwidDeviceLimit: 3,
    trafficLimitBytes: 53687091200n,
    internalSquadUuids: ["default", "reserve"],
  });
});

test("распознаёт служебные component usernames при импорте", () => {
  assert.equal(typeof service.isManagedComponentUsername, "function");
  const isManaged = service.isManagedComponentUsername as (username: string | null) => boolean;
  assert.equal(isManaged("alex_c_limited_0"), true);
  assert.equal(isManaged("alex_WL"), true);
  assert.equal(isManaged("alex"), false);
});

test("grace window ограничен числом дней после окончания", () => {
  assert.equal(typeof service.computeExpiredGraceWindow, "function");
  const compute = service.computeExpiredGraceWindow as (
    expireAt: Date,
    days: number,
    now: Date,
  ) => { active: boolean; graceUntil: Date };
  const inside = compute(new Date("2026-07-10T00:00:00.000Z"), 7, new Date("2026-07-14T00:00:00.000Z"));
  assert.equal(inside.active, true);
  assert.equal(inside.graceUntil.toISOString(), "2026-07-17T00:00:00.000Z");
  assert.equal(compute(new Date("2026-07-10T00:00:00.000Z"), 3, new Date("2026-07-14T00:00:00.000Z")).active, false);
});

test("в grace only_telegram остаётся только у обязательного компонента", () => {
  assert.equal(typeof service.expiredGraceComponentPolicy, "function");
  const policy = service.expiredGraceComponentPolicy as (required: boolean, squadUuid: string) => {
    activeInternalSquads: string[];
    enabled: boolean;
  };

  assert.deepEqual(policy(true, "only-telegram"), {
    activeInternalSquads: ["only-telegram"],
    enabled: true,
  });
  assert.deepEqual(policy(false, "only-telegram"), {
    activeInternalSquads: [],
    enabled: false,
  });
});
