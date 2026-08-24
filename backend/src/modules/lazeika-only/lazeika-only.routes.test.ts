import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";
process.env.REMNA_API_URL ??= "http://127.0.0.1:1";
process.env.REMNA_ADMIN_TOKEN ??= "test-token";

const { lazeikaSetupSchema } = await import("./lazeika-only.routes.js");

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
