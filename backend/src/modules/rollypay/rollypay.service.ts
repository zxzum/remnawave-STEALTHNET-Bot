/**
 * RollyPay — рублёвые платежи и подтверждение статуса.
 *
 * RollyPay API:
 *   POST /api/v1/payments
 *   GET  /api/v1/payments/{paymentID}
 *
 * API requests use X-API-Key and a fresh X-Nonce. Webhook signatures cover
 * the exact raw body together with X-Timestamp.
 */

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getProxyUrl } from "../proxy-util/get-proxy-url.js";
import { proxyFetch } from "../proxy-util/proxy-fetch.js";

const API_BASE = "https://rollypay.io";
const REQUEST_TIMEOUT_MS = 15_000;
const WEBHOOK_MAX_AGE_SEC = 15 * 60;

export type RollypayConfig = {
  apiKey: string;
  signingSecret: string;
  testMode?: boolean;
};

export function isRollypayConfigured(config: RollypayConfig | null): boolean {
  return Boolean(config?.apiKey?.trim() && config?.signingSecret?.trim());
}

export type CreateRollypayPaymentParams = {
  config: RollypayConfig;
  amount: string;
  currency: string;
  orderId: string;
  description?: string;
  customerId?: string;
  successRedirectUrl?: string;
  failRedirectUrl?: string;
  metadata?: Record<string, unknown>;
};

export type RollypayPayment = {
  payment_id?: string;
  order_id?: string;
  status?: string;
  pay_url?: string;
  amount?: string | number;
  payment_currency?: string;
  message?: string;
  error?: string;
};

export type RollypayWebhookPayload = {
  event_type?: string;
  payment_id?: string;
  order_id?: string;
  status?: string;
  amount?: string | number;
  currency?: string;
  test?: boolean;
};

export type CreateRollypayPaymentResult =
  | { ok: true; url: string; paymentId: string | null }
  | { ok: false; kind: "transient" | "permanent_rejection"; error: string; status: number };

type RollypayResponse = RollypayPayment;

function parseResponse(raw: string): RollypayResponse | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? parsed as RollypayResponse : null;
  } catch {
    return null;
  }
}

function requestHeaders(apiKey: string): Record<string, string> {
  return {
    "X-API-Key": apiKey,
    "X-Nonce": randomUUID(),
  };
}

function describeError(status: number, body: RollypayResponse | null, raw: string): string {
  const detail = body?.message ?? body?.error ?? raw.slice(0, 200);
  return status === 401
    ? `RollyPay: неверный ключ кассы или повтор nonce (${detail})`
    : `RollyPay вернул ${status}: ${detail || "без описания"}`;
}

export function rollypayCreateFailure(
  error: string,
  status = 503,
): Extract<CreateRollypayPaymentResult, { ok: false }> {
  return {
    ok: false,
    kind: status === 408 || status === 429 || status >= 500 ? "transient" : "permanent_rejection",
    status,
    error,
  };
}

export async function createRollypayPayment(
  params: CreateRollypayPaymentParams,
): Promise<CreateRollypayPaymentResult> {
  const { config } = params;
  if (!isRollypayConfigured(config)) return rollypayCreateFailure("RollyPay не настроен", 503);

  const currency = (params.currency || "RUB").trim().toUpperCase();
  if (currency !== "RUB") {
    return rollypayCreateFailure(`RollyPay принимает только рубли, а цена указана в ${currency}`, 400);
  }

  const amount = Number(params.amount);
  if (!Number.isFinite(amount) || amount <= 0) return rollypayCreateFailure("Некорректная сумма платежа", 400);

  const payload: Record<string, unknown> = {
    amount: amount.toFixed(2),
    payment_currency: currency,
    order_id: params.orderId,
    ...(params.description ? { description: params.description } : {}),
    ...(params.customerId ? { customer_id: params.customerId } : {}),
    ...(params.successRedirectUrl ? { success_redirect_url: params.successRedirectUrl } : {}),
    ...(params.failRedirectUrl ? { fail_redirect_url: params.failRedirectUrl } : {}),
    ...(params.metadata ? { metadata: params.metadata } : {}),
    ...(config.testMode ? { test: true } : {}),
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const proxy = await getProxyUrl("payments");
    const response = await proxyFetch(`${API_BASE}/api/v1/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...requestHeaders(config.apiKey.trim()) },
      body: JSON.stringify(payload),
      signal: controller.signal,
    }, proxy);
    const raw = await response.text();
    const body = parseResponse(raw);

    if (!response.ok) return rollypayCreateFailure(describeError(response.status, body, raw), response.status);

    const url = body?.pay_url?.trim();
    if (!url) return rollypayCreateFailure("RollyPay не вернул ссылку на оплату", 503);
    return { ok: true, url, paymentId: body?.payment_id?.trim() || null };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return rollypayCreateFailure("RollyPay не ответил вовремя", 408);
    return rollypayCreateFailure(error instanceof Error ? error.message : String(error), 503);
  } finally {
    clearTimeout(timeoutId);
  }
}

export type RollypayPaymentLookup =
  | { ok: true; payment: RollypayPayment }
  | { ok: false; kind: "transient" | "remote_rejection" | "not_configured"; status: number; error: string };

export function rollypayPaymentLookupFailure(
  error: string,
  status = 503,
): Extract<RollypayPaymentLookup, { ok: false }> {
  return {
    ok: false,
    kind: status === 408 || status === 429 || status >= 500 ? "transient" : "remote_rejection",
    status,
    error,
  };
}

export async function getRollypayPayment(
  paymentId: string,
  config: RollypayConfig,
): Promise<RollypayPaymentLookup> {
  const id = paymentId.trim();
  const apiKey = config.apiKey?.trim() ?? "";
  if (!id || !apiKey) return { ok: false, kind: "not_configured", status: 503, error: "RollyPay не настроен" };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const proxy = await getProxyUrl("payments");
    const response = await proxyFetch(`${API_BASE}/api/v1/payments/${encodeURIComponent(id)}`, {
      method: "GET",
      headers: requestHeaders(apiKey),
      signal: controller.signal,
    }, proxy);
    const raw = await response.text();
    const body = parseResponse(raw);

    if (!response.ok) return rollypayPaymentLookupFailure(describeError(response.status, body, raw), response.status);
    if (!body) return rollypayPaymentLookupFailure("RollyPay вернул невалидный JSON", 502);
    return { ok: true, payment: body };
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "RollyPay не ответил вовремя"
      : error instanceof Error ? error.message : String(error);
    return rollypayPaymentLookupFailure(message);
  } finally {
    clearTimeout(timeoutId);
  }
}

export function verifyRollypayWebhookSignature(
  signingSecret: string,
  rawBody: string,
  timestamp: string | undefined,
  signature: string | undefined,
): boolean {
  const secret = signingSecret?.trim();
  const ts = timestamp?.trim();
  const sig = signature?.trim();
  if (!secret || !ts || !sig) return false;

  const timestampSeconds = Number(ts);
  if (!Number.isFinite(timestampSeconds)) return false;
  if (Math.abs(Date.now() / 1000 - timestampSeconds) > WEBHOOK_MAX_AGE_SEC) return false;

  const expected = createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  const actual = Buffer.from(sig.toLowerCase(), "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return actual.length === expectedBytes.length && timingSafeEqual(actual, expectedBytes);
}

export type RollypayPaymentValidation =
  | { ok: true }
  | { ok: false; reason: string };

function canonicalFiatAmount(value: string | number | undefined): string | null {
  if (typeof value === "string") return /^\d+\.\d{2}$/.test(value) ? value : null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const formatted = value.toFixed(2);
  return Number(formatted) === value ? formatted : null;
}

export function validateRollypayPayment(
  localPayment: { orderId: string; externalId?: string | null; amount: number; currency: string },
  webhook: RollypayWebhookPayload,
  remotePayment: RollypayPayment | null,
): RollypayPaymentValidation {
  if (!remotePayment) return { ok: false, reason: "payment_not_confirmed" };

  const webhookPaymentId = webhook.payment_id?.trim();
  const remotePaymentId = remotePayment.payment_id?.trim();
  if (!webhookPaymentId || !remotePaymentId || remotePaymentId !== webhookPaymentId) {
    return { ok: false, reason: "payment_id_mismatch" };
  }

  const storedExternalId = localPayment.externalId?.trim();
  if (storedExternalId && storedExternalId !== remotePaymentId) {
    return { ok: false, reason: "stored_external_id_mismatch" };
  }

  const localOrderId = localPayment.orderId.trim();
  if (!localOrderId || webhook.order_id?.trim() !== localOrderId || remotePayment.order_id?.trim() !== localOrderId) {
    return { ok: false, reason: "order_id_mismatch" };
  }

  if ((remotePayment.status ?? "").trim().toLowerCase() !== "paid") {
    return { ok: false, reason: "payment_not_paid" };
  }

  if (localPayment.currency.trim().toUpperCase() !== "RUB"
    || webhook.currency?.trim().toUpperCase() !== "RUB"
    || remotePayment.payment_currency?.trim().toUpperCase() !== "RUB") {
    return { ok: false, reason: "payment_currency_mismatch" };
  }

  const expectedAmount = localPayment.amount.toFixed(2);
  const webhookAmount = canonicalFiatAmount(webhook.amount);
  const remoteAmount = canonicalFiatAmount(remotePayment.amount);
  if (webhookAmount !== expectedAmount || remoteAmount !== expectedAmount) {
    return { ok: false, reason: "payment_amount_mismatch" };
  }

  return { ok: true };
}
