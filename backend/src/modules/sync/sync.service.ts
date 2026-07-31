/**
 * Синхронизация клиентов панели с Remna (из Remna и в Remna).
 */

import { prisma } from "../../db.js";
import {
  isRemnaConfigured,
  remnaGetUsers,
  remnaGetUser,
  remnaCreateUser,
  remnaGetUserByTelegramId,
  remnaGetUserByEmail,
  remnaGetUserByUsername,
  remnaUpdateUser,
  extractRemnaUuid,
  remnaUsernameFromClient,
} from "../remna/remna.client.js";
import { getSystemConfig } from "../client/client.service.js";
import { getPrimaryBot } from "../bot/bot.service.js";
import { isActiveSubscriptionGrace, runSingleSubscriptionOperation } from "../subscription/single-subscription-lifecycle.service.js";
import { remnaTrafficSettings } from "../squad-traffic/traffic-remna-policy.js";

const PAGE_SIZE = 100;

type RemnaUser = {
  uuid?: string;
  telegramId?: number | null;
  email?: string | null;
  username?: string;
};

export function isLegacyManagedComponentUsername(username: string | null | undefined): boolean {
  return typeof username === "string" && (/_c_[a-zA-Z0-9_-]+_\d+$/.test(username) || /_WL$/i.test(username));
}

function extractRemnaUsers(data: unknown): RemnaUser[] {
  if (Array.isArray(data)) return data as RemnaUser[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (obj.response && typeof obj.response === "object") {
      const resp = (obj.response as Record<string, unknown>).users;
      if (Array.isArray(resp)) return resp as RemnaUser[];
    }
    if (Array.isArray(obj.items)) return obj.items as RemnaUser[];
    if (Array.isArray(obj.data)) return obj.data as RemnaUser[];
    if (Array.isArray(obj.users)) return obj.users as RemnaUser[];
  }
  return [];
}

/** Синхронизация из Remna: загружаем пользователей Remna и создаём/обновляем клиентов в нашей БД. */
export async function syncFromRemna(): Promise<{
  ok: boolean;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}> {
  const result = { created: 0, updated: 0, skipped: 0, errors: [] as string[] };

  if (!isRemnaConfigured()) {
    result.errors.push("Remna API не настроен (REMNA_API_URL, REMNA_ADMIN_TOKEN)");
    return { ok: false, ...result };
  }

  // Берём настройки панели (язык/валюта по умолчанию),
  // чтобы новые клиенты из Remna создавались с теми же значениями.
  const config = await getSystemConfig();
  const defaultLang = config.defaultLanguage ?? "ru";
  const defaultCurrency = (config.defaultCurrency ?? "usd").toLowerCase();
  // Sync from Remna создаёт «безбот'овых» клиентов (источник истины — Remna,
  // не TG-сессия). Привязываем к primary боту для консистентности.
  const primaryBot = await getPrimaryBot();
  if (!primaryBot) {
    result.errors.push("Primary bot не настроен — синхронизация невозможна");
    return { ok: false, ...result };
  }

  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const start = (page - 1) * PAGE_SIZE;
    const res = await remnaGetUsers({ start, size: PAGE_SIZE });
    if (res.error) {
      result.errors.push(`Remna: ${res.error}`);
      break;
    }

    const users = extractRemnaUsers(res.data);
    if (users.length === 0) hasMore = false;
    else {
      for (const u of users) {
        const uuid = u.uuid;
        if (!uuid) {
          result.skipped++;
          continue;
        }
        const telegramId = u.telegramId != null ? String(u.telegramId) : null;
        const email = u.email && String(u.email).trim() ? String(u.email).trim() : null;
        const username = u.username && String(u.username).trim() ? String(u.username).trim() : null;
        if (isLegacyManagedComponentUsername(username)) {
          result.skipped++;
          continue;
        }

        try {
          const existingByUuid = await prisma.client.findFirst({
            where: { remnawaveUuid: uuid },
          });
          const existingByTg = telegramId
            ? await prisma.client.findFirst({ where: { telegramId } })
            : null;
          const existingByEmail = email
            ? await prisma.client.findFirst({ where: { email } })
            : null;

          const existing = existingByUuid || existingByTg || existingByEmail;

          if (existing) {
            const data: { remnawaveUuid: string; telegramId?: string; email?: string | null; telegramUsername?: string; trialUsed?: boolean } = {
              remnawaveUuid: uuid,
              trialUsed: true,
            };
            if (telegramId) {
              const otherWithTg = await prisma.client.findFirst({
                where: { telegramId, id: { not: existing.id } },
              });
              if (!otherWithTg) data.telegramId = telegramId;
            }
            if (email != null && email !== "") {
              const otherWithEmail = await prisma.client.findFirst({
                where: { email, id: { not: existing.id } },
              });
              if (!otherWithEmail) data.email = email;
            }
            if (username && !existing.telegramUsername) data.telegramUsername = username;
            await prisma.client.update({
              where: { id: existing.id },
              data,
            });
            result.updated++;
          } else {
            const refCode = "REF-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
            await prisma.client.create({
              data: {
                remnawaveUuid: uuid,
                email: email ?? null,
                telegramId,
                telegramUsername: username ?? null,
                referralCode: refCode,
                preferredLang: defaultLang,
                preferredCurrency: defaultCurrency,
                autoRenewEnabled: config.defaultAutoRenewEnabled ?? false,
                trialUsed: true,
              },
            });
            result.created++;
          }
        } catch (e) {
          result.errors.push(`${uuid}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (users.length < PAGE_SIZE) hasMore = false;
      else page++;
    }
  }

  return { ok: result.errors.length === 0, ...result };
}

/** Извлечь telegramId, email и activeInternalSquads из ответа Remna (getUser) — чтобы не затирать при PATCH. */
/** Синхронизация в Remna всех логических подписок и каждого их компонента. */
export async function syncToRemna(
  dependencies: { isConfigured: () => boolean; updateUser: typeof remnaUpdateUser } = {
    isConfigured: isRemnaConfigured,
    updateUser: remnaUpdateUser,
  },
  now = new Date(),
): Promise<{
  ok: boolean;
  updated: number;
  unlinked: number;
  errors: string[];
}> {
  const result = { updated: 0, unlinked: 0, errors: [] as string[] };

  if (!dependencies.isConfigured()) {
    result.errors.push("Remna API не настроен");
    return { ok: false, ...result };
  }

  const subscriptions = await prisma.subscription.findMany({
    where: { deletionRequestedAt: null },
    select: {
      id: true,
      remnawaveUuid: true,
      expireAt: true,
      graceUntil: true,
      extraDevices: true,
      owner: { select: { isBlocked: true, telegramId: true, email: true } },
      tariff: { select: { trafficLimitBytes: true, trafficLimitMode: true, trafficResetMode: true, includedDevices: true, internalSquadUuids: true } },
    },
  });
  for (const subscription of subscriptions) {
    if (isActiveSubscriptionGrace(subscription.graceUntil, now)) continue;
    if (!subscription.remnawaveUuid) {
      result.unlinked++;
      continue;
    }
    const sync = await runSingleSubscriptionOperation(subscription.id, (uuid) => dependencies.updateUser({
      uuid,
      ...(subscription.expireAt ? { expireAt: subscription.expireAt.toISOString() } : {}),
      ...(subscription.tariff ? {
        ...remnaTrafficSettings(subscription.tariff),
        hwidDeviceLimit: Math.max(1, subscription.tariff.includedDevices + subscription.extraDevices),
        activeInternalSquads: subscription.tariff.internalSquadUuids,
      } : {}),
      status: subscription.owner.isBlocked || (subscription.expireAt?.getTime() ?? Infinity) <= now.getTime() ? "DISABLED" : "ACTIVE",
      ...(subscription.owner.telegramId?.trim() ? { telegramId: Number(subscription.owner.telegramId) } : {}),
      ...(subscription.owner.email?.trim() ? { email: subscription.owner.email.trim() } : {}),
    }));
    if (!sync.requiredFailure) result.updated++;
    if (sync.failures.length) {
      result.errors.push(...sync.failures.map((failure) => `${subscription.id}: ${failure.error}`));
    }
  }

  return { ok: result.errors.length === 0, ...result };
}

/** Создать в Remna пользователей для клиентов панели, у которых ещё нет remnawaveUuid. */
export async function createRemnaUsersForClientsWithoutUuid(): Promise<{
  ok: boolean;
  created: number;
  linked: number;
  errors: string[];
}> {
  const result = { created: 0, linked: 0, errors: [] as string[] };

  if (!isRemnaConfigured()) {
    result.errors.push("Remna API не настроен");
    return { ok: false, ...result };
  }

  const clients = await prisma.client.findMany({
    where: { remnawaveUuid: null },
    select: { id: true, email: true, telegramId: true, telegramUsername: true },
  });

  for (const c of clients) {
    try {
      let uuid: string | null = null;
      if (c.telegramId?.trim()) {
        const res = await remnaGetUserByTelegramId(c.telegramId.trim());
        uuid = extractRemnaUuid(res.data);
      }
      if (!uuid && c.email?.trim()) {
        const res = await remnaGetUserByEmail(c.email.trim());
        uuid = extractRemnaUuid(res.data);
      }
      const displayUsername = remnaUsernameFromClient({
        telegramUsername: c.telegramUsername,
        telegramId: c.telegramId,
        email: c.email,
        clientIdFallback: c.id,
      });
      if (!uuid) {
        const byUsernameRes = await remnaGetUserByUsername(displayUsername);
        uuid = extractRemnaUuid(byUsernameRes.data);
      }
      if (!uuid) {
        const createRes = await remnaCreateUser({
          username: displayUsername,
          trafficLimitBytes: 0,
          trafficLimitStrategy: "NO_RESET",
          expireAt: new Date(Date.now() - 1000).toISOString(),
          ...(c.telegramId && { telegramId: parseInt(c.telegramId, 10) }),
          ...(c.email && { email: c.email }),
        });
        uuid = extractRemnaUuid(createRes.data);
        if (uuid) result.created++;
      } else {
        result.linked++;
      }
      if (uuid) {
        // НЕ ставим trialUsed=true при синхронизации!
        // Синк только линкует Remna-юзера — это не значит что клиент брал триал.
        // Раньше тут стоял trialUsed: true → все синканные/мигрированные получали флаг,
        // и авто-рассылка «Пользовался триалом, но не оплатил» спамила тех кто триал не брал.
        await prisma.client.update({
          where: { id: c.id },
          data: { remnawaveUuid: uuid },
        });
      } else {
        result.errors.push(`Client ${c.id}: не удалось получить или создать UUID в Remna`);
      }
    } catch (e) {
      result.errors.push(`Client ${c.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { ok: result.errors.length === 0, ...result };
}
