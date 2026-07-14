import assert from "node:assert/strict";
import test from "node:test";

const helpers = (await import("./subscription.helpers.js")) as Record<string, unknown>;

test("генерирует непрозрачный URL-safe токен подписки", () => {
  assert.equal(typeof helpers.generatePublicSubscriptionToken, "function");

  const generate = helpers.generatePublicSubscriptionToken as () => string;
  const first = generate();
  const second = generate();

  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
});

test("использует сохранённые компоненты в порядке mergeOrder", () => {
  assert.equal(typeof helpers.resolveRemnawaveComponents, "function");

  const resolve = helpers.resolveRemnawaveComponents as (subscription: unknown) => Array<{ key: string }>;
  const result = resolve({
    id: "sub-1",
    remnawaveUuid: "legacy-main",
    components: [
      { key: "streaming", mergeOrder: 20 },
      { key: "primary", mergeOrder: 0 },
    ],
  });

  assert.deepEqual(result.map((component) => component.key), ["primary", "streaming"]);
});

test("синтезирует обязательный legacy-компонент до завершения backfill", () => {
  assert.equal(typeof helpers.resolveRemnawaveComponents, "function");

  const resolve = helpers.resolveRemnawaveComponents as (subscription: unknown) => Array<{
    key: string;
    required: boolean;
    remnawaveUuid: string | null;
  }>;
  const result = resolve({ id: "sub-1", remnawaveUuid: "legacy-main", components: [] });

  assert.equal(result.length, 1);
  assert.equal(result[0]?.key, "primary");
  assert.equal(result[0]?.required, true);
  assert.equal(result[0]?.remnawaveUuid, "legacy-main");
});

test("подставляет legacy UUID в незавершённый backfill обязательного компонента", () => {
  const resolve = helpers.resolveRemnawaveComponents as (subscription: unknown) => Array<{
    required: boolean;
    remnawaveUuid: string | null;
  }>;
  const result = resolve({
    id: "sub-1",
    remnawaveUuid: "legacy-main",
    components: [{ key: "primary", required: true, mergeOrder: 0, remnawaveUuid: null }],
  });

  assert.equal(result[0]?.remnawaveUuid, "legacy-main");
});

test("не создаёт фиктивный компонент без Remnawave UUID", () => {
  assert.equal(typeof helpers.resolveRemnawaveComponents, "function");

  const resolve = helpers.resolveRemnawaveComponents as (subscription: unknown) => unknown[];
  assert.deepEqual(resolve({ id: "sub-1", remnawaveUuid: null, components: [] }), []);
});

test("строит публичный URL без зависимости от формата токена", () => {
  assert.equal(typeof helpers.buildPublicSubscriptionUrl, "function");

  const build = helpers.buildPublicSubscriptionUrl as (baseUrl: string, token: string) => string;
  assert.equal(
    build("https://cabinet.example.com/", "opaque_token-1"),
    "https://cabinet.example.com/api/sub/opaque_token-1",
  );
});
