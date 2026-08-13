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
