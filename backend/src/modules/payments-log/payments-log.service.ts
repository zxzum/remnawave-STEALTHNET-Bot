/**
 * Payments log — журнал всех платежей для админки.
 *
 * Объединяет локальные Payment (все провайдеры/статусы) с provider-side
 * транзакциями (ProviderTransaction), подтянутыми sync'ом из API провайдеров
 * и НЕ заматченными на локальный платёж (kind="external").
 *
 * Синхронизация с провайдерами — через ProviderSyncAdapter (см. providers/).
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";

export type PaymentSource = "site" | "miniapp" | "bot";

export type PaymentsLogFilters = {
  page: number;
  limit: number;
  search?: string;
  provider?: string;
  status?: string;
  source?: PaymentSource;
  method?: string;
  from?: Date;
  to?: Date;
};

export type PaymentsLogItem = {
  id: string;
  kind: "payment" | "external";
  provider: string;
  method: string | null;
  methodId: number | null;
  amount: number;
  currency: string;
  status: string;
  source: PaymentSource | null;
  createdAt: string;
  paidAt: string | null;
  orderId: string | null;
  externalId: string | null;
  client: {
    id: string;
    telegramId: string | null;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
  } | null;
  product: string;
  callback: {
    status: "success" | "failed" | "none";
    at: string | null;
    responseStatus: number | null;
  };
  description: string | null;
};

// Platega method ids (см. platega.service.ts): 2=СБП, 11=Карты РФ, 12=Международные, 13=Крипто.
const PLATEGA_METHOD_LABELS: Record<number, string> = {
  2: "СБП (QR-код)",
  11: "Карточный эквайринг",
  12: "Международные карты",
  13: "Крипто",
};

// Строковые коды методов из export API провайдеров → (label, plategaMethodId).
const EXTERNAL_METHOD_MAP: Record<string, { label: string; methodId: number | null }> = {
  SBPQR: { label: "СБП (QR-код)", methodId: 2 },
  SBP: { label: "СБП (QR-код)", methodId: 2 },
  CARD: { label: "Карточный эквайринг", methodId: 11 },
  CARD_RU: { label: "Карточный эквайринг", methodId: 11 },
  CARD_INT: { label: "Международные карты", methodId: 12 },
  INTERNATIONAL: { label: "Международные карты", methodId: 12 },
  CRYPTO: { label: "Крипто", methodId: 13 },
};

/** Нормализация статусов провайдеров к PAID | PENDING | CANCELED | FAILED | REFUNDED. */
export function normalizeProviderStatus(raw: string | null | undefined): string {
  const s = (raw ?? "").trim().toUpperCase();
  if (!s) return "PENDING";
  if (s === "CONFIRMED" || s === "SUCCESS" || s === "PAID" || s === "COMPLETED") return "PAID";
  if (s === "PENDING" || s === "CREATED" || s === "IN_PROGRESS" || s === "NEW") return "PENDING";
  if (s === "CANCELED" || s === "CANCELLED" || s === "EXPIRED") return "CANCELED";
  if (s === "REFUNDED" || s === "REFUND") return "REFUNDED";
  if (s === "FAILED" || s === "DECLINED" || s === "ERROR" || s === "REJECTED") return "FAILED";
  return s;
}

function parseMetadata(metadata: string | null): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function methodForPayment(provider: string | null, metadata: string | null): { method: string | null; methodId: number | null } {
  if (provider !== "platega") return { method: null, methodId: null };
  const raw = parseMetadata(metadata).plategaMethodId;
  const id = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(id)) return { method: null, methodId: null };
  return { method: PLATEGA_METHOD_LABELS[id] ?? `Метод #${id}`, methodId: id };
}

function methodForExternal(paymentMethod: string | null): { method: string | null; methodId: number | null } {
  const key = (paymentMethod ?? "").trim().toUpperCase();
  if (!key) return { method: null, methodId: null };
  const mapped = EXTERNAL_METHOD_MAP[key];
  if (mapped) return { method: mapped.label, methodId: mapped.methodId };
  return { method: key, methodId: null };
}

type PaymentRow = Prisma.PaymentGetPayload<{
  include: {
    client: { select: { id: true; telegramId: true; telegramUsername: true } };
    tariff: { select: { name: true } };
    proxyTariff: { select: { name: true } };
    singboxTariff: { select: { name: true } };
  };
}>;

function productForPayment(p: PaymentRow): string {
  if (p.tariff?.name) return p.tariff.name;
  if (p.proxyTariff?.name) return `Прокси: ${p.proxyTariff.name}`;
  if (p.singboxTariff?.name) return `Sing-box: ${p.singboxTariff.name}`;
  return "Пополнение баланса";
}

function buildPaymentWhere(f: PaymentsLogFilters): Prisma.PaymentWhereInput {
  const where: Prisma.PaymentWhereInput = {};
  if (f.provider) where.provider = f.provider;
  if (f.status) where.status = f.status.toUpperCase();
  if (f.source) where.source = f.source;
  if (f.from || f.to) {
    where.createdAt = {
      ...(f.from ? { gte: f.from } : {}),
      ...(f.to ? { lte: f.to } : {}),
    };
  }
  // Фильтр по методу поддерживаем только для platega (metadata.plategaMethodId),
  // для остальных провайдеров метод не хранится.
  if (f.method && /^\d+$/.test(f.method)) {
    where.metadata = { contains: `"plategaMethodId":${Number(f.method)}` };
  }
  if (f.search) {
    const q = f.search;
    where.OR = [
      { orderId: { contains: q, mode: "insensitive" } },
      { externalId: { contains: q, mode: "insensitive" } },
      { client: { telegramUsername: { contains: q, mode: "insensitive" } } },
      { client: { email: { contains: q, mode: "insensitive" } } },
      { client: { telegramId: { contains: q } } },
    ];
  }
  return where;
}

function buildExternalWhere(f: PaymentsLogFilters): Prisma.ProviderTransactionWhereInput {
  const where: Prisma.ProviderTransactionWhereInput = {
    // Заматченные транзакции уже представлены локальным Payment — не дублируем.
    paymentId: null,
  };
  if (f.provider) where.provider = f.provider;
  if (f.status) {
    const s = f.status.toUpperCase();
    // Статус у провайдера сырой: матчим и сырой, и нормализованный (CONFIRMED→PAID и т.п.).
    const rawMatches = Object.keys(RAW_STATUS_TO_NORMALIZED)
      .filter((raw) => RAW_STATUS_TO_NORMALIZED[raw] === s);
    where.OR = [
      { status: { equals: s, mode: "insensitive" } },
      ...rawMatches.map((raw) => ({ status: { equals: raw, mode: "insensitive" as const } })),
    ];
  }
  if (f.source) {
    // У внешних транзакций источника нет — фильтр по source скрывает их.
    where.id = "__none__";
  }
  if (f.method) {
    if (/^\d+$/.test(f.method)) {
      const labels = Object.entries(EXTERNAL_METHOD_MAP)
        .filter(([, v]) => v.methodId === Number(f.method))
        .map(([k]) => k);
      where.paymentMethod = labels.length > 0 ? { in: labels } : "__none__";
    } else {
      where.paymentMethod = { contains: f.method, mode: "insensitive" };
    }
  }
  if (f.from || f.to) {
    const range = {
      ...(f.from ? { gte: f.from } : {}),
      ...(f.to ? { lte: f.to } : {}),
    };
    where.AND = [
      {
        OR: [
          { providerCreatedAt: range },
          { providerCreatedAt: null, createdAt: range },
        ],
      },
    ];
  }
  if (f.search) {
    const q = f.search;
    where.AND = [
      ...((where.AND as Prisma.ProviderTransactionWhereInput[] | undefined) ?? []),
      {
        OR: [
          { externalId: { contains: q, mode: "insensitive" } },
          { payload: { contains: q, mode: "insensitive" } },
        ],
      },
    ];
  }
  return where;
}

const RAW_STATUS_TO_NORMALIZED: Record<string, string> = {
  CONFIRMED: "PAID",
  SUCCESS: "PAID",
  COMPLETED: "PAID",
  CREATED: "PENDING",
  IN_PROGRESS: "PENDING",
  NEW: "PENDING",
  CANCELLED: "CANCELED",
  EXPIRED: "CANCELED",
  REFUND: "REFUNDED",
  DECLINED: "FAILED",
  ERROR: "FAILED",
  REJECTED: "FAILED",
};

/** Callback-статус по последнему webhook-событию платежа (батч, без N+1). */
async function loadCallbackMap(paymentIds: string[]): Promise<Map<string, { status: "success" | "failed"; at: Date; responseStatus: number }>> {
  const map = new Map<string, { status: "success" | "failed"; at: Date; responseStatus: number }>();
  if (paymentIds.length === 0) return map;
  const events = await prisma.webhookEvent.findMany({
    where: { paymentId: { in: paymentIds } },
    orderBy: { createdAt: "desc" },
    select: { paymentId: true, outcome: true, responseStatus: true, createdAt: true },
  });
  for (const ev of events) {
    if (!ev.paymentId || map.has(ev.paymentId)) continue; // первый = самый свежий
    const ok = ev.responseStatus >= 200 && ev.responseStatus < 300;
    map.set(ev.paymentId, { status: ok ? "success" : "failed", at: ev.createdAt, responseStatus: ev.responseStatus });
  }
  return map;
}

function paymentToItem(p: PaymentRow, callback: PaymentsLogItem["callback"]): PaymentsLogItem {
  const { method, methodId } = methodForPayment(p.provider, p.metadata);
  const source = p.source === "site" || p.source === "miniapp" || p.source === "bot" ? p.source : null;
  return {
    id: p.id,
    kind: "payment",
    provider: p.provider ?? "unknown",
    method,
    methodId,
    amount: p.amount,
    currency: p.currency,
    status: p.status,
    source,
    createdAt: p.createdAt.toISOString(),
    paidAt: p.paidAt?.toISOString() ?? null,
    orderId: p.orderId,
    externalId: p.externalId,
    client: p.client
      ? {
          id: p.client.id,
          telegramId: p.client.telegramId,
          username: p.client.telegramUsername,
          // firstName/lastName в модели Client не хранятся — отдаём null (стабильный контракт).
          firstName: null,
          lastName: null,
        }
      : null,
    product: productForPayment(p),
    callback,
    description: null,
  };
}

function externalToItem(t: Prisma.ProviderTransactionGetPayload<object>): PaymentsLogItem {
  const { method, methodId } = methodForExternal(t.paymentMethod);
  return {
    id: t.id,
    kind: "external",
    provider: t.provider,
    method,
    methodId,
    amount: t.amount,
    currency: t.currency,
    status: normalizeProviderStatus(t.status),
    source: null,
    createdAt: (t.providerCreatedAt ?? t.createdAt).toISOString(),
    paidAt: null,
    orderId: t.payload,
    externalId: t.externalId,
    client: null,
    product: "Пополнение баланса",
    callback: { status: "none", at: null, responseStatus: null },
    description: t.description,
  };
}

const NO_CALLBACK: PaymentsLogItem["callback"] = { status: "none", at: null, responseStatus: null };

export async function listPaymentsLog(filters: PaymentsLogFilters) {
  const { page, limit } = filters;
  const paymentWhere = buildPaymentWhere(filters);
  const externalWhere = buildExternalWhere(filters);

  // Overfetch: page*limit из каждого источника, затем merge + slice в памяти.
  const overfetch = page * limit;

  const [paymentsTotal, externalTotal, payments, externals] = await Promise.all([
    prisma.payment.count({ where: paymentWhere }),
    prisma.providerTransaction.count({ where: externalWhere }),
    prisma.payment.findMany({
      where: paymentWhere,
      orderBy: { createdAt: "desc" },
      take: overfetch,
      include: {
        client: { select: { id: true, telegramId: true, telegramUsername: true } },
        tariff: { select: { name: true } },
        proxyTariff: { select: { name: true } },
        singboxTariff: { select: { name: true } },
      },
    }),
    prisma.providerTransaction.findMany({
      where: externalWhere,
      orderBy: [{ providerCreatedAt: "desc" }, { createdAt: "desc" }],
      take: overfetch,
    }),
  ]);

  const callbackMap = await loadCallbackMap(payments.map((p) => p.id));

  const merged: PaymentsLogItem[] = [
    ...payments.map((p) => {
      const cb = callbackMap.get(p.id);
      return paymentToItem(p, cb ? { status: cb.status, at: cb.at.toISOString(), responseStatus: cb.responseStatus } : NO_CALLBACK);
    }),
    ...externals.map(externalToItem),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

  const items = merged.slice((page - 1) * limit, page * limit);
  const total = paymentsTotal + externalTotal;

  // Агрегаты по всей фильтрованной выборке (groupBy на уровне БД).
  const [payByCurrency, payByStatus, extByCurrency, extByStatus] = await Promise.all([
    prisma.payment.groupBy({ by: ["currency"], where: paymentWhere, _count: true, _sum: { amount: true } }),
    prisma.payment.groupBy({ by: ["status"], where: paymentWhere, _count: true }),
    prisma.providerTransaction.groupBy({ by: ["currency"], where: externalWhere, _count: true, _sum: { amount: true } }),
    prisma.providerTransaction.groupBy({ by: ["status"], where: externalWhere, _count: true }),
  ]);

  const currencyMap = new Map<string, { currency: string; count: number; amount: number }>();
  for (const row of payByCurrency) {
    currencyMap.set(row.currency, { currency: row.currency, count: row._count, amount: row._sum.amount ?? 0 });
  }
  for (const row of extByCurrency) {
    const cur = currencyMap.get(row.currency) ?? { currency: row.currency, count: 0, amount: 0 };
    cur.count += row._count;
    cur.amount += row._sum.amount ?? 0;
    currencyMap.set(row.currency, cur);
  }

  const statusMap = new Map<string, number>();
  for (const row of payByStatus) statusMap.set(row.status, (statusMap.get(row.status) ?? 0) + row._count);
  for (const row of extByStatus) {
    const s = normalizeProviderStatus(row.status);
    statusMap.set(s, (statusMap.get(s) ?? 0) + row._count);
  }

  return {
    items,
    total,
    page,
    limit,
    aggregates: {
      byCurrency: [...currencyMap.values()].sort((a, b) => b.amount - a.amount),
      byStatus: [...statusMap.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    },
  };
}

export async function getPaymentsLogEntry(id: string, kind: "payment" | "external") {
  if (kind === "external") {
    const t = await prisma.providerTransaction.findUnique({ where: { id } });
    if (!t) return null;
    const matched = t.paymentId
      ? await prisma.payment.findUnique({
          where: { id: t.paymentId },
          include: { client: { select: { id: true, telegramId: true, telegramUsername: true } } },
        })
      : null;
    return {
      ...externalToItem(t),
      raw: parseMetadata(t.raw),
      matchedPayment: matched
        ? { id: matched.id, orderId: matched.orderId, status: matched.status, client: matched.client }
        : null,
      webhookEvents: [],
    };
  }

  const p = await prisma.payment.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, telegramId: true, telegramUsername: true } },
      tariff: { select: { name: true } },
      proxyTariff: { select: { name: true } },
      singboxTariff: { select: { name: true } },
    },
  });
  if (!p) return null;
  const callbackMap = await loadCallbackMap([p.id]);
  const cb = callbackMap.get(p.id);
  const webhookEvents = await prisma.webhookEvent.findMany({
    where: { paymentId: p.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, provider: true, outcome: true, responseStatus: true, createdAt: true },
  });
  return {
    ...paymentToItem(p, cb ? { status: cb.status, at: cb.at.toISOString(), responseStatus: cb.responseStatus } : NO_CALLBACK),
    metadata: parseMetadata(p.metadata),
    webhookEvents: webhookEvents.map((ev) => ({ ...ev, createdAt: ev.createdAt.toISOString() })),
  };
}
