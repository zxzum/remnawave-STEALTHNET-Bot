import assert from "node:assert/strict";
import test from "node:test";

test("formats email reminder time in readable Russian units", async () => {
  let email: typeof import("./expiry-email-notify.service.js") | null = null;
  try {
    email = await import("./expiry-email-notify.service.js");
  } catch {
    // RED: module is not implemented yet
  }
  assert.equal(typeof email?.formatExpiryEmailTime, "function");
  if (!email) return;
  assert.equal(email.formatExpiryEmailTime(1440), "1 день");
  assert.equal(email.formatExpiryEmailTime(90), "1.5 часа");
  assert.equal(email.formatExpiryEmailTime(30), "30 минут");
});

test("builds escaped variables and cabinet URL for the selected email kind", async () => {
  let email: typeof import("./expiry-email-notify.service.js") | null = null;
  try {
    email = await import("./expiry-email-notify.service.js");
  } catch {
    // RED: module is not implemented yet
  }
  assert.equal(typeof email?.expiryEmailTemplateKey, "function");
  if (!email) return;
  assert.equal(email.expiryEmailTemplateKey("trial"), "trial_expiring");
  assert.equal(email.expiryEmailTemplateKey("subscription"), "subscription_expiring");
  assert.deepEqual(email.buildExpiryEmailVariables("trial", "<Триал>", 1440, {
    serviceName: "Лазейка ВПН",
    publicAppUrl: "https://vpn.example/",
  }), {
    serviceName: "Лазейка ВПН",
    trialName: "&lt;Триал&gt;",
    tariffName: "&lt;Триал&gt;",
    timeLeft: "1 день",
    daysLeft: "1",
    renewUrl: "https://vpn.example/cabinet",
  });
});

test("email template catalog contains wired trial and subscription expiry templates", async () => {
  const { TEMPLATES } = await import("../email-templates/email-templates.service.js");
  const trial = TEMPLATES.find((item) => item.key === "trial_expiring");
  const subscription = TEMPLATES.find((item) => item.key === "subscription_expiring");
  assert.equal(trial?.wired, true);
  assert.match(trial?.defaultBody ?? "", /\{\{timeLeft\}\}/);
  assert.equal(subscription?.wired, true);
  assert.match(subscription?.defaultBody ?? "", /\{\{timeLeft\}\}/);
});
