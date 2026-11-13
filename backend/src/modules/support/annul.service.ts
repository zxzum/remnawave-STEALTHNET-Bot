import type { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";

export const DEFAULT_ANNUL_REASON = "Мигрирован в Invoxy VPN (@invoxy_bot / invoxy.my)";

export type AnnulResult =
  | { status: "not_found" }
  | { status: "already_blocked"; telegramId: string | null }
  | { status: "annulled"; telegramId: string | null; zeroedBalance: number; detachedRemnawaveUuids: string[]; cancelledPayments: number };

type AnnulDb = Pick<typeof prisma, "client" | "$transaction">;

/**
 * Аннулирование клиента при миграции в Invoxy. Панельный пользователь теперь принадлежит Invoxy,
 * поэтому ссылки на него (remnawaveUuid) обнуляются: ни cron, ни sync, ни оплата не должны его трогать.
 * Повторный вызов на уже заблокированном клиенте — no-op.
 */
export async function annulClientForMigration(
  clientId: string,
  reason: string | undefined,
  db: AnnulDb = prisma,
): Promise<AnnulResult> {
  const exists = await db.client.findUnique({ where: { id: clientId }, select: { id: true } });
  if (!exists) return { status: "not_found" };

  return db.$transaction(async (tx: Prisma.TransactionClient): Promise<AnnulResult> => {
    const client = await tx.client.findUnique({ where: { id: clientId }, select: { telegramId: true, balance: true } });
    const telegramId = client?.telegramId ? String(client.telegramId) : null;
    const blocked = await tx.client.updateMany({
      where: { id: clientId, isBlocked: false },
      data: { balance: 0, isBlocked: true, blockReason: reason || DEFAULT_ANNUL_REASON, autoRenewEnabled: false, remnawaveUuid: null },
    });
    if (blocked.count === 0) return { status: "already_blocked", telegramId };

    const now = new Date();
    // Чужие получатели подарков не затрагиваются: берём свои подписки (без подарка другому) и подаренные этому клиенту.
    const where = { OR: [{ ownerId: clientId, giftedToClientId: null }, { giftedToClientId: clientId }] };
    const subs = await tx.subscription.findMany({ where, select: { id: true, remnawaveUuid: true } });
    await tx.subscription.updateMany({ where: { ...where, expireAt: { gt: now } }, data: { expireAt: now } });
    await tx.subscription.updateMany({
      where,
      data: { autoRenewEnabled: false, remnawaveUuid: null, remnawaveUsername: null, remnawaveShortUuid: null },
    });
    const cancelled = await tx.payment.updateMany({ where: { clientId, status: "PENDING" }, data: { status: "FAILED" } });

    const detachedRemnawaveUuids = subs.map((s) => s.remnawaveUuid).filter((u): u is string => Boolean(u));
    console.log("[support] annul: panel link detached", { clientId, detachedRemnawaveUuids });
    return {
      status: "annulled",
      telegramId,
      zeroedBalance: typeof client?.balance === "number" ? client.balance : 0,
      detachedRemnawaveUuids,
      cancelledPayments: cancelled.count,
    };
  });
}
