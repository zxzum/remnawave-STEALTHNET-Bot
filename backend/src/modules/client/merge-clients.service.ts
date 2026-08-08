/**
 * Слияние двух клиентских аккаунтов в один (схема «инициатор — основной»).
 *
 * Используется при привязке Telegram/email, когда обнаруживается второй аккаунт
 * того же человека:
 *   - привязка TG: у Telegram-аккаунта нет email/пароля/OAuth → его данные
 *     (подписки, баланс, платежи, рефералы) переезжают в аккаунт-инициатор,
 *     сам он удаляется, telegramId переходит инициатору;
 *   - привязка email: владелец почты подтвердил письмо и у него нет Telegram →
 *     аналогично сливается в инициатора, email переходит инициатору.
 *
 * ВСЁ выполняется одной транзакцией: перенос FK-строк → чистка pending-заявок →
 * удаление поглощаемого клиента (освобождает unique telegramId/email) →
 * обновление полей основного. В обычном режиме подписки переносятся без изменения
 * UUID; при выбранной консолидации итоговый срок синхронизируется с Remnawave.
 */

import { prisma } from "../../db.js";
import { computeConvertedDays } from "../tariff/tariff-activation.service.js";
import { deleteSingleSubscription } from "../subscription/single-subscription-lifecycle.service.js";
import { isRemnaConfigured, remnaUpdateUser } from "../remna/remna.client.js";
import {
  buildMergePreview,
  type MergeAccountSnapshot,
  type MergeChoice,
  type MergePreview,
  type MergeSubscriptionSnapshot,
} from "./account-merge-policy.js";

export interface MergeAssignFields {
  /** Присвоить основному telegramId (обычно — телеграм поглощаемого). */
  telegramId?: string;
  telegramUsername?: string | null;
  /** Присвоить основному email (обычно — почта поглощаемого). */
  email?: string;
}

export interface MergeClientsResult {
  movedSubscriptions: number;
  movedPayments: number;
  balanceAdded: number;
}

type MergeSubscriptionRow = {
  id: string;
  ownerId: string;
  remnawaveUuid: string | null;
  tariffId: string | null;
  trialId: string | null;
  expireAt: Date | null;
  currentPricePerDay: number | null;
  giftStatus: string | null;
  purchasedAsGift: boolean;
  tariff: { id: string; name: string; price: number; durationDays: number; currency: string } | null;
  trial: { name: string } | null;
};

async function loadMergeAccounts(primaryId: string, absorbedId: string): Promise<{
  primary: MergeAccountSnapshot;
  absorbed: MergeAccountSnapshot;
  subscriptions: MergeSubscriptionRow[];
}> {
  const rows = await prisma.client.findMany({
    where: { id: { in: [primaryId, absorbedId] } },
    select: {
      id: true,
      email: true,
      balance: true,
      _count: { select: { payments: true } },
      ownedSubscriptions: {
        orderBy: { subscriptionIndex: "asc" },
        select: {
          id: true,
          ownerId: true,
          remnawaveUuid: true,
          tariffId: true,
          trialId: true,
          expireAt: true,
          currentPricePerDay: true,
          giftStatus: true,
          purchasedAsGift: true,
          tariff: { select: { id: true, name: true, price: true, durationDays: true, currency: true } },
          trial: { select: { name: true } },
        },
      },
    },
  });
  const primaryRow = rows.find((row) => row.id === primaryId);
  const absorbedRow = rows.find((row) => row.id === absorbedId);
  if (!primaryRow || !absorbedRow) throw new Error("Аккаунт для объединения не найден");

  const toSnapshot = (row: typeof primaryRow, owner: "primary" | "absorbed"): MergeAccountSnapshot => ({
    id: row.id,
    email: row.email,
    balance: row.balance,
    paymentsCount: row._count.payments,
    subscriptions: row.ownedSubscriptions.map((subscription): MergeSubscriptionSnapshot => ({
      id: subscription.id,
      owner,
      tariffId: subscription.tariffId,
      tariffName: subscription.tariff?.name ?? null,
      trialId: subscription.trialId,
      trialName: subscription.trial?.name ?? null,
      expireAt: subscription.expireAt,
      tariffPrice: subscription.tariff?.price ?? null,
      tariffDurationDays: subscription.tariff?.durationDays ?? null,
      tariffCurrency: subscription.tariff?.currency ?? null,
      currentPricePerDay: subscription.currentPricePerDay,
      giftStatus: subscription.giftStatus,
      purchasedAsGift: subscription.purchasedAsGift,
    })),
  });

  return {
    primary: toSnapshot(primaryRow, "primary"),
    absorbed: toSnapshot(absorbedRow, "absorbed"),
    subscriptions: [...primaryRow.ownedSubscriptions, ...absorbedRow.ownedSubscriptions] as MergeSubscriptionRow[],
  };
}

export async function getMergePreview(primaryId: string, absorbedId: string): Promise<MergePreview> {
  if (primaryId === absorbedId) throw new Error("Нельзя объединить аккаунт сам с собой");
  const accounts = await loadMergeAccounts(primaryId, absorbedId);
  return buildMergePreview(accounts.primary, accounts.absorbed);
}

function subscriptionRemainingMs(subscription: MergeSubscriptionRow, now: Date): number {
  return subscription.expireAt ? Math.max(0, subscription.expireAt.getTime() - now.getTime()) : 0;
}

function subscriptionPricePerDay(subscription: MergeSubscriptionRow): number | null {
  if (subscription.currentPricePerDay != null && subscription.currentPricePerDay > 0) return subscription.currentPricePerDay;
  if (subscription.tariff && subscription.tariff.durationDays > 0) return subscription.tariff.price / subscription.tariff.durationDays;
  return null;
}

/**
 * Применяет выбранную политику к Remnawave и БД до переноса владельца.
 * Внешний API не поддерживает транзакции: при сбое операция останавливается,
 * а pending-код остаётся действительным для повторной попытки.
 */
async function prepareSubscriptionsForMerge(primaryId: string, absorbedId: string, choice: MergeChoice): Promise<void> {
  const accounts = await loadMergeAccounts(primaryId, absorbedId);
  const all = accounts.subscriptions.filter((subscription) => !subscription.giftStatus && !subscription.purchasedAsGift);
  const now = new Date();
  const toDelete = new Set<string>();
  const updates = new Map<string, { subscription: MergeSubscriptionRow; expireAt: Date }>();

  const trialItems = all.filter((subscription) => subscription.trialId);
  if (trialItems.length > 1) {
    const winner = [...trialItems].sort((a, b) => subscriptionRemainingMs(b, now) - subscriptionRemainingMs(a, now))[0];
    for (const subscription of trialItems) if (subscription.id !== winner.id) toDelete.add(subscription.id);
  }

  const paid = all.filter((subscription) => !subscription.trialId && subscription.tariffId);
  if (choice === "smart" || choice === "keep_both") {
    const byTariff = new Map<string, MergeSubscriptionRow[]>();
    for (const subscription of paid) {
      const group = byTariff.get(subscription.tariffId!) ?? [];
      group.push(subscription);
      byTariff.set(subscription.tariffId!, group);
    }
    for (const items of byTariff.values()) {
      if (items.length < 2) continue;
      const winner = [...items].sort((a, b) => subscriptionRemainingMs(b, now) - subscriptionRemainingMs(a, now))[0];
      const totalMs = items.reduce((sum, subscription) => sum + subscriptionRemainingMs(subscription, now), 0);
      updates.set(winner.id, { subscription: winner, expireAt: new Date(now.getTime() + totalMs) });
      for (const subscription of items) if (subscription.id !== winner.id) toDelete.add(subscription.id);
    }
  } else if (choice === "to_primary" || choice === "to_absorbed") {
    const ownerId = choice === "to_primary" ? primaryId : absorbedId;
    const candidates = paid.filter((subscription) => subscription.ownerId === ownerId);
    const target = [...candidates].sort((a, b) => subscriptionRemainingMs(b, now) - subscriptionRemainingMs(a, now))[0];
    if (target) {
      let convertedDays = 0;
      const targetPrice = subscriptionPricePerDay(target);
      for (const source of paid) {
        if (source.id === target.id) continue;
        const sourcePrice = subscriptionPricePerDay(source);
        const sameCurrency = (source.tariff?.currency ?? "").toLowerCase() === (target.tariff?.currency ?? "").toLowerCase();
        if (sourcePrice == null || targetPrice == null || !sameCurrency) continue;
        convertedDays += computeConvertedDays({
          remainingDays: Math.floor(subscriptionRemainingMs(source, now) / 86_400_000),
          oldPricePerDay: sourcePrice,
          newPricePerDay: targetPrice,
        });
        toDelete.add(source.id);
      }
      if (convertedDays > 0) {
        updates.set(target.id, {
          subscription: target,
          expireAt: new Date(now.getTime() + subscriptionRemainingMs(target, now) + convertedDays * 86_400_000),
        });
      }
    }
  }

  for (const { subscription, expireAt } of updates.values()) {
    if (subscription.remnawaveUuid && isRemnaConfigured()) {
      const result = await remnaUpdateUser({ uuid: subscription.remnawaveUuid, expireAt: expireAt.toISOString() });
      if (result.error) throw new Error(`Не удалось объединить подписку: ${result.error}`);
    }
    await prisma.subscription.update({ where: { id: subscription.id }, data: { expireAt } });
  }
  for (const subscriptionId of toDelete) {
    const result = await deleteSingleSubscription(subscriptionId);
    if (!result.deleted) throw new Error(result.failures[0]?.error || "Не удалось удалить дубликат подписки");
  }
}

export async function mergeClients(
  primaryId: string,
  absorbedId: string,
  assign: MergeAssignFields = {},
  options: { subscriptionMerge?: MergeChoice } = {},
): Promise<MergeClientsResult> {
  if (primaryId === absorbedId) throw new Error("Нельзя объединить аккаунт сам с собой");

  if (options.subscriptionMerge) {
    await prepareSubscriptionsForMerge(primaryId, absorbedId, options.subscriptionMerge);
  }

  return await prisma.$transaction(
    async (tx) => {
      const [primary, absorbed] = await Promise.all([
        tx.client.findUnique({ where: { id: primaryId } }),
        tx.client.findUnique({ where: { id: absorbedId } }),
      ]);
      if (!primary) throw new Error("Основной аккаунт не найден");
      if (!absorbed) throw new Error("Объединяемый аккаунт не найден");

      // ── Подписки: unique(ownerId, subscriptionIndex) → переносим по одной с реиндексацией ──
      const primaryMax = await tx.subscription.aggregate({
        where: { ownerId: primaryId },
        _max: { subscriptionIndex: true },
      });
      let nextIdx = (primaryMax._max.subscriptionIndex ?? -1) + 1;
      const absorbedSubs = await tx.subscription.findMany({
        where: { ownerId: absorbedId },
        orderBy: { subscriptionIndex: "asc" },
        select: { id: true },
      });
      for (const sub of absorbedSubs) {
        await tx.subscription.update({
          where: { id: sub.id },
          data: { ownerId: primaryId, subscriptionIndex: nextIdx++ },
        });
      }
      await tx.subscription.updateMany({
        where: { giftedToClientId: absorbedId },
        data: { giftedToClientId: primaryId },
      });

      // ── Прямые переносы clientId → primary (без unique-конфликтов) ──
      const movedPayments = (
        await tx.payment.updateMany({ where: { clientId: absorbedId }, data: { clientId: primaryId } })
      ).count;
      await tx.ticket.updateMany({ where: { clientId: absorbedId }, data: { clientId: primaryId } });
      await tx.withdrawalRequest.updateMany({ where: { clientId: absorbedId }, data: { clientId: primaryId } });
      await tx.referralCredit.updateMany({ where: { referrerId: absorbedId }, data: { referrerId: primaryId } });
      await tx.promoCodeUsage.updateMany({ where: { clientId: absorbedId }, data: { clientId: primaryId } });
      await tx.autoBroadcastLog.updateMany({ where: { clientId: absorbedId }, data: { clientId: primaryId } });
      await tx.proxySlot.updateMany({ where: { clientId: absorbedId }, data: { clientId: primaryId } });
      await tx.singboxSlot.updateMany({ where: { clientId: absorbedId }, data: { clientId: primaryId } });
      await tx.contestWinner.updateMany({ where: { clientId: absorbedId }, data: { clientId: primaryId } });
      await tx.giftHistory.updateMany({ where: { clientId: absorbedId }, data: { clientId: primaryId } });
      await tx.giftCode.updateMany({ where: { creatorId: absorbedId }, data: { creatorId: primaryId } });
      await tx.giftCode.updateMany({ where: { redeemedById: absorbedId }, data: { redeemedById: primaryId } });

      // ── Переносы с дедупликацией по unique-констрейнтам ──
      // PromoActivation: unique(promoGroupId, clientId)
      const primaryPromos = await tx.promoActivation.findMany({
        where: { clientId: primaryId },
        select: { promoGroupId: true },
      });
      const havePromo = new Set(primaryPromos.map((p) => p.promoGroupId));
      const absorbedPromos = await tx.promoActivation.findMany({ where: { clientId: absorbedId } });
      for (const pa of absorbedPromos) {
        if (havePromo.has(pa.promoGroupId)) {
          await tx.promoActivation.delete({ where: { id: pa.id } });
        } else {
          await tx.promoActivation.update({ where: { id: pa.id }, data: { clientId: primaryId } });
        }
      }
      // ClientTrialUsage: unique(clientId, trialId)
      const primaryTrials = await tx.clientTrialUsage.findMany({
        where: { clientId: primaryId },
        select: { trialId: true },
      });
      const haveTrial = new Set(primaryTrials.map((t) => t.trialId));
      const absorbedTrials = await tx.clientTrialUsage.findMany({ where: { clientId: absorbedId } });
      for (const tu of absorbedTrials) {
        if (haveTrial.has(tu.trialId)) {
          await tx.clientTrialUsage.delete({ where: { id: tu.id } });
        } else {
          await tx.clientTrialUsage.update({ where: { id: tu.id }, data: { clientId: primaryId } });
        }
      }

      // ── Рефералы-дети поглощаемого → приглашены основным ──
      await tx.client.updateMany({
        where: { referrerId: absorbedId },
        data: { referrerId: primaryId },
      });

      // ── Реферер-родитель основного ──
      let newReferrerId = primary.referrerId;
      if (primary.referrerId === absorbedId) {
        // Поглощаемый пригласил основного — наследуем его цепочку (не сам на себя).
        newReferrerId = absorbed.referrerId && absorbed.referrerId !== primaryId ? absorbed.referrerId : null;
      } else if (!primary.referrerId && absorbed.referrerId && absorbed.referrerId !== primaryId) {
        newReferrerId = absorbed.referrerId;
      }

      // ── Pending-заявки поглощаемого (FK-каскада на них нет — чистим руками) ──
      await tx.pendingTelegramLink.deleteMany({ where: { clientId: absorbedId } });
      await tx.pendingEmailLink.deleteMany({ where: { clientId: absorbedId } });

      // ── Удаляем поглощаемого (освобождает unique telegramId/email), затем обновляем основного ──
      await tx.client.delete({ where: { id: absorbedId } });

      await tx.client.update({
        where: { id: primaryId },
        data: {
          balance: primary.balance + absorbed.balance,
          trialUsed: primary.trialUsed || absorbed.trialUsed,
          referrerId: newReferrerId,
          // Способы входа поглощаемого переносим только в ПУСТЫЕ поля основного,
          // чтобы после слияния человек мог логиниться всеми прежними способами
          // (напр. основной пришёл из бота без пароля, поглощаемый — email+пароль).
          ...(primary.passwordHash || !absorbed.passwordHash ? {} : { passwordHash: absorbed.passwordHash }),
          ...(primary.googleId || !absorbed.googleId ? {} : { googleId: absorbed.googleId }),
          ...(primary.appleId || !absorbed.appleId ? {} : { appleId: absorbed.appleId }),
          // legacy-указатели переносим только в пустые поля основного
          ...(primary.remnawaveUuid || !absorbed.remnawaveUuid ? {} : { remnawaveUuid: absorbed.remnawaveUuid }),
          ...(primary.currentTariffId || !absorbed.currentTariffId ? {} : { currentTariffId: absorbed.currentTariffId }),
          ...(assign.telegramId !== undefined
            ? {
                telegramId: assign.telegramId,
                telegramUnreachable:
                  absorbed.telegramId === assign.telegramId ? absorbed.telegramUnreachable : false,
              }
            : {}),
          ...(assign.telegramUsername !== undefined ? { telegramUsername: assign.telegramUsername } : {}),
          ...(assign.email !== undefined ? { email: assign.email } : {}),
        },
      });

      return {
        movedSubscriptions: absorbedSubs.length,
        movedPayments,
        balanceAdded: absorbed.balance,
      };
    },
    { timeout: 30000, maxWait: 10000 },
  );
}

/**
 * Можно ли слить Telegram-аккаунт в инициатора при привязке TG:
 * у него не должно быть собственных web-идентичностей (email/пароль/OAuth).
 * Баланс/платежи/подписки слиянию НЕ мешают — они переносятся.
 */
export function isBotOnlyAccount(c: {
  email: string | null;
  passwordHash: string | null;
  googleId: string | null;
  appleId: string | null;
}): boolean {
  return !c.email && !c.passwordHash && !c.googleId && !c.appleId;
}
