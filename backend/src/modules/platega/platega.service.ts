/**
 * Platega.io — создание платежей и обработка callback
 * https://docs.platega.io/
 */

import { proxyFetch } from "../proxy-util/proxy-fetch.js";
import { getProxyUrl } from "../proxy-util/get-proxy-url.js";
import { timingSafeEqual } from "node:crypto";

const PLATEGA_API_BASE = "https://app.platega.io";

export type PlategaConfig = {
  merchantId: string;
  secret: string;
};

export type PlategaTransaction = {
  id: string;
  status: string;
  amount?: number;
  currency?: string;
  payload?: string;
  raw: Record<string, unknown>;
};

function safeEqual(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const a = Buffer.from(actual.trim());
  const b = Buffer.from(expected.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Platega подписывает callback обычными X-MerchantId/X-Secret, не HMAC. */
export function verifyPlategaCallbackCredentials(
  headers: Record<string, string | string[] | undefined>,
  config: PlategaConfig,
): boolean {
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const get = (name: string) => first(Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1]);
  return safeEqual(get("x-merchantid"), config.merchantId)
    && safeEqual(get("x-secret"), config.secret);
}

export function validatePlategaTransaction(
  transaction: PlategaTransaction,
  payment: { externalId: string | null; orderId: string; amount: number; currency: string },
  acceptGrossAmount = false,
): string | null {
  if (!payment.externalId || transaction.id !== payment.externalId) return "transaction id mismatch";
  const commissionRaw = transaction.raw.comission ?? transaction.raw.commission;
  const commission = typeof commissionRaw === "number" ? commissionRaw : typeof commissionRaw === "string" ? Number(commissionRaw) : 0;
  const amount = transaction.amount;
  const amountMatches = amount != null && (
    Math.round(amount * 100) === Math.round(payment.amount * 100)
    || (Number.isFinite(commission) && Math.round((amount - commission) * 100) === Math.round(payment.amount * 100))
    || (acceptGrossAmount && amount >= payment.amount)
  );
  if (!amountMatches) return "amount mismatch";
  if (!transaction.currency || transaction.currency.trim().toUpperCase() !== payment.currency.trim().toUpperCase()) return "currency mismatch";
  if (transaction.payload && transaction.payload !== payment.orderId) return "payload mismatch";
  return null;
}

export function isPlategaConfigured(config: PlategaConfig | null): boolean {
  return Boolean(config?.merchantId?.trim() && config?.secret?.trim());
}

/**
 * Создать транзакцию в Platega, получить ссылку на оплату
 * paymentMethod: 2=СБП, 10=CardRu, 12=Международный, 13=Криптовалюта
 */
export async function createPlategaTransaction(
  config: PlategaConfig,
  params: {
    amount: number;
    currency: string;
    orderId: string;
    paymentMethod: number;
    returnUrl: string;
    failedUrl: string;
    description?: string;
  }
): Promise<{ paymentUrl: string; transactionId: string } | { error: string }> {
  const { amount, currency, orderId, paymentMethod, returnUrl, failedUrl, description } = params;
  const url = `${PLATEGA_API_BASE}/transaction/process`;
  const body: Record<string, unknown> = {
    paymentMethod: Number(paymentMethod) || 2,
    paymentDetails: { amount: Number(amount), currency: currency.toUpperCase() },
    description: description || `Оплата заказа ${orderId}`,
    return: returnUrl,
    failedUrl,
    payload: orderId, // orderId передаём через payload — единственное кастомное поле в API Platega
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-MerchantId": config.merchantId.trim(),
    "X-Secret": config.secret.trim(),
  };

  try {
    const proxy = await getProxyUrl("payments");
    const res = await proxyFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }, proxy);

    const text = await res.text();
    let data: Record<string, unknown>;
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      return { error: `Platega: invalid response (${res.status})` };
    }

    if (res.status === 401) {
      return { error: "Platega: неверный Merchant ID или секрет" };
    }
    if (res.status !== 200) {
      const msg = (data.message as string) || (data.error as string) || text?.slice(0, 200);
      return { error: `Platega: ${msg}` };
    }

    const paymentUrl = (data.redirect as string) || (data.url as string) || (data.paymentUrl as string);
    const transactionId = (data.transactionId as string) || (data.id as string);

    if (!paymentUrl) {
      return { error: "Platega не вернул ссылку на оплату" };
    }

    return { paymentUrl, transactionId: transactionId || "" };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: `Platega: ${message}` };
  }
}

/**
 * Проверка статуса транзакции через Platega API.
 * Используется как двойная защита webhook'а: даже если атакер прислал поддельный
 * webhook с правильным transactionId — Platega API вернёт реальный статус, и
 * мы пометим платёж только если API подтверждает.
 *
 * Официальный endpoint: `GET /transaction/{id}`.
 */
export async function getPlategaTransactionStatus(
  config: PlategaConfig,
  transactionId: string,
): Promise<
  | ({ ok: true } & PlategaTransaction)
  | { error: string; status?: number }
> {
  if (!transactionId.trim()) return { error: "transactionId required" };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-MerchantId": config.merchantId.trim(),
    "X-Secret": config.secret.trim(),
  };
  const proxy = await getProxyUrl("payments");

  try {
    const res = await proxyFetch(`${PLATEGA_API_BASE}/transaction/${encodeURIComponent(transactionId)}`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(15_000),
    }, proxy);
    const text = await res.text();
    if (res.status === 401 || res.status === 403) {
      return { error: "Platega: неверные креды merchantId/secret", status: res.status };
    }
    if (!res.ok) return { error: `Platega status → ${res.status} ${text.slice(0, 200)}`, status: res.status };

    let data: Record<string, unknown>;
    try {
      data = text ? JSON.parse(text) as Record<string, unknown> : {};
    } catch {
      return { error: "Platega: невалидный JSON в ответе" };
    }
    const details = data.paymentDetails && typeof data.paymentDetails === "object"
      ? data.paymentDetails as Record<string, unknown>
      : {};
    const id = String(data.id ?? "").trim();
    const status = String(data.status ?? "").trim();
    const amountRaw = details.amount;
    const amount = typeof amountRaw === "number" ? amountRaw : typeof amountRaw === "string" ? Number(amountRaw) : undefined;
    const currency = typeof details.currency === "string" ? details.currency : undefined;
    const payload = typeof data.payload === "string" ? data.payload : undefined;
    if (!id || !status) return { error: "Platega: API ответил без id/status" };
    return { ok: true, id, status, amount, currency, payload, raw: data };
  } catch (e) {
    return { error: `Platega API status check failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}
