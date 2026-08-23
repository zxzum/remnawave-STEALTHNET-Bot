import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";
// isRemnaConfigured() читает env на импорте модуля.
process.env.REMNA_API_URL ??= "http://127.0.0.1:1";
process.env.REMNA_ADMIN_TOKEN ??= "test-token";

const svc = await import("./extra-options.service.js");
const { prisma } = await import("../../db.js");

const PAYMENT_ID = "pay-grace-1";
const SUB_ID = "sub-grace-1";
const graceUntil = new Date(Date.now() + 5 * 86_400_000);

type ApplyResult = { ok: boolean; outcome?: string; phase?: string };

test("extra-option during grace: PAID stays queued in NEEDS_PLAN, no refund path", async () => {
  const db = prisma as unknown as Record<string, unknown>;
  const originals = {
    paymentFindUnique: (prisma.payment as unknown as Record<string, unknown>).findUnique,
    paymentUpdateMany: (prisma.payment as unknown as Record<string, unknown>).updateMany,
    subFindFirst: (prisma.subscription as unknown as Record<string, unknown>).findFirst,
    transaction: db.$transaction,
  };
  const updateManys: Array<Record<string, unknown>> = [];
  const paymentRow = {
    id: PAYMENT_ID,
    clientId: "client-1",
    subscriptionId: SUB_ID,
    status: "PAID",
    amount: 100,
    // NEEDS_PLAN: очередь переигрывает платёж; план ещё не строился.
    extraOptionState: "NEEDS_PLAN",
    extraOptionClaimToken: null,
    extraOptionNextAttemptAt: null,
    metadata: JSON.stringify({ extraOption: { kind: "devices", productId: "p1", deviceCount: 1 } }),
  };
  const freshRow = { ...paymentRow, extraOptionState: "PLANNING", extraOptionClaimToken: "tok" };
  try {
    (prisma.payment as unknown as Record<string, unknown>).findUnique = async () => ({ ...paymentRow });
    (prisma.payment as unknown as Record<string, unknown>).updateMany = async (args: Record<string, unknown>) => {
      updateManys.push(args);
      return { count: 1 };
    };
    (prisma.subscription as unknown as Record<string, unknown>).findFirst = async () => ({ id: SUB_ID });
    db.$transaction = async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => fn({
      $queryRawUnsafe: async () => [],
      payment: { findUnique: async () => ({ ...freshRow }), findFirst: async () => null, update: async () => ({}) },
      subscription: {
        findFirst: async () => ({
          id: SUB_ID, remnawaveUuid: "remna-x", ownerId: "client-1", giftedToClientId: null,
          customPrice: null, extraDevices: 0, extraDevicesMonthlyPrice: 0,
          // Подписка в активном Lazeika-Only grace.
          graceUntil,
        }),
      },
    });
    const apply = svc.applyExtraOptionByPaymentId as unknown as (id: string) => Promise<ApplyResult>;
    const result = await apply(PAYMENT_ID);

    // Ключевое: НЕ ok:false/PRE_PENDING — иначе клиентский маршрут запускает refund.
    assert.deepEqual(result, { ok: true, outcome: "QUEUED" });
    assert.equal((result as { phase?: string }).phase, undefined);
    // Платёж оставлен в NEEDS_PLAN с ретраем.
    const graceUpdate = updateManys.find((u) => ((u.data as Record<string, unknown>).extraOptionState === "NEEDS_PLAN")) as Record<string, Record<string, unknown>> | undefined;
    assert.ok(graceUpdate, "NEEDS_PLAN update executed");
    assert.equal(graceUpdate.where.id, PAYMENT_ID);
    assert.ok((graceUpdate.data as Record<string, unknown>).extraOptionNextAttemptAt instanceof Date);
  } finally {
    (prisma.payment as unknown as Record<string, unknown>).findUnique = originals.paymentFindUnique;
    (prisma.payment as unknown as Record<string, unknown>).updateMany = originals.paymentUpdateMany;
    (prisma.subscription as unknown as Record<string, unknown>).findFirst = originals.subFindFirst;
    db.$transaction = originals.transaction;
  }
});
