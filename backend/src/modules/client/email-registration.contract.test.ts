import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");
const routes = readFileSync(new URL("./client.routes.ts", import.meta.url), "utf8");
const completion = readFileSync(new URL("./email-registration-completion.ts", import.meta.url), "utf8");

test("pending registrations can wait for the password and track verification state", () => {
  assert.match(schema, /passwordHash\s+String\?/);
  assert.match(schema, /emailVerifiedAt\s+DateTime\?/);
  assert.match(schema, /registrationIp\s+String\?/);
  assert.match(schema, /revokedAt\s+DateTime\?/);
  assert.match(schema, /deliveryState\s+String\s+@default\("SENT"\)/);
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
  assert.match(registerBlock, /getEmailRegistrationRateLimit/);
  assert.match(pendingCreateBlock, /passwordHash:\s*null/);
});

test("registration serializes limit reads with pending-row reservation", () => {
  const registerStart = routes.indexOf('clientAuthRouter.post("/register"');
  const verifyStart = routes.indexOf('const verifyEmailSchema', registerStart);
  const registerBlock = routes.slice(registerStart, verifyStart);
  const transactionStart = registerBlock.indexOf("prisma.$transaction(async (tx) =>");
  const transactionBlock = registerBlock.slice(transactionStart, registerBlock.indexOf("const verificationLink", transactionStart));
  assert.match(transactionBlock, /pg_advisory_xact_lock/);
  assert.match(transactionBlock, /tx\.pendingEmailRegistration\.findFirst/);
  assert.match(transactionBlock, /tx\.pendingEmailRegistration\.findMany/);
  assert.match(transactionBlock, /tx\.pendingEmailRegistration\.create/);
});

test("advisory transaction locks use executeRaw for void results", () => {
  const advisoryLockCalls = routes.match(/tx\.\$(?:queryRaw|executeRaw)`SELECT pg_advisory_xact_lock/g) ?? [];
  assert.equal(advisoryLockCalls.length, 3);
  assert.ok(advisoryLockCalls.every((call) => call.startsWith("tx.$executeRaw`")));
});

test("completion locks and revalidates the pending row before client creation", () => {
  const completeStart = routes.indexOf('clientAuthRouter.post("/complete-registration"');
  const nextRouteStart = routes.indexOf("/** Валидация initData", completeStart);
  const completeBlock = routes.slice(completeStart, nextRouteStart);
  assert.match(completeBlock, /completeEmailRegistration/);
  assert.match(completeBlock, /pg_advisory_xact_lock/);
  assert.match(completion, /withEmailLock/);
  assert.match(completion, /pending\.emailVerifiedAt === null/);
  assert.match(completion, /pending\.revokedAt !== null/);
  assert.match(completion, /pending\.expiresAt <= input\.now/);
  assert.match(completion, /findClientByEmail/);
  assert.match(completion, /deletePending\(pending\.id\)/);
});
