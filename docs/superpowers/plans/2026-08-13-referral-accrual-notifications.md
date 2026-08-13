# Referral Accrual Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send lightweight Telegram and email notifications after each committed referral reward.

**Architecture:** Keep `distributeReferralRewards` as the only integration point. Return delivery data from its existing transaction, then use the existing Telegram and mail transports after commit so delivery failures cannot roll back money.

**Tech Stack:** TypeScript, Node.js test runner, Prisma, existing Telegram Bot API sender, existing SMTP/Resend mail service.

## Global Constraints

- Product name is Лазейка ВПН; STEALTHNET remains only in legacy technical identifiers.
- Show referral level, credited amount, and resulting balance.
- Never include the referred client's identity.
- Add no dependencies, queues, settings, migrations, or tables.
- Delivery failure must not fail or roll back the referral credit.

---

### Task 1: Notify Referral Accruals

**Files:**
- Modify: `backend/src/modules/referral/referral.service.ts`
- Create: `backend/src/modules/referral/referral-notification.ts`
- Create: `backend/src/modules/referral/referral-notification.test.ts`

**Interfaces:**
- Consumes: `sendTelegramToUser`, `mailConfigFromSystem`, `isMailConfigured`, and `sendEmail` from existing notification/mail modules.
- Produces: `buildReferralAccrualNotification(data)` returning `{ subject, text, html }`; `distributeReferralRewards(paymentId)` keeps its existing public result shape.

- [x] **Step 1: Write the failing message test**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildReferralAccrualNotification } from "./referral-notification.js";

test("referral accrual message contains level, amount and balance only", () => {
  assert.deepEqual(
    buildReferralAccrualNotification({ level: 2, amount: 125.5, balance: 375.75, currency: "rub" }),
    {
      subject: "Реферальное начисление — Лазейка ВПН",
      text: "💰 <b>Реферальное начисление</b>\n\nУровень: <b>2</b>\nНачислено: <b>125.50 RUB</b>\nБаланс: <b>375.75 RUB</b>",
      html: "<h2>Реферальное начисление</h2><p>Уровень: <strong>2</strong></p><p>Начислено: <strong>125.50 RUB</strong></p><p>Баланс: <strong>375.75 RUB</strong></p>",
    },
  );
});
```

- [x] **Step 2: Run the test and verify RED**

Run: `npm exec tsx -- --test src/modules/referral/referral-notification.test.ts`

Expected: FAIL because `referral-notification.ts` does not exist.

- [x] **Step 3: Add the minimal renderer and post-commit delivery**

Add the pure renderer to `referral-notification.ts` and import it in `referral.service.ts`:

```ts
export function buildReferralAccrualNotification(data: {
  level: number;
  amount: number;
  balance: number;
  currency: string;
}): { subject: string; text: string; html: string } {
  const amount = `${data.amount.toFixed(2)} ${data.currency.toUpperCase()}`;
  const balance = `${data.balance.toFixed(2)} ${data.currency.toUpperCase()}`;
  return {
    subject: "Реферальное начисление — Лазейка ВПН",
    text: `💰 <b>Реферальное начисление</b>\n\nУровень: <b>${data.level}</b>\nНачислено: <b>${amount}</b>\nБаланс: <b>${balance}</b>`,
    html: `<h2>Реферальное начисление</h2><p>Уровень: <strong>${data.level}</strong></p><p>Начислено: <strong>${amount}</strong></p><p>Баланс: <strong>${balance}</strong></p>`,
  };
}
```

Within the existing transaction, retain the referrer's `email` and `telegramId`, the updated balance returned by `tx.client.update`, the reward amount and level, and `payment.currency`. Return an empty delivery list for every non-distributing path. After the transaction commits, strip that internal list from the public result and create delivery promises:

```ts
const mailConfig = mailConfigFromSystem(config);
const deliveries: Promise<unknown>[] = [];
for (const accrual of notifications) {
  const rendered = buildReferralAccrualNotification(accrual);
  if (accrual.telegramId) deliveries.push(sendTelegramToUser(accrual.telegramId, rendered.text));
  if (accrual.email && isMailConfigured(mailConfig)) {
    deliveries.push(sendEmail(mailConfig, accrual.email, rendered.subject, rendered.html).then((result) => {
      if (!result.ok) console.warn("[Referral notify] email failed", result.error);
    }));
  }
}
await Promise.allSettled(deliveries);
return result;
```

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `npm exec tsx -- --test src/modules/referral/referral-notification.test.ts`

Expected: PASS, 1 test and 0 failures.

- [x] **Step 5: Verify the backend**

Run: `npm test && npm run build`

Expected: all tests pass and TypeScript exits with code 0.

- [x] **Step 6: Commit the implementation**

```bash
git add backend/src/modules/referral/referral.service.ts backend/src/modules/referral/referral-notification.ts backend/src/modules/referral/referral-notification.test.ts docs/superpowers/plans/2026-08-13-referral-accrual-notifications.md
git commit -m "feat: notify referral reward accruals"
```
