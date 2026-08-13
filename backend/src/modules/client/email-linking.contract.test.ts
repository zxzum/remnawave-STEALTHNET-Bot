import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateEmailForSignup } from "../signup-protection/email-blocklist.js";

const routes = readFileSync(new URL("./client.routes.ts", import.meta.url), "utf8");

test("email linking applies the same blocklist validation as email registration", () => {
  assert.equal(validateEmailForSignup("USER@MAILINATOR.COM").ok, false);

  for (const route of ["/register", "/link-email-direct", "/link-email-request"]) {
    const start = routes.indexOf(`\"${route}\"`);
    const end = routes.indexOf("\n});", start) + 4;
    assert.match(routes.slice(start, end), /validateEmailForSignup/);
  }
});

test("profile uses direct linking when email verification is unavailable or disabled", () => {
  const profile = readFileSync(new URL("../../../../frontend/src/cabinet/pages/Profile.tsx", import.meta.url), "utf8");
  assert.match(profile, /config\?\.skipEmailVerification \|\| !config\?\.smtpConfigured/);
  assert.match(profile, /api\.clientLinkEmailDirect/);
  assert.match(profile, /api\.clientLinkEmailRequest/);
});
