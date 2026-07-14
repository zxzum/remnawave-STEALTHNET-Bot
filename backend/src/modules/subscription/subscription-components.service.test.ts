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
