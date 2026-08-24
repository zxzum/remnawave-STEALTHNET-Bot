import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";
process.env.REMNA_API_URL ??= "http://127.0.0.1:1";
process.env.REMNA_ADMIN_TOKEN ??= "test-token";

const { lazeikaSetupSchema, lazeikaVerifySchema } = await import("./lazeika-only.routes.js");

const VALID = {
  nodeUuid: "11111111-1111-1111-1111-111111111111",
  ssh: { user: "root", port: 22, password: "secret" },
};

test("setup route schema accepts valid input and passes params through", () => {
  const parsed = lazeikaSetupSchema.safeParse(VALID);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.nodeUuid, VALID.nodeUuid);
    assert.equal(parsed.data.ssh.port, 22);
    assert.equal(parsed.data.ssh.user, "root");
  }
});

test("setup route schema strips legacy profileMode instead of applying it", () => {
  const parsed = lazeikaSetupSchema.safeParse({ ...VALID, profileMode: "CLONE" });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.ok(!("profileMode" in parsed.data), "profileMode не доходит до сервиса");
  }
});

test("setup route schema requires ssh credentials", () => {
  const parsed = lazeikaSetupSchema.safeParse({ nodeUuid: VALID.nodeUuid });
  assert.equal(parsed.success, false);
});

test("setup route schema rejects invalid nodeUuid and ssh port", () => {
  assert.equal(lazeikaSetupSchema.safeParse({ ...VALID, nodeUuid: "not-a-uuid" }).success, false);
  assert.equal(
    lazeikaSetupSchema.safeParse({ ...VALID, ssh: { user: "root", port: 70000, password: "x" } }).success,
    false,
  );
  assert.equal(
    lazeikaSetupSchema.safeParse({ ...VALID, ssh: { user: "root", port: 22, password: "" } }).success,
    false,
  );
});

test("reconcile schema strips nodeUuid/squadUuid/speedMbit from body (SSH only)", () => {
  // Reconcile обязан игнорировать всё, кроме ssh: нода/squad/скорость берутся из настроек.
  const parsed = lazeikaVerifySchema.safeParse({
    ssh: { user: "root", port: 22, password: "x" },
    nodeUuid: "99999999-9999-9999-9999-999999999999",
    squadUuid: "33333333-3333-3333-3333-333333333333",
    speedMbit: 1000,
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.deepEqual(Object.keys(parsed.data), ["ssh"], "кроме ssh ничего не доходит до сервиса");
  }
  assert.equal(lazeikaVerifySchema.safeParse({}).success, false, "без ssh — ошибка");
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
