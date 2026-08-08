import assert from "node:assert/strict";
import test from "node:test";

import {
  EMAIL_DELIVERY_STATE_SENT,
  EMAIL_DELIVERY_STATE_SENDING,
  finalizeEmailRegistrationDelivery,
  getEmailDeliveryTransition,
} from "./email-registration-delivery.js";

const now = new Date("2026-08-09T12:00:00.000Z");

test("failed delivery keeps the pending row and older link valid", () => {
  assert.deepEqual(getEmailDeliveryTransition(false), {
    deliveryState: EMAIL_DELIVERY_STATE_SENDING,
    revokeOlder: false,
  });
});

test("successful delivery marks the row sent and revokes older links", () => {
  assert.deepEqual(getEmailDeliveryTransition(true), {
    deliveryState: EMAIL_DELIVERY_STATE_SENT,
    revokeOlder: true,
  });
});

test("failed delivery preserves the previous valid link at the DB boundary", async () => {
  let pendingState: { deliveryState: string; revokedAt: Date | null } = { deliveryState: EMAIL_DELIVERY_STATE_SENDING, revokedAt: null };
  let oldRevokedAt: Date | null = null;
  const calls: string[] = [];
  const store = {
    withEmailLock: async <T>(_email: string, work: () => Promise<T>) => work(),
    findPendingState: async () => pendingState,
    markSent: async () => { calls.push("markSent"); },
    revokeOlder: async () => { calls.push("revokeOlder"); oldRevokedAt = now; },
  };

  const result = await finalizeEmailRegistrationDelivery(store, {
    pendingId: "pending-1",
    email: "user@example.com",
    createdAt: new Date("2026-08-09T11:59:00.000Z"),
    delivered: false,
    now,
  });

  assert.equal(result, "preserved");
  assert.deepEqual(calls, []);
  assert.equal(pendingState.deliveryState, EMAIL_DELIVERY_STATE_SENDING);
  assert.equal(oldRevokedAt, null);
});

test("successful delivery finalization is safe to replay", async () => {
  let pendingState: { deliveryState: string; revokedAt: Date | null } = { deliveryState: EMAIL_DELIVERY_STATE_SENDING, revokedAt: null };
  let oldRevokedAt: Date | null = null;
  const calls: string[] = [];
  const store = {
    withEmailLock: async <T>(_email: string, work: () => Promise<T>) => work(),
    findPendingState: async () => pendingState,
    markSent: async () => {
      calls.push("markSent");
      pendingState = { ...pendingState, deliveryState: EMAIL_DELIVERY_STATE_SENT };
    },
    revokeOlder: async () => { calls.push("revokeOlder"); oldRevokedAt = now; },
  };
  const input = {
    pendingId: "pending-1",
    email: "user@example.com",
    createdAt: new Date("2026-08-09T11:59:00.000Z"),
    delivered: true,
    now,
  };

  assert.equal(await finalizeEmailRegistrationDelivery(store, input), "finalized");
  assert.equal(await finalizeEmailRegistrationDelivery(store, input), "finalized");
  assert.equal(pendingState.deliveryState, EMAIL_DELIVERY_STATE_SENT);
  assert.deepEqual(calls, ["markSent", "revokeOlder", "revokeOlder"]);
  assert.equal(oldRevokedAt, now);
});
