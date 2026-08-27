import { PrismaClient, Prisma } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

const basePrisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = basePrisma;

/**
 * Обёртка над prisma.payment.create. После выпила multi-bot (v5.0.0) botId-подстановки нет.
 * T-tariff-restriction (портировано из WolfVPN): бэкстоп — не создаём платёж за тариф,
 * запрещённый клиенту. Покрывает ВСЕ внешние платёжки (они создают pending-платёж здесь).
 * app.ts ловит code "TARIFF_RESTRICTED" → 403.
 */
export async function createPayment(args: Prisma.PaymentCreateArgs) {
  const data = args.data as Prisma.PaymentUncheckedCreateInput;
  if (data.tariffId && typeof data.clientId === "string") {
    const [cl, tariff] = await Promise.all([
      basePrisma.client.findUnique({
        where: { id: data.clientId },
        select: { restrictedTariffIds: true, tariffRestrictionReason: true },
      }),
      basePrisma.tariff.findUnique({ where: { id: String(data.tariffId) }, select: { archivedAt: true } }),
    ]);
    if (tariff?.archivedAt) {
      const err = new Error("Тариф архивирован и недоступен для покупки") as Error & { code?: string };
      err.code = "TARIFF_ARCHIVED";
      throw err;
    }
    if (cl?.restrictedTariffIds) {
      let ids: string[] = [];
      try {
        const p = JSON.parse(cl.restrictedTariffIds);
        if (Array.isArray(p)) ids = p.map((x) => String(x));
      } catch { /* битый JSON → ограничений нет */ }
      if (ids.includes(String(data.tariffId))) {
        let reason = (cl.tariffRestrictionReason ?? "").trim();
        if (!reason) {
          const s = await basePrisma.systemSetting.findUnique({ where: { key: "tariff_restriction_message" } });
          reason = (s?.value ?? "").trim() || "Покупка этого тарифа ограничена в связи с нарушением условий оферты. Выберите другой тариф.";
        }
        const err = new Error(reason) as Error & { code?: string };
        err.code = "TARIFF_RESTRICTED";
        throw err;
      }
    }
  }
  return basePrisma.payment.create(args);
}

export const prisma = basePrisma;

// ── Тонкие обёртки для литералов Prisma: часть IDE/анализаторов отстаёт от `prisma generate`.
// Литерал сначала совместим с Record<string, unknown>, затем приводится к сгенерированному типу Prisma.
export function asClientUncheckedCreate(data: Record<string, unknown>): Prisma.ClientUncheckedCreateInput {
  return data as Prisma.ClientUncheckedCreateInput;
}

export function asClientWhere(where: Record<string, unknown>): Prisma.ClientWhereInput {
  return where as Prisma.ClientWhereInput;
}

export function asClientSelect(select: Record<string, unknown>): Prisma.ClientSelect {
  return select as Prisma.ClientSelect;
}

export function asPaymentUncheckedCreate(data: Record<string, unknown>): Prisma.PaymentUncheckedCreateInput {
  return data as Prisma.PaymentUncheckedCreateInput;
}

export function asTelegramAuthUpdate(data: Record<string, unknown>): Prisma.TelegramAuthTokenUpdateInput {
  return data as Prisma.TelegramAuthTokenUpdateInput;
}

export type TelegramAuthTokenRecord = {
  id: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
  confirmedTelegramId: string | null;
  confirmedUsername: string | null;
};

/** Строка Client после findFirst с select для слияния «пустого» клона */
export type ClientEmptyCloneRow = {
  id: string;
  email: string | null;
  passwordHash: string | null;
  googleId: string | null;
  appleId: string | null;
  remnawaveUuid: string | null;
  balance: number;
  _count: { payments: number; ownedSubscriptions: number };
};
