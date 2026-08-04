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

const contextLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many support context requests" },
});

export const supportInternalRouter = Router();

supportInternalRouter.get("/client-context", contextLimiter, async (req, res) => {
  const authorization = header(req, "authorization");
  const token = authorization.startsWith(BEARER) ? authorization.slice(BEARER.length).trim() : "";
  if (!isSupportApiKeyValid(token, process.env.SUPPORT_API_KEY?.trim() ?? "")) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const requestId = header(req, "x-support-request-id");
  if (!isSupportRequestIdValid(requestId)) {
    return res.status(400).json({ message: "Invalid request id" });
  }

  const telegramId = typeof req.query.telegramId === "string" ? req.query.telegramId.trim() : "";
  if (!/^\d{1,20}$/.test(telegramId)) {
    return res.status(400).json({ message: "Invalid telegramId" });
  }

  res.setHeader("Cache-Control", "no-store");

  try {
    const client = await prisma.client.findUnique({
      where: { telegramId },
      select: {
        id: true,
        email: true,
        telegramId: true,
        telegramUsername: true,
        preferredLang: true,
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
        expireAt: true,
        tariff: { select: { name: true, trafficLimitBytes: true } },
      },
    });

    const username = (client.telegramUsername ?? "").trim().replace(/^@+/, "");
    return res.json({
      found: true,
      client: {
        id: client.id,
        telegramId: client.telegramId ?? telegramId,
        username,
        // Полное имя приходит из доверенного Telegram update SupportBot; backend его не хранит.
        displayName: "",
        email: client.email ?? "",
        language: client.preferredLang ?? "ru",
      },
      subscriptions: subscriptions.map((subscription) => ({
        tariffName: subscription.tariff?.name ?? "",
        status: subscriptionStatus(subscription.expireAt),
        expiresAt: subscription.expireAt?.toISOString() ?? "",
        // BigInt нельзя отдавать через JSON напрямую; строка сохраняет точное значение.
        trafficLimitBytes: subscription.tariff?.trafficLimitBytes?.toString() ?? "",
      })),
    });
  } catch (error) {
    console.error("[support] client-context lookup failed:", error instanceof Error ? error.name : "unknown");
    return res.status(500).json({ message: "Temporary error" });
  }
});
