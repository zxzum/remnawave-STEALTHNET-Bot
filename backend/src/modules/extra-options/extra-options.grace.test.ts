import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";
// isRemnaConfigured() читает env на импорте модуля.
process.env.REMNA_API_URL ??= "http://127.0.0.1:1";
process.env.REMNA_ADMIN_TOKEN ??= "test-token";

const svc = await import("./extra-options.service.js");
const { prisma } = await import("../../db.js");

type ApplyResult = { ok: boolean; outcome?: string; phase?: string };

const PAYMENT_ID = "pay-grace-1";
const SUB_ID = "sub-grace-1";
const graceUntil = new Date(Date.now() + 5 * 86_400_000);

/** «Живая» строка платежа: lease/apply-транзакции мутируют её, ре-риды видят токен/статус. */
function buildHarness(opts: { withPlan: boolean }) {
  const currentRow: Record<string, unknown> = {
    id: PAYMENT_ID, clientId: "client-1", subscriptionId: SUB_ID, status: "PAID",
    amount: 100, extraOptionState: opts.withPlan ? "PENDING" : "NEEDS_PLAN",
    extraOptionClaimToken: null, extraOptionNextAttemptAt: null,
    metadata: JSON.stringify({
      extraOption: { kind: "devices", productId: "p1", deviceCount: 1 },
      ...(opts.withPlan
        ? { extraOptionApplication: { state: "PENDING", subscriptionId: SUB_ID, uuid: "remna-x", remote: { hwidDeviceLimit: 3 }, local: { extraDevices: 1 } } }
        : {}),
    }),
  };
  const updateManys: Array<Record<string, unknown>> = [];
  const db = prisma as unknown as Record<string, unknown>;
  const originals = {
    paymentFindUnique: (prisma.payment as unknown as Record<string, unknown>).findUnique,
    paymentUpdateMany: (prisma.payment as unknown as Record<string, unknown>).updateMany,
    subFindFirst: (prisma.subscription as unknown as Record<string, unknown>).findFirst,
    transaction: db.$transaction,
  };
  const install = () => {
    (prisma.payment as unknown as Record<string, unknown>).findUnique = async () => ({ ...currentRow });
    (prisma.payment as unknown as Record<string, unknown>).updateMany = async (args: Record<string, unknown>) => {
      updateManys.push(args);
      Object.assign(currentRow, args.data as Record<string, unknown>);
      return { count: 1 };
    };
    (prisma.subscription as unknown as Record<string, unknown>).findFirst = async () => ({
      id: SUB_ID, remnawaveUuid: "remna-x", ownerId: "client-1", giftedToClientId: null,
      deletionRequestedAt: null, graceUntil,
    });
    db.$transaction = async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => fn({
      $queryRawUnsafe: async () => [],
      payment: {
        findUnique: async () => ({ ...currentRow }),
        findFirst: async () => null,
        update: async ({ data }: { data: Record<string, unknown> }) => { Object.assign(currentRow, data); return currentRow; },
        updateMany: async (args: Record<string, unknown>) => {
          updateManys.push(args);
          Object.assign(currentRow, args.data as Record<string, unknown>);
          return { count: 1 };
        },
      },
      subscription: {
        findFirst: async () => ({
          id: SUB_ID, remnawaveUuid: "remna-x", ownerId: "client-1", giftedToClientId: null,
          customPrice: null, extraDevices: 0, extraDevicesMonthlyPrice: 0, graceUntil,
        }),
      },
    });
  };
  const restore = () => {
    (prisma.payment as unknown as Record<string, unknown>).findUnique = originals.paymentFindUnique;
    (prisma.payment as unknown as Record<string, unknown>).updateMany = originals.paymentUpdateMany;
    (prisma.subscription as unknown as Record<string, unknown>).findFirst = originals.subFindFirst;
    db.$transaction = originals.transaction;
  };
  return { install, restore, updateManys, currentRow };
}

const apply = svc.applyExtraOptionByPaymentId as unknown as (id: string) => Promise<ApplyResult>;

test("NEEDS_PLAN payment during grace stays queued: PAID kept, no refund path", async () => {
  const h = buildHarness({ withPlan: false });
  h.install();
  try {
    const result = await apply(PAYMENT_ID);
    // ok:true + QUEUED → клиентский маршрут не запускает refund (он только на ok:false/PRE_PENDING).
    assert.deepEqual(result, { ok: true, outcome: "QUEUED" });
    assert.equal((result as { phase?: string }).phase, undefined);
    const requeue = h.updateManys.find((u) => ((u.data as Record<string, unknown>).extraOptionState === "NEEDS_PLAN")) as Record<string, Record<string, unknown>> | undefined;
    assert.ok(requeue, "NEEDS_PLAN requeue executed");
    assert.equal(requeue.where.id, PAYMENT_ID);
  } finally { h.restore(); }
});

test("grace started between planning and PATCH → NEEDS_PLAN, not MANUAL_REVIEW", async () => {
  const h = buildHarness({ withPlan: true });
  h.install();
  try {
    // Платёж уже в PENDING с готовым планом; grace активен к моменту применения.
    const result = await apply(PAYMENT_ID);
    assert.deepEqual(result, { ok: true, outcome: "QUEUED" });
    const last = h.updateManys[h.updateManys.length - 1] as { data: Record<string, unknown> } | undefined;
    assert.ok(last, "requeue executed");
    assert.equal(last.data.extraOptionState, "NEEDS_PLAN", "stale APPLYING must become NEEDS_PLAN");
    assert.equal(h.currentRow.extraOptionState, "NEEDS_PLAN");
    // Никакого PATCH в Remna не было (remna недоступен по env и вызов не должен был случиться).
  } finally { h.restore(); }
});
