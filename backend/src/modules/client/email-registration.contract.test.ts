import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");
const routes = readFileSync(new URL("./client.routes.ts", import.meta.url), "utf8");

test("pending registrations can wait for the password and track verification state", () => {
  assert.match(schema, /passwordHash\s+String\?/);
  assert.match(schema, /emailVerifiedAt\s+DateTime\?/);
  assert.match(schema, /registrationIp\s+String\?/);
  assert.match(schema, /revokedAt\s+DateTime\?/);
});

test("verification does not create a client and completion owns client creation", () => {
  const verifyStart = routes.indexOf('clientAuthRouter.post("/verify-email"');
  const loginStart = routes.indexOf("const loginSchema", verifyStart);
  const verifyBlock = routes.slice(verifyStart, loginStart);
  assert.doesNotMatch(verifyBlock, /prisma\.client\.create/);
  assert.match(verifyBlock, /emailVerifiedAt/);
  assert.match(routes, /clientAuthRouter.post\("\/complete-registration"/);
});

test("registration sends no password hash before the email is verified", () => {
  const registerStart = routes.indexOf('clientAuthRouter.post("/register"');
  const verifyStart = routes.indexOf('const verifyEmailSchema', registerStart);
  const registerBlock = routes.slice(registerStart, verifyStart);
  const pendingCreateStart = registerBlock.indexOf("pendingEmailRegistration.create");
  const pendingCreateEnd = registerBlock.indexOf("});", pendingCreateStart);
  const pendingCreateBlock = registerBlock.slice(pendingCreateStart, pendingCreateEnd);
  assert.match(registerBlock, /pendingEmailRegistration\.create/);
  assert.match(registerBlock, /getEmailRegistrationRetryAfter/);
  assert.match(pendingCreateBlock, /passwordHash:\s*null/);
});
