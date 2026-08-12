import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { deleteSingleSubscription } from "../modules/subscription/single-subscription-lifecycle.service.js";
import {
  adminGrantPaymentWhere,
  paidSubscriptionWhere,
  paidVpnPaymentWhere,
} from "../modules/trial/trial-purchase-lock.service.js";

type ClientRow = { id: string; trialUsed: boolean };
type TrialRow = { id: string; ownerId: string };

export type TrialPurchaseCleanupOptions = {
  apply: boolean;
  batchSize: number;
};

export type TrialPurchaseCleanupResult = {
  mode: "dry-run" | "apply";
  paidClients: number;
  flagsToSet: number;
  trialCandidates: number;
  deleted: number;
  failed: number;
};

export type TrialPurchaseCleanupDependencies = {
  findPaidClients: (afterId: string | null, batchSize: number) => Promise<ClientRow[]>;
  markClient: (clientId: string) => Promise<{ count: number }>;
  findTrialSubscriptions: (afterId: string | null, batchSize: number) => Promise<TrialRow[]>;
  deleteTrial: (subscriptionId: string) => Promise<{ deleted: boolean }>;
};

const paidClientWhere = {
  OR: [
    { payments: { some: { OR: [paidVpnPaymentWhere, adminGrantPaymentWhere] } } },
    { ownedSubscriptions: { some: paidSubscriptionWhere } },
  ],
} satisfies Prisma.ClientWhereInput;

function afterId<T extends Record<string, unknown>>(where: T, id: string | null): T | { AND: [T, { id: { gt: string } }] } {
  return id ? { AND: [where, { id: { gt: id } }] } : where;
}

const realDependencies: TrialPurchaseCleanupDependencies = {
  findPaidClients: (after, batchSize) => prisma.client.findMany({
    where: afterId(paidClientWhere, after),
    orderBy: { id: "asc" },
    take: batchSize,
    select: { id: true, trialUsed: true },
  }),
  markClient: (clientId) => prisma.client.updateMany({
    where: { id: clientId, trialUsed: false },
    data: { trialUsed: true },
  }),
  findTrialSubscriptions: (after, batchSize) => prisma.subscription.findMany({
    where: afterId({
      trialId: { not: null },
      purchasedAsGift: false,
      giftStatus: null,
      giftedToClientId: null,
      deletionRequestedAt: null,
      owner: {
        OR: [
          { payments: { some: { OR: [paidVpnPaymentWhere, adminGrantPaymentWhere] } } },
          { ownedSubscriptions: { some: paidSubscriptionWhere } },
        ],
      },
    } satisfies Prisma.SubscriptionWhereInput, after),
    orderBy: { id: "asc" },
    take: batchSize,
    select: { id: true, ownerId: true },
  }),
  deleteTrial: async (subscriptionId) => deleteSingleSubscription(subscriptionId),
};

export async function runTrialPurchaseCleanup(
  options: TrialPurchaseCleanupOptions,
  dependencies: TrialPurchaseCleanupDependencies = realDependencies,
): Promise<TrialPurchaseCleanupResult> {
  const batchSize = Math.max(1, Math.min(500, Math.trunc(options.batchSize)));
  const result: TrialPurchaseCleanupResult = {
    mode: options.apply ? "apply" : "dry-run",
    paidClients: 0,
    flagsToSet: 0,
    trialCandidates: 0,
    deleted: 0,
    failed: 0,
  };

  let after: string | null = null;
  for (;;) {
    const rows = await dependencies.findPaidClients(after, batchSize);
    if (rows.length === 0) break;
    result.paidClients += rows.length;
    result.flagsToSet += rows.filter((row) => !row.trialUsed).length;
    if (options.apply) {
      for (const row of rows) await dependencies.markClient(row.id);
    }
    after = rows[rows.length - 1].id;
  }

  after = null;
  for (;;) {
    const rows = await dependencies.findTrialSubscriptions(after, batchSize);
    if (rows.length === 0) break;
    result.trialCandidates += rows.length;
    if (options.apply) {
      for (const row of rows) {
        try {
          await dependencies.markClient(row.ownerId);
          const deletion = await dependencies.deleteTrial(row.id);
          if (deletion.deleted) result.deleted++;
          else result.failed++;
        } catch (error) {
          result.failed++;
          console.error("[trial-lock-cleanup] candidate failed", row.id, error);
        }
      }
    }
    after = rows[rows.length - 1].id;
  }

  return result;
}

function cliOptions(argv: string[]): TrialPurchaseCleanupOptions {
  const batchArg = argv.find((arg) => arg.startsWith("--batch-size="));
  const parsedBatch = batchArg ? Number(batchArg.slice("--batch-size=".length)) : 100;
  return { apply: argv.includes("--apply"), batchSize: Number.isFinite(parsedBatch) ? parsedBatch : 100 };
}

if (process.argv[1]?.endsWith("cleanup-trial-purchase-lock.ts") || process.argv[1]?.endsWith("cleanup-trial-purchase-lock.js")) {
  runTrialPurchaseCleanup(cliOptions(process.argv.slice(2)))
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      if (result.mode === "dry-run") console.log("Dry-run: no database writes or Remnawave requests were made. Use --apply to execute cleanup.");
    })
    .catch((error) => {
      console.error("[trial-lock-cleanup] failed", error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
