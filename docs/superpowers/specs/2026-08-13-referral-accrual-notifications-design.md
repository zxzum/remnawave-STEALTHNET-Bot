# Referral Accrual Notifications Design

## Goal

Notify every referrer when Лазейка ВПН credits a referral reward, using both Telegram and email when the corresponding contact and transport are available.

## Scope

- Notify only after a real referral credit is committed.
- Include the referral level (1, 2, or 3), credited amount, and resulting balance.
- Do not identify the referred client.
- Do not notify when a client merely joins through a referral link.
- Reuse the existing Telegram bot and SMTP/Resend transports.
- Do not add dependencies, queues, settings, or database tables.

## Architecture and Data Flow

`distributeReferralRewards` remains the single integration point because every payment path already calls it. The database transaction will keep its current idempotent claim and reward writes, while retaining the successful credit details needed for delivery. After the transaction commits, a small referral notification function sends Telegram and email messages for each created credit.

Delivery is best-effort and occurs outside the transaction. A failed Telegram or email request is logged and does not roll back the balance or referral credit. A repeated payment handler call cannot send a duplicate notification because the existing `referralDistributedAt` claim prevents a second credit result.

## Message Content

Telegram and email use the same facts:

- referral level;
- credited amount;
- balance after the credit.

The email has a simple Лазейка ВПН subject and HTML body. Telegram uses the existing HTML message sender. Money values use two decimal places and the payment currency.

## Testing

One focused test will exercise the message builder for all required facts and verify that no referred-client identity is accepted or rendered. Existing backend tests and the TypeScript build must remain green.
