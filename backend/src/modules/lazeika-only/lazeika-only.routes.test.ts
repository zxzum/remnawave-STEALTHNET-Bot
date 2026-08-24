import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";
process.env.REMNA_API_URL ??= "http://127.0.0.1:1";
process.env.REMNA_ADMIN_TOKEN ??= "test-token";

const { lazeikaSetupSchema, lazeikaVerifySchema } = await import("./lazeika-only.routes.js");

const VALID = {
  nodeUuid: "11111111-1111-1111-1111-111111111111",
};

test("setup route schema accepts valid input and passes params through", () => {
  const parsed = lazeikaSetupSchema.safeParse(VALID);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.nodeUuid, VALID.nodeUuid);
    assert.equal(parsed.data.profileMode, "IN_PLACE");
  }
});

test("setup route schema accepts both profile modes", () => {
  const parsed = lazeikaSetupSchema.safeParse({ ...VALID, profileMode: "CLONE" });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.profileMode, "CLONE");
  }
});

test("setup route schema does not require ssh credentials", () => {
  const parsed = lazeikaSetupSchema.safeParse({ nodeUuid: VALID.nodeUuid });
  assert.equal(parsed.success, true);
});

test("setup route schema rejects invalid nodeUuid", () => {
  assert.equal(lazeikaSetupSchema.safeParse({ ...VALID, nodeUuid: "not-a-uuid" }).success, false);
});

test("verify/reconcile schemas accept an empty body", () => {
  const parsed = lazeikaVerifySchema.safeParse({
    nodeUuid: "99999999-9999-9999-9999-999999999999",
    squadUuid: "33333333-3333-3333-3333-333333333333",
    speedMbit: 1000,
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.deepEqual(Object.keys(parsed.data), [], "в body ничего не требуется");
  }
  assert.equal(lazeikaVerifySchema.safeParse({}).success, true, "SSH не требуется");
});

test("disable route delegates lock check + flags write to the atomic service op", async () => {
  // Порядок критичен: при активном setup endpoint обязан вернуть 409, не изменив настройки.
  // Запись флагов выполняет сервис внутри той же транзакции, что и CAS state (§10 ревью).
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./lazeika-only.routes.ts", import.meta.url), "utf8");
  const disableRoute = src.match(/post\("\/disable"[\s\S]*?\n\}\);/)?.[0] ?? "";
  assert.ok(disableRoute, "route /disable найден");
  assert.ok(disableRoute.includes("service().disable()"), "route делегирует сервису");
  assert.ok(!disableRoute.includes("lazeika_only_enabled"), "route НЕ пишет флаги до/вне сервисной транзакции");
  const resetRoute = src.match(/post\("\/reset-state"[\s\S]*?\n\}\);/)?.[0] ?? "";
  assert.ok(resetRoute, "route /reset-state найден");
  assert.ok(!resetRoute.includes("lazeika_only_profile_uuid"), "route НЕ очищает ключи вне сервисной транзакции");
});

test("status is never cached because it contains the live node list", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./lazeika-only.routes.ts", import.meta.url), "utf8");
  const statusRoute = src.match(/get\("\/status"[\s\S]*?\n\}\);/)?.[0] ?? "";
  assert.ok(statusRoute.includes('Cache-Control", "no-store"'), "живой список нод не берётся из старого HTTP-кэша");
});
