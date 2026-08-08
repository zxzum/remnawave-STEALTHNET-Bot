import assert from "node:assert/strict";
import test from "node:test";

import {
  completeEmailRegistration,
  isClientEmailUniqueViolation,
  type EmailRegistrationPending,
} from "./email-registration-completion.js";

const now = new Date("2026-08-09T12:00:00.000Z");

function makePending(): EmailRegistrationPending {
  return {
    id: "pending-1",
    email: "user@example.com",
    verificationToken: "token-1",
    emailVerifiedAt: new Date("2026-08-09T11:00:00.000Z"),
    revokedAt: null,
    deliveryState: "SENT",
    expiresAt: new Date("2026-08-10T12:00:00.000Z"),
    preferredLang: "ru",
    preferredCurrency: "usd",
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmContent: null,
    utmTerm: null,
    registrationIp: "127.0.0.1",
  };
}

function makeStore() {
  let pending: EmailRegistrationPending | null = makePending();
  let activeLock = Promise.resolve();
  let deleteCount = 0;
  const clients: Array<{ id: string; email: string }> = [];
  const created: Array<{ pendingId: string; passwordHash: string }> = [];

  const store = {
    withEmailLock: async <T>(_email: string, work: () => Promise<T>) => {
      const previous = activeLock;
      let release!: () => void;
      activeLock = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        return await work();
      } finally {
        release();
      }
    },
    findPending: async (id: string) => pending?.id === id ? pending : null,
    findClientByEmail: async (email: string) => clients.find((client) => client.email === email) ?? null,
    createClient: async (row: EmailRegistrationPending, passwordHash: string) => {
      if (clients.some((client) => client.email === row.email)) throw { code: "P2002" };
      const client = { id: `client-${clients.length + 1}`, email: row.email };
      clients.push(client);
      created.push({ pendingId: row.id, passwordHash });
      return client;
    },
    deletePending: async (id: string) => {
      assert.equal(pending?.id, id);
      deleteCount += 1;
      pending = null;
    },
  };

  return { store, get pending() { return pending; }, clients, created, get deleteCount() { return deleteCount; } };
}

test("two concurrent completions create one client and delete one pending row", async () => {
  const state = makeStore();
  const input = { pendingId: "pending-1", email: "user@example.com", verificationToken: "token-1", passwordHash: "hash", now };

  const results = await Promise.all([
    completeEmailRegistration(state.store, input),
    completeEmailRegistration(state.store, input),
  ]);

  assert.equal(results.filter((result) => result.kind === "created").length, 1);
  assert.equal(state.clients.length, 1);
  assert.deepEqual(state.created, [{ pendingId: "pending-1", passwordHash: "hash" }]);
  assert.equal(state.deleteCount, 1);
  assert.equal(state.pending, null);
});

test("completion rechecks the email inside the lock before creating a client", async () => {
  const state = makeStore();
  state.clients.push({ id: "existing-1", email: "user@example.com" });

  const result = await completeEmailRegistration(state.store, {
    pendingId: "pending-1",
    email: "user@example.com",
    verificationToken: "token-1",
    passwordHash: "hash",
    now,
  });

  assert.deepEqual(result, { kind: "existing" });
  assert.equal(state.deleteCount, 0);
  assert.equal(state.created.length, 0);
});

test("classifies Prisma email unique races for the existing 400 response", () => {
  assert.equal(isClientEmailUniqueViolation({ code: "P2002", meta: { target: ["email"] } }), true);
  assert.equal(isClientEmailUniqueViolation({ code: "P2002", meta: { target: ["Client_email_key"] } }), true);
  assert.equal(isClientEmailUniqueViolation({ code: "P2025" }), false);
});
