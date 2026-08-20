/**
 * Sync-адаптеры платёжных провайдеров для журнала платежей.
 *
 * Каждый адаптер тянет provider-side транзакции из API провайдера и
 * складывает/матчит их в ProviderTransaction + (при матче) обновляет
 * статус локального Payment для неуспешных финальных статусов.
 * Активация/комплит платежей здесь НЕ делается — это задача reconciliation-cron'ов.
 */

import { prisma } from "../../../db.js";
import { getSystemConfig } from "../../client/client.service.js";
import { isPlategaConfigured, type PlategaConfig } from "../../platega/platega.service.js";
import { proxyFetch } from "../../proxy-util/proxy-fetch.js";
import { getProxyUrl } from "../../proxy-util/get-proxy-url.js";
import { normalizeProviderStatus } from "../payments-log.service.js";

export type SyncResult = {
  fetched: number;
  created: number;
  updated: number;
  matched: number;
};

export interface ProviderSyncAdapter {
  readonly provider: string;
  sync(): Promise<SyncResult>;
}

const PLATEGA_API_BASE = "https://app.platega.io";

/** Сырая запись из Platega export API (все поля опциональны — API нестабилен). */
type PlategaExportRow = {
  recordId?: string;
  createdAt?: string;
  amount?: number | string;
  currencyCode?: string;
  status?: string;
  paymentMethod?: string;
  description?: string;
  payload?: string;
};

function parseProviderDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  // Формат Platega: "2026-06-15 13:44:13" (UTC) — приводим к ISO.
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T") + "Z";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * POST /transaction/export/json. По докам ответ — ссылка на JSON-файл,
 * по факту пример в доках — сразу массив. Обрабатываем оба варианта.
 */
async function exportPlategaTransactions(config: PlategaConfig): Promise<PlategaExportRow[]> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-MerchantId": config.merchantId.trim(),
    "X-Secret": config.secret.trim(),
  };
  const proxy = await getProxyUrl("payments");

  const res = await proxyFetch(`${PLATEGA_API_BASE}/transaction/export/json`, {
    method: "POST",
    headers,
    // Все поля тела опциональны — пустое тело = полная выгрузка.
    body: JSON.stringify({ timeZoneId: "UTC" }),
    signal: AbortSignal.timeout(60_000),
  }, proxy);

  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    throw new Error("Platega export: неверные креды merchantId/secret");
  }
  if (!res.ok) throw new Error(`Platega export → ${res.status}: ${text.slice(0, 300)}`);

  let data: unknown;
  try {
    data = text ? JSON.parse(text) : [];
  } catch {
    throw new Error("Platega export: невалидный JSON в ответе");
  }

  if (Array.isArray(data)) return data as PlategaExportRow[];

  // Вариант «ссылка на файл»: ищем URL в типичных полях и скачиваем его.
  const obj = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const link = [obj.url, obj.link, obj.file, obj.fileUrl, obj.downloadUrl, obj.href]
    .find((v): v is string => typeof v === "string" && /^https?:\/\//.test(v));
  if (!link) throw new Error("Platega export: неожиданный формат ответа (нет ни массива, ни ссылки на файл)");

  const fileRes = await proxyFetch(link, { signal: AbortSignal.timeout(60_000) }, proxy);
  const fileText = await fileRes.text();
  if (!fileRes.ok) throw new Error(`Platega export: не удалось скачать файл (${fileRes.status})`);
  const fileData = fileText ? JSON.parse(fileText) : [];
  if (!Array.isArray(fileData)) throw new Error("Platega export: файл не содержит JSON-массив");
  return fileData as PlategaExportRow[];
}

export class PlategaSyncAdapter implements ProviderSyncAdapter {
  readonly provider = "platega";

  async sync(): Promise<SyncResult> {
    const config = await getSystemConfig();
    const plategaConfig: PlategaConfig = {
      merchantId: config.plategaMerchantId || "",
      secret: config.plategaSecret || "",
    };
    if (!isPlategaConfigured(plategaConfig)) {
      throw new Error("Platega не настроена: заполните platega_merchant_id / platega_secret в настройках");
    }

    const rows = await exportPlategaTransactions(plategaConfig);

    // Батч-матч: собираем recordId и payload, одним запросом тянем кандидатов.
    const recordIds = rows.map((r) => r.recordId).filter((v): v is string => Boolean(v));
    const payloads = rows.map((r) => r.payload).filter((v): v is string => Boolean(v));
    const candidates = await prisma.payment.findMany({
      where: {
        OR: [
          ...(recordIds.length > 0 ? [{ externalId: { in: recordIds } }] : []),
          ...(payloads.length > 0 ? [{ orderId: { in: payloads } }] : []),
        ],
      },
      select: { id: true, externalId: true, orderId: true, status: true },
    });
    const byExternalId = new Map(candidates.filter((p) => p.externalId).map((p) => [p.externalId as string, p]));
    const byOrderId = new Map(candidates.map((p) => [p.orderId, p]));

    const result: SyncResult = { fetched: rows.length, created: 0, updated: 0, matched: 0 };

    for (const row of rows) {
      const recordId = (row.recordId ?? "").trim();
      if (!recordId) continue;
      const payload = (row.payload ?? "").trim() || null;
      const remoteStatus = (row.status ?? "").trim() || "PENDING";
      const amount = typeof row.amount === "number" ? row.amount : Number(row.amount) || 0;

      const match = byExternalId.get(recordId) ?? (payload ? byOrderId.get(payload) : undefined);
      if (match) result.matched += 1;

      const data = {
        status: remoteStatus,
        paymentMethod: row.paymentMethod?.trim() || null,
        amount,
        currency: (row.currencyCode ?? "RUB").trim().toUpperCase(),
        payload,
        description: row.description?.trim() || null,
        providerCreatedAt: parseProviderDate(row.createdAt),
        raw: JSON.stringify(row),
        paymentId: match?.id ?? null,
      };

      const existing = await prisma.providerTransaction.findUnique({
        where: { provider_externalId: { provider: this.provider, externalId: recordId } },
        select: { id: true },
      });
      if (existing) {
        await prisma.providerTransaction.update({ where: { id: existing.id }, data });
        result.updated += 1;
      } else {
        await prisma.providerTransaction.create({
          data: { provider: this.provider, externalId: recordId, ...data },
        });
        result.created += 1;
      }

      // Неуспешные финальные статусы проталкиваем в локальный платёж
      // (PAID не ставим — комплит делает platega-reconciliation.cron).
      if (match) {
        const normalized = normalizeProviderStatus(remoteStatus);
        const isFinalFailure = normalized === "CANCELED" || normalized === "FAILED";
        const canOverride = match.status !== "PAID" && match.status !== "REFUNDED";
        if (isFinalFailure && canOverride && match.status !== normalized) {
          await prisma.payment.update({ where: { id: match.id }, data: { status: normalized } });
        }
      }
    }

    return result;
  }
}

/** Реестр sync-адаптеров. Новые провайдеры добавляются сюда. */
export function getProviderSyncAdapter(provider: string): ProviderSyncAdapter | null {
  switch (provider) {
    case "platega":
      return new PlategaSyncAdapter();
    default:
      return null;
  }
}
