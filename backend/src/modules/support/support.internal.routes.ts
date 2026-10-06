import { timingSafeEqual } from "node:crypto";
import rateLimit from "express-rate-limit";
import { Router, type Request } from "express";
import { prisma } from "../../db.js";

const BEARER = "Bearer ";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Проверка секрета без раскрытия данных клиента при неверном ключе. */
export function isSupportApiKeyValid(actual: string, expected: string): boolean {
  if (!actual || !expected) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function isSupportRequestIdValid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

function header(req: Request, name: string): string {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0]?.trim() ?? "" : typeof value === "string" ? value.trim() : "";
}

function subscriptionStatus(expireAt: Date | null): "ACTIVE" | "EXPIRED" | "UNKNOWN" {
  if (!expireAt) return "UNKNOWN";
  return expireAt.getTime() > Date.now() ? "ACTIVE" : "EXPIRED";
}

async function notifyClientMigrated(telegramId: string | bigint, transferredBalance?: number): Promise<void> {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    console.warn("[support] notifyClientMigrated: BOT_TOKEN is not configured");
    return;
  }
  const chatId = String(telegramId);
  const text = [
    `ℹ️ <b>Уведомление о переносе в Invoxy VPN</b>\n`,
    `Ваш аккаунт и подписка были успешно перенесены в <b>Invoxy VPN</b>.`,
    `Все ваши ключи и настройки подключения сохранены и работают в обычном режиме.\n`,
    ...(transferredBalance && transferredBalance > 0 ? [`💰 Баланс (<b>${transferredBalance.toFixed(2)} ₽</b>) успешно зачислен на ваш счёт в Invoxy.\n`] : []),
    `⚠️ Ваша подписка и профиль в боте Лазейка ВПН аннулированы.`,
    `Всё дальнейшее управление подпиской, продление и поддержка теперь осуществляются через бота @invoxy_bot или в личном кабинете https://invoxy.my\n`,
    `Вы можете заблокировать и удалить этого бота.`,
  ].join("\n");

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🚀 Открыть Invoxy VPN (@invoxy_bot)",
                url: "https://t.me/invoxy_bot",
              },
            ],
          ],
        },
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.warn(`[support] Failed to send Telegram migration notice to ${chatId}: ${res.status} ${errText}`);
    } else {
      console.log(`[support] Successfully sent Telegram migration notice to ${chatId}`);
    }
  } catch (err) {
    console.error("[support] Error sending Telegram migration notice:", err);
  }
}

const contextLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many support requests" },
});

export const supportInternalRouter = Router();

supportInternalRouter.get("/client-context", contextLimiter, async (req, res) => {
  const authorization = header(req, "authorization");
  const token = authorization.startsWith(BEARER) ? authorization.slice(BEARER.length).trim() : "";
  if (!isSupportApiKeyValid(token, process.env.SUPPORT_API_KEY?.trim() ?? "")) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const requestId = header(req, "x-support-request-id");
  if (requestId && !isSupportRequestIdValid(requestId)) {
    return res.status(400).json({ message: "Invalid request id" });
  }

  const telegramId = typeof req.query.telegramId === "string" ? req.query.telegramId.trim() : "";
  const email = typeof req.query.email === "string" ? req.query.email.trim().toLowerCase() : "";

  if (!telegramId && !email) {
    return res.status(400).json({ message: "Either telegramId or email required" });
  }
  if (telegramId && !/^\d{1,20}$/.test(telegramId)) {
    return res.status(400).json({ message: "Invalid telegramId" });
  }

  res.setHeader("Cache-Control", "no-store");

  try {
    const client = telegramId
      ? await prisma.client.findUnique({
          where: { telegramId },
          select: {
            id: true,
            email: true,
            telegramId: true,
            telegramUsername: true,
            preferredLang: true,
            balance: true,
            isBlocked: true,
            blockReason: true,
          },
        })
      : await prisma.client.findFirst({
          where: { email: { equals: email, mode: "insensitive" } },
          select: {
            id: true,
            email: true,
            telegramId: true,
            telegramUsername: true,
            preferredLang: true,
            balance: true,
            isBlocked: true,
            blockReason: true,
          },
        });

    if (!client) return res.json({ found: false, client: null, subscriptions: [] });

    const subscriptions = await prisma.subscription.findMany({
      where: {
        deletionRequestedAt: null,
        OR: [
          { ownerId: client.id, purchasedAsGift: false },
          { giftedToClientId: client.id, giftStatus: "GIFTED" },
        ],
      },
      orderBy: { subscriptionIndex: "asc" },
      take: 20,
      select: {
        id: true,
        expireAt: true,
        remnawaveUuid: true,
        extraDevices: true,
        tariff: {
          select: {
            id: true,
            name: true,
            trafficLimitBytes: true,
            localTrafficLimitBytes: true,
            includedDevices: true,
          },
        },
      },
    });

    const username = (client.telegramUsername ?? "").trim().replace(/^@+/, "");
    return res.json({
      found: true,
      client: {
        id: client.id,
        telegramId: client.telegramId ?? telegramId,
        username,
        displayName: "",
        email: client.email ?? "",
        language: client.preferredLang ?? "ru",
        balance: typeof client.balance === "number" ? client.balance : 0,
        isBlocked: client.isBlocked,
        blockReason: client.blockReason ?? "",
      },
      subscriptions: subscriptions.map((subscription) => ({
        id: subscription.id,
        tariffName: subscription.tariff?.name ?? "",
        status: subscriptionStatus(subscription.expireAt),
        expiresAt: subscription.expireAt?.toISOString() ?? "",
        remnawaveUuid: subscription.remnawaveUuid ?? "",
        deviceLimit: (subscription.tariff?.includedDevices ?? 1) + (subscription.extraDevices ?? 0),
        // BigInt нельзя отдавать через JSON напрямую; строка сохраняет точное значение.
        trafficLimitBytes: subscription.tariff?.trafficLimitBytes?.toString() ?? "",
        localTrafficLimitBytes: subscription.tariff?.localTrafficLimitBytes?.toString() ?? "",
      })),
    });
  } catch (error) {
    console.error("[support] client-context lookup failed:", error instanceof Error ? error.name : "unknown");
    return res.status(500).json({ message: "Temporary error" });
  }
});

supportInternalRouter.post("/annul-subscription", contextLimiter, async (req, res) => {
  const authorization = header(req, "authorization");
  const token = authorization.startsWith(BEARER) ? authorization.slice(BEARER.length).trim() : "";
  if (!isSupportApiKeyValid(token, process.env.SUPPORT_API_KEY?.trim() ?? "")) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const { clientId, subscriptionId, telegramId: bodyTelegramId, reason } = req.body || {};
  if (!clientId && !subscriptionId && !bodyTelegramId) {
    return res.status(400).json({ message: "clientId, subscriptionId, or telegramId required" });
  }

  try {
    let targetTelegramId = bodyTelegramId ? String(bodyTelegramId).trim() : null;

    let clientBalance = 0;
    if (clientId) {
      const client = await prisma.client.findUnique({
        where: { id: clientId },
        select: { telegramId: true, balance: true },
      });
      if (client) {
        if (typeof client.balance === "number") clientBalance = client.balance;
        if (!targetTelegramId && client.telegramId) targetTelegramId = String(client.telegramId);
      }
    }

    if (!targetTelegramId && subscriptionId) {
      const sub = await prisma.subscription.findUnique({
        where: { id: subscriptionId },
        select: { owner: { select: { telegramId: true } } },
      });
      if (sub?.owner?.telegramId) {
        targetTelegramId = String(sub.owner.telegramId);
      }
    }

    const now = new Date();
    if (subscriptionId) {
      await prisma.subscription.updateMany({
        where: { id: subscriptionId },
        data: {
          expireAt: now,
          autoRenewEnabled: false,
        },
      });
    }

    if (clientId) {
      await prisma.client.update({
        where: { id: clientId },
        data: {
          balance: 0,
          isBlocked: true,
          blockReason: reason || "Мигрирован в Invoxy VPN (@invoxy_bot / invoxy.my)",
          autoRenewEnabled: false,
        },
      });
      // Также аннулируем все активные подписки этого клиента
      await prisma.subscription.updateMany({
        where: { ownerId: clientId, expireAt: { gt: now } },
        data: {
          expireAt: now,
          autoRenewEnabled: false,
        },
      });
    }

    if (targetTelegramId && /^\d+$/.test(targetTelegramId)) {
      await notifyClientMigrated(targetTelegramId, clientBalance);
    }

    return res.json({ success: true, notifiedTelegramId: targetTelegramId ?? null });
  } catch (error) {
    console.error("[support] annul-subscription failed:", error);
    return res.status(500).json({ message: "Failed to annul subscription" });
  }
});
