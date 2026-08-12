import { prisma } from "../../db.js";
import { deleteSingleSubscription } from "../subscription/single-subscription-lifecycle.service.js";
import type { Prisma } from "@prisma/client";

export type PaidVpnPayment = {
  status: string;
  tariffId?: string | null;
  metadata?: string | null;
  provider?: string | null;
};

export type TrialSubscriptionCandidate = {
  id: string;
  trialId: string | null;
  purchasedAsGift: boolean;
  deletionRequestedAt: Date | null;
};

export function isPaidVpnPurchase(payment: PaidVpnPayment & Record<string, unknown>): boolean {
  return payment.status === "PAID" && isVpnSubscriptionPurchase(payment);
}

export function isAdminGrantPayment(payment: Pick<PaidVpnPayment, "status" | "metadata" | "provider">): boolean {
  if (payment.status !== "PAID") return false;
  if (payment.provider === "admin_grant") return true;
  if (!payment.metadata?.trim()) return false;
  try {
    const metadata = JSON.parse(payment.metadata) as Record<string, unknown>;
    return metadata.kind === "admin_grant";
  } catch {
    return false;
  }
}

export function isVpnSubscriptionPurchase(payment: Pick<PaidVpnPayment, "tariffId" | "metadata" | "provider">): boolean {
  if (payment.provider === "admin_grant") return false;
  if (!payment.metadata?.trim()) return payment.tariffId != null;
  try {
    const metadata = JSON.parse(payment.metadata) as Record<string, unknown>;
    if (metadata.kind === "admin_grant") return false;
    if (payment.tariffId != null) return true;
    return metadata.customBuild != null;
  } catch {
    return payment.tariffId != null;
  }
}

export function isTrialBlocked(trialUsed: boolean, hasPaidSubscription: boolean): boolean {
  return trialUsed || hasPaidSubscription;
}

export function selectSeparateTrialIds(
  rows: TrialSubscriptionCandidate[],
  excludedTrialId: string | null = null,
): string[] {
  return rows
    .filter((row) => row.trialId != null && !row.purchasedAsGift && row.deletionRequestedAt == null && row.id !== excludedTrialId)
    .map((row) => row.id);
}

export const paidVpnPaymentWhere = {
  status: "PAID",
  AND: [
    {
      OR: [
        { tariffId: { not: null } },
        { metadata: { contains: '\"customBuild\"' } },
      ],
    },
    {
      OR: [
        { provider: null },
        { provider: { not: "admin_grant" } },
      ],
    },
  ],
} satisfies Prisma.PaymentWhereInput;

export const adminGrantPaymentWhere = {
  status: "PAID",
  OR: [
    { provider: "admin_grant" },
    { metadata: { contains: '\"kind\":\"admin_grant\"' } },
  ],
} satisfies Prisma.PaymentWhereInput;

const trialLockPaymentWhere = {
  OR: [paidVpnPaymentWhere, adminGrantPaymentWhere],
} satisfies Prisma.PaymentWhereInput;

const paidSubscriptionWhere = {
  trialId: null,
  tariffId: { not: null },
  purchasedAsGift: false,
  giftStatus: null,
  giftedToClientId: null,
} as const;

export async function hasPaidSubscription(clientId: string): Promise<boolean> {
  const subscription = await prisma.subscription.findFirst({
    where: { ownerId: clientId, ...paidSubscriptionWhere },
    select: { id: true },
  });
  return subscription != null;
}

export async function isClientTrialBlocked(clientId: string, trialUsed: boolean): Promise<boolean> {
  if (trialUsed) return true;
  const [client, paidSubscription, paidPurchase, adminGrant] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { trialUsed: true } }),
    hasPaidSubscription(clientId),
    hasPaidVpnPurchase(clientId),
    hasTrialLockingPayment(clientId),
  ]);
  return isTrialBlocked(Boolean(client?.trialUsed), paidSubscription || paidPurchase || adminGrant);
}

export async function hasPaidVpnPurchase(clientId: string): Promise<boolean> {
  const payment = await prisma.payment.findFirst({
    where: { clientId, ...paidVpnPaymentWhere },
    select: { id: true },
  });
  return payment != null;
}

async function hasTrialLockingPayment(clientId: string): Promise<boolean> {
  const payment = await prisma.payment.findFirst({
    where: { clientId, OR: [paidVpnPaymentWhere, adminGrantPaymentWhere] },
    select: { id: true },
  });
  return payment != null;
}

export async function markTrialUsedForPaidPurchase(clientId: string): Promise<void> {
  await prisma.client.updateMany({
    where: { id: clientId, trialUsed: false },
    data: { trialUsed: true },
  });
}

/** Любая выданная подписка также закрывает trial и убирает отдельные trial-подписки. */
export async function lockTrialAfterSubscription(clientId: string): Promise<void> {
  try {
    await markTrialUsedForPaidPurchase(clientId);
  } catch (error) {
    console.error("[trial-lock] failed to mark admin-granted client", clientId, error);
  }
  try {
    const cleanup = await deleteSeparateTrialSubscriptions(clientId);
    if (cleanup.failed > 0) {
      console.error("[trial-lock] admin subscription cleanup is incomplete", clientId, cleanup);
    }
  } catch (error) {
    console.error("[trial-lock] admin subscription cleanup failed", clientId, error);
  }
}

export async function restoreTrialAfterLegacyFailure(clientId: string): Promise<void> {
  await prisma.client.updateMany({
    where: {
      id: clientId,
      trialUsed: true,
      payments: {
        none: {
          ...trialLockPaymentWhere,
        },
      },
      ownedSubscriptions: { none: paidSubscriptionWhere },
    },
    data: { trialUsed: false },
  });
}

export async function deleteSeparateTrialSubscriptions(
  clientId: string,
  excludedTrialId: string | null = null,
): Promise<{ selected: number; deleted: number; failed: number }> {
  let rows: TrialSubscriptionCandidate[];
  try {
    rows = await prisma.subscription.findMany({
      where: {
        ownerId: clientId,
        trialId: { not: null },
        purchasedAsGift: false,
        giftStatus: null,
        giftedToClientId: null,
        deletionRequestedAt: null,
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, trialId: true, purchasedAsGift: true, deletionRequestedAt: true },
    });
  } catch (error) {
    console.error("[trial-lock] trial lookup failed", clientId, error);
    return { selected: 0, deleted: 0, failed: 1 };
  }
  const ids = selectSeparateTrialIds(rows, excludedTrialId);
  let deleted = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      const result = await deleteSingleSubscription(id);
      if (result.deleted) deleted++;
      else failed++;
    } catch (error) {
      failed++;
      console.error("[trial-lock] trial deletion failed", id, error);
    }
  }
  return { selected: ids.length, deleted, failed };
}

export { paidSubscriptionWhere };
