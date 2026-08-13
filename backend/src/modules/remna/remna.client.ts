/**
 * Клиент Remna (RemnaWave) API — по спецификации api-1.yaml
 * Все запросы с Bearer ADMIN_TOKEN.
 */

import { env } from "../../config/index.js";

const REMNA_API_URL = env.REMNA_API_URL?.replace(/\/$/, "") ?? "";
const REMNA_ADMIN_TOKEN = env.REMNA_ADMIN_TOKEN ?? "";
const REMNA_SECRET_KEY = env.REMNA_SECRET_KEY?.trim() ?? "";

export function isRemnaConfigured(): boolean {
  return Boolean(REMNA_API_URL && REMNA_ADMIN_TOKEN);
}

function getHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${REMNA_ADMIN_TOKEN}`,
  };
  if (REMNA_SECRET_KEY) {
    const colonIdx = REMNA_SECRET_KEY.indexOf(":");
    const cookieName = colonIdx > 0 ? REMNA_SECRET_KEY.slice(0, colonIdx) : REMNA_SECRET_KEY;
    const cookieValue = colonIdx > 0 ? REMNA_SECRET_KEY.slice(colonIdx + 1) : REMNA_SECRET_KEY;
    h["Cookie"] = `${cookieName}=${cookieValue}`;
  }
  return h;
}

export async function remnaFetch<T>(
  path: string,
  options: RequestInit = {},
  timeoutMs = 12_000,
): Promise<{ data?: T; error?: string; status: number }> {
  if (!isRemnaConfigured()) {
    return { error: "Remna API not configured", status: 503 };
  }

  const url = `${REMNA_API_URL}${path.startsWith("/") ? path : `/${path}`}`;
  // таймаут на запрос к Remna. Без него медленная/мёртвая нода
  // (или ProxyCheck, рвущий сокет) подвешивала клиентские эндпоинты (/client/subscription,
  // /client/devices синхронно ходят в Remna) до дефолтного undici-таймаута — фронт ловил
  // «fetch failed», и API «как будто отваливался». Теперь — быстрый контролируемый отказ.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      headers: { ...getHeaders(), ...(options.headers as object) },
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data: T | undefined;
    if (text) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        // non-JSON response
      }
    }
    if (!res.ok) {
      return {
        error: (data as { message?: string })?.message ?? res.statusText ?? text.slice(0, 200),
        status: res.status,
      };
    }
    return { data: data as T, status: res.status };
  } catch (e) {
    // AbortError = таймаут: отдаём 504, чтобы вызывающий код отличал «Remna не ответила вовремя»
    // от прочих сетевых ошибок (и не возвращал клиенту туманное «fetch failed»).
    if (e instanceof Error && e.name === "AbortError") {
      return { error: "Remna API timeout", status: 504 };
    }
    const message = e instanceof Error ? e.message : String(e);
    return { error: message, status: 500 };
  } finally {
    clearTimeout(timer);
  }
}

export type Result<T> = { data?: T; error?: string; status: number };

function isNumericUserId(value: string): boolean {
  return /^(?:0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value));
}

function userIdValue(value: string): number | string {
  return isNumericUserId(value) ? Number(value) : value;
}

function userIdsBody(ids: string[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return ids.every(isNumericUserId)
    ? { ...extra, userIds: ids.map(Number) }
    : { ...extra, uuids: ids };
}

function userIdentifierBody(body: Record<string, unknown>): Record<string, unknown> {
  if (typeof body.uuid !== "string" || !isNumericUserId(body.uuid)) return body;
  const { uuid, ...rest } = body;
  return { ...rest, id: Number(uuid) };
}

function hwidBody(userUuid: string, hwid?: string): Record<string, unknown> {
  return isNumericUserId(userUuid)
    ? { userId: Number(userUuid), ...(hwid === undefined ? {} : { hwid }) }
    : { userUuid, ...(hwid === undefined ? {} : { hwid }) };
}

async function remnaGetUserFromStream(field: "email" | "telegramId", value: string) {
  const query = new URLSearchParams({ size: "1", [field]: value });
  return remnaFetch<unknown>(`/api/users/stream?${query}`);
}

/** GET /api/users — пагинация Remna: size и start (offset) */
export function remnaGetUsers(params?: { page?: number; limit?: number; start?: number; size?: number }) {
  const search = new URLSearchParams();
  if (params?.size != null) search.set("size", String(params.size));
  else if (params?.limit != null) search.set("size", String(params.limit));
  if (params?.start != null) search.set("start", String(params.start));
  else if (params?.page != null && params?.limit != null)
    search.set("start", String((params.page - 1) * params.limit));
  const q = search.toString();
  return remnaFetch<unknown>(`/api/users${q ? `?${q}` : ""}`);
}

/** GET /api/users/{uuid} */
export function remnaGetUser(uuid: string) {
  return remnaFetch<unknown>(`/api/users/${uuid}`);
}

/** GET /api/users/by-short-uuid/{shortUuid} */
export function remnaGetUserByShortUuid(shortUuid: string, timeoutMs = 12_000) {
  return remnaFetch<unknown>(`/api/users/by-short-uuid/${encodeURIComponent(shortUuid)}`, {}, timeoutMs);
}

/** DELETE /api/users/{uuid} — удалить пользователя из Remna */
export function remnaDeleteUser(uuid: string) {
  return remnaFetch<unknown>(`/api/users/${uuid}`, { method: "DELETE" });
}

/** GET /api/users/by-username/{username} */
export function remnaGetUserByUsername(username: string) {
  const encoded = encodeURIComponent(username);
  return remnaFetch<unknown>(`/api/users/by-username/${encoded}`);
}

/** GET /api/users/by-email/{email}; API 3.x uses /api/users/stream instead. */
export async function remnaGetUserByEmail(email: string) {
  const encoded = encodeURIComponent(email);
  const legacy = await remnaFetch<unknown>(`/api/users/by-email/${encoded}`);
  return legacy.status === 404 ? remnaGetUserFromStream("email", email) : legacy;
}

/** GET /api/users/by-telegram-id/{telegramId}; API 3.x uses /api/users/stream instead. */
export async function remnaGetUserByTelegramId(telegramId: string) {
  const encoded = encodeURIComponent(telegramId);
  const legacy = await remnaFetch<unknown>(`/api/users/by-telegram-id/${encoded}`);
  return legacy.status === 404 ? remnaGetUserFromStream("telegramId", telegramId) : legacy;
}

/** Извлечь UUID в API 2.x или numeric id в API 3.x (create/get/stream). */
export function extractRemnaUuid(d: unknown): string | null {
  if (!d || typeof d !== "object") return null;
  const o = d as Record<string, unknown>;
  const read = (value: unknown): string | null => {
    if (!value || typeof value !== "object") return null;
    const item = value as Record<string, unknown>;
    if (typeof item.uuid === "string") return item.uuid;
    if (typeof item.id === "number" && Number.isSafeInteger(item.id)) return String(item.id);
    if (typeof item.id === "string" && isNumericUserId(item.id)) return item.id;
    return null;
  };
  const direct = read(o);
  if (direct) return direct;
  const resp = o.response ?? o.data;
  const responseDirect = read(resp);
  if (responseDirect) return responseDirect;
  const users = Array.isArray(o.users)
    ? o.users
    : resp && typeof resp === "object" && Array.isArray((resp as Record<string, unknown>).users)
      ? (resp as Record<string, unknown>).users as unknown[]
      : Array.isArray(resp)
        ? resp
        : null;
  return read(users?.[0]);
}

/**
 * Формирует username для Remna (3–36 символов, только [a-zA-Z0-9_-]).
 * Приоритет: Telegram username → Telegram ID (tg123) → email (local part) → fallback.
 */
export function remnaUsernameFromClient(opts: {
  telegramUsername?: string | null;
  telegramId?: string | null;
  email?: string | null;
  clientIdFallback?: string;
  subscriptionIndex?: number;
}): string {
  const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 36);
  let base = "";
  if (opts.telegramId?.trim()) {
    const digits = opts.telegramId.trim().replace(/\D/g, "");
    if (digits) base = `tg${digits}`;
  }
  if (!base && opts.telegramUsername?.trim()) {
    const u = sanitize(opts.telegramUsername.trim());
    if (u.length >= 3) base = u;
  }
  if (!base && opts.email?.trim()) {
    const local = opts.email.split("@")[0]?.trim();
    if (local) {
      const e = sanitize(local);
      if (e.length >= 3) base = e;
    }
    if (!base) base = sanitize(opts.email.trim());
  }
  if (!base) base = opts.clientIdFallback
    ? "user" + opts.clientIdFallback.slice(-8).replace(/[^a-zA-Z0-9_-]/g, "0")
    : "user" + Date.now().toString(36);
  const suffix = opts.subscriptionIndex && opts.subscriptionIndex > 0 ? `-${opts.subscriptionIndex + 1}` : "";
  const out = sanitize(base).slice(0, 36 - suffix.length) + suffix;
  return out.length >= 3 ? out : "u_" + out.slice(0, 34);
}

/** POST /api/users */
export function remnaCreateUser(body: Record<string, unknown>) {
  return remnaFetch<unknown>("/api/users", { method: "POST", body: JSON.stringify(body) });
}

/** PATCH /api/users */
export function remnaUpdateUser(body: Record<string, unknown>) {
  return remnaFetch<unknown>("/api/users", { method: "PATCH", body: JSON.stringify(userIdentifierBody(body)) });
}

/** GET /api/subscriptions */
export function remnaGetSubscriptions(params?: { page?: number; limit?: number }) {
  const search = new URLSearchParams();
  if (params?.page != null) search.set("page", String(params.page));
  if (params?.limit != null) search.set("limit", String(params.limit));
  const q = search.toString();
  return remnaFetch<unknown>(`/api/subscriptions${q ? `?${q}` : ""}`);
}

/** GET /api/subscription-templates */
export function remnaGetSubscriptionTemplates() {
  return remnaFetch<unknown>("/api/subscription-templates");
}

/** GET /api/internal-squads, /api/external-squads */
export function remnaGetInternalSquads() {
  return remnaFetch<unknown>("/api/internal-squads");
}

export function remnaGetExternalSquads() {
  return remnaFetch<unknown>("/api/external-squads");
}

/** GET /api/system/stats */
export function remnaGetSystemStats() {
  return remnaFetch<unknown>("/api/system/stats");
}

/** GET /api/system/stats/nodes — статистика нод по дням */
export function remnaGetSystemStatsNodes() {
  return remnaFetch<unknown>("/api/system/stats/nodes");
}

/** GET /api/nodes — список нод (uuid, name, address, isConnected, isDisabled, isConnecting, ...) */
export function remnaGetNodes() {
  return remnaFetch<unknown>("/api/nodes");
}

/** POST /api/nodes/{uuid}/actions/enable */
export function remnaEnableNode(uuid: string) {
  return remnaFetch<unknown>(`/api/nodes/${uuid}/actions/enable`, { method: "POST" });
}

/** POST /api/nodes/{uuid}/actions/disable */
export function remnaDisableNode(uuid: string) {
  return remnaFetch<unknown>(`/api/nodes/${uuid}/actions/disable`, { method: "POST" });
}

/** POST /api/nodes/{uuid}/actions/restart */
export function remnaRestartNode(uuid: string) {
  return remnaFetch<unknown>(`/api/nodes/${uuid}/actions/restart`, { method: "POST", body: JSON.stringify({ forceRestart: false }) });
}

/** Тело создания/обновления ноды (Remnawave 2.8.x). configProfile обязателен при создании. */
export interface RemnaNodeInput {
  name: string;
  address: string;
  port?: number | null;
  countryCode?: string;
  isTrafficTrackingActive?: boolean;
  trafficLimitBytes?: number;
  trafficResetDay?: number;
  notifyPercent?: number;
  consumptionMultiplier?: number;
  note?: string | null;
  configProfile: { activeConfigProfileUuid: string; activeInbounds: string[] };
}

/** POST /api/nodes — создать (зарегистрировать) ноду. Обяз.: name(≥3), address, configProfile. */
export function remnaCreateNode(body: RemnaNodeInput) {
  return remnaFetch<unknown>("/api/nodes", { method: "POST", body: JSON.stringify(body) });
}

/** PATCH /api/nodes — обновить ноду (uuid обязателен в теле; остальные поля частичные). */
export function remnaUpdateNode(body: { uuid: string } & Partial<RemnaNodeInput>) {
  return remnaFetch<unknown>("/api/nodes", { method: "PATCH", body: JSON.stringify(body) });
}

/** DELETE /api/nodes/{uuid} — удалить ноду. */
export function remnaDeleteNode(uuid: string) {
  return remnaFetch<unknown>(`/api/nodes/${uuid}`, { method: "DELETE" });
}

/** GET /api/config-profiles — config-профили (+ inbounds) для формы создания ноды. */
export function remnaGetConfigProfiles() {
  return remnaFetch<unknown>("/api/config-profiles");
}

/** GET /api/keygen — публичный ключ панели (SSL_CERT), нужен для install-команды новой ноды. */
export function remnaGetPubKey() {
  return remnaFetch<unknown>("/api/keygen");
}

// ─── Internal squads: CRUD (Remnawave 2.8.x) ───
/** POST /api/internal-squads — создать сквад. Обяз.: name, inbounds[] (uuid инбаундов). */
export function remnaCreateInternalSquad(body: { name: string; inbounds: string[] }) {
  return remnaFetch<unknown>("/api/internal-squads", { method: "POST", body: JSON.stringify(body) });
}
/** PATCH /api/internal-squads — обновить сквад (uuid в теле). */
export function remnaUpdateInternalSquad(body: { uuid: string; name?: string; inbounds?: string[] }) {
  return remnaFetch<unknown>("/api/internal-squads", { method: "PATCH", body: JSON.stringify(body) });
}
/** DELETE /api/internal-squads/{uuid} */
export function remnaDeleteInternalSquad(uuid: string) {
  return remnaFetch<unknown>(`/api/internal-squads/${uuid}`, { method: "DELETE" });
}

// ─── Hosts: CRUD (Remnawave 2.8.x) ───
/** GET /api/hosts — список хостов. */
export function remnaGetHosts() {
  return remnaFetch<unknown>("/api/hosts");
}
/** POST /api/hosts — создать хост. Обяз.: inbound, remark, address, port (+ опц. sni/host/path/tags/security/alpn/…). */
export function remnaCreateHost(body: Record<string, unknown>) {
  return remnaFetch<unknown>("/api/hosts", { method: "POST", body: JSON.stringify(body) });
}
/** PATCH /api/hosts — обновить хост (uuid в теле). */
export function remnaUpdateHost(body: { uuid: string } & Record<string, unknown>) {
  return remnaFetch<unknown>("/api/hosts", { method: "PATCH", body: JSON.stringify(body) });
}
/** DELETE /api/hosts/{uuid} */
export function remnaDeleteHost(uuid: string) {
  return remnaFetch<unknown>(`/api/hosts/${uuid}`, { method: "DELETE" });
}

// ─── Config profiles: CRUD (Remnawave 2.8.x) ───
/** POST /api/config-profiles — создать профиль. Обяз.: name, config (Xray-конфиг JSON). */
export function remnaCreateConfigProfile(body: { name: string; config?: unknown }) {
  return remnaFetch<unknown>("/api/config-profiles", { method: "POST", body: JSON.stringify(body) });
}
/** PATCH /api/config-profiles — обновить профиль (uuid в теле). */
export function remnaUpdateConfigProfile(body: { uuid: string; name?: string; config?: unknown }) {
  return remnaFetch<unknown>("/api/config-profiles", { method: "PATCH", body: JSON.stringify(body) });
}
/** DELETE /api/config-profiles/{uuid} */
export function remnaDeleteConfigProfile(uuid: string) {
  return remnaFetch<unknown>(`/api/config-profiles/${uuid}`, { method: "DELETE" });
}

/** POST /api/users/{uuid}/actions/revoke — отозвать подписку */
export function remnaRevokeUserSubscription(uuid: string, body?: { expirationDate?: string; shortUuid?: string }) {
  return remnaFetch<unknown>(`/api/users/${uuid}/actions/revoke`, {
    method: "POST",
    body: body ? JSON.stringify(body) : "{}",
  });
}

/** POST /api/users/{uuid}/actions/disable */
export function remnaDisableUser(uuid: string) {
  return remnaFetch<unknown>(`/api/users/${uuid}/actions/disable`, { method: "POST" });
}

/** POST /api/users/{uuid}/actions/enable */
export function remnaEnableUser(uuid: string) {
  return remnaFetch<unknown>(`/api/users/${uuid}/actions/enable`, { method: "POST" });
}

/** POST /api/users/{uuid}/actions/reset-traffic */
export function remnaResetUserTraffic(uuid: string) {
  return remnaFetch<unknown>(`/api/users/${uuid}/actions/reset-traffic`, { method: "POST" });
}

/** GET /api/hwid/devices/{userUuid} — список устройств пользователя (Remna HWID) */
export function remnaGetUserHwidDevices(userUuid: string) {
  return remnaFetch<unknown>(`/api/hwid/devices/${userUuid}`);
}

/** POST /api/hwid/devices/delete — удалить устройство пользователя (Remna HWID) */
export function remnaDeleteUserHwidDevice(userUuid: string, hwid: string) {
  return remnaFetch<unknown>("/api/hwid/devices/delete", {
    method: "POST",
    body: JSON.stringify(hwidBody(userUuid, hwid)),
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Массовые эндпоинты Remna (api-1.yaml, docs.rw/api). НЕ использовать для
// действий над одним пользователем — иначе сквады/данные могут затронуть всех.
// Для одного пользователя: remnaUpdateUser({ uuid, activeInternalSquads, ... }).
// ═══════════════════════════════════════════════════════════════════════════════

/** POST /api/users/bulk/update-squads — массово выставляет один и тот же список сквадов многим пользователям (uuids[]). Не использовать для одного — нет мержа с доп. сквадами. */
export function remnaBulkUpdateUsersSquads(body: { uuids: string[]; activeInternalSquads: string[] }) {
  return remnaFetch<unknown>("/api/users/bulk/update-squads", {
    method: "POST",
    body: JSON.stringify(userIdsBody(body.uuids, { activeInternalSquads: body.activeInternalSquads })),
  });
}

/** POST /api/internal-squads/{uuid}/bulk-actions/add-users — в Remna добавляет ВСЕХ пользователей в сквад (summary в api-1.yaml). Не вызывать для назначения сквада одному пользователю — только remnaUpdateUser(activeInternalSquads). */
export function remnaAddUsersToInternalSquad(squadUuid: string, body: { userUuids: string[] }) {
  return remnaFetch<unknown>(`/api/internal-squads/${squadUuid}/bulk-actions/add-users`, {
    method: "POST",
    body: JSON.stringify(
      body.userUuids.every(isNumericUserId)
        ? { userIds: body.userUuids.map(Number) }
        : body,
    ),
  });
}

/**
 * DELETE /api/internal-squads/{squadUuid}/bulk-actions/remove-users
 * Массовое действие в Remna: убирает из сквада ВСЕХ пользователей (тело запроса не принимается).
 * Чтобы убрать сквад только у одного пользователя — remnaUpdateUser(uuid, { activeInternalSquads: [...] }) без этого сквада.
 */
export function remnaRemoveAllUsersFromInternalSquad(squadUuid: string) {
  return remnaFetch<unknown>(`/api/internal-squads/${squadUuid}/bulk-actions/remove-users`, {
    method: "DELETE",
  });
}

/** GET /api/bandwidth-stats/users/{uuid} — user usage by date range */
export function remnaGetUserBandwidthStats(userUuid: string, start: string, end: string) {
  const params = new URLSearchParams({ start, end });
  return remnaFetch<{
    response: {
      categories: string[];
      series: { name: string; data: number[] }[];
      sparklineData: number[];
    };
  }>(`/api/bandwidth-stats/users/${userUuid}?${params}`);
}

/** GET /api/bandwidth-stats/nodes/{uuid}/users — top users usage on node by range */
export function remnaGetNodeUsersUsage(nodeUuid: string, start: string, end: string, topUsersLimit = 50) {
  const params = new URLSearchParams({
    topUsersLimit: String(topUsersLimit),
    start,
    end,
  });
  return remnaFetch<{
    response: {
      categories: string[];
      sparklineData: number[];
      topUsers: { color: string; username: string; total: number }[];
    };
  }>(`/api/bandwidth-stats/nodes/${nodeUuid}/users?${params}`);
}

type RemnaBulkUserUsage = { username: string; total: number };
type RemnaBulkNodeUsage = { topUsers: RemnaBulkUserUsage[] };

function malformedBulkUsageResponse(): Result<RemnaBulkNodeUsage> {
  return { error: "Malformed Remna bulk node usage response", status: 502 };
}

function parseBulkNodeUsage(data: unknown): Result<RemnaBulkNodeUsage> {
  if (!data || typeof data !== "object") return malformedBulkUsageResponse();
  const response = (data as { response?: unknown }).response;
  if (!response || typeof response !== "object") return malformedBulkUsageResponse();
  const topUsers = (response as { topUsers?: unknown }).topUsers;
  if (!Array.isArray(topUsers)) return malformedBulkUsageResponse();

  const parsed: RemnaBulkUserUsage[] = [];
  for (const entry of topUsers) {
    if (!entry || typeof entry !== "object") return malformedBulkUsageResponse();
    const { username, total } = entry as { username?: unknown; total?: unknown };
    if (typeof username !== "string") return malformedBulkUsageResponse();
    if (typeof total !== "number") return malformedBulkUsageResponse();
    if (!Number.isSafeInteger(total) || total < 0) {
      return { error: "Invalid total in Remna bulk node usage response", status: 502 };
    }
    parsed.push({ username, total });
  }

  return { data: { topUsers: parsed }, status: 200 };
}

/** POST /api/bandwidth-stats/nodes/users — aggregated top-user usage for nodes by UTC range. */
export async function remnaGetNodesUsersUsage(
  nodesUuids: string[],
  start: string,
  end: string,
  topUsersLimit: number,
): Promise<Result<RemnaBulkNodeUsage>> {
  const query = new URLSearchParams({ start, end, topUsersLimit: String(topUsersLimit) });
  const result = await remnaFetch<unknown>(`/api/bandwidth-stats/nodes/users?${query}`, {
    method: "POST",
    body: JSON.stringify({ nodesUuids }),
  });
  if (result.error) return { error: result.error, status: result.status };
  if (result.data === undefined) return malformedBulkUsageResponse();

  const parsed = parseBulkNodeUsage(result.data);
  return parsed.error ? parsed : { data: parsed.data, status: result.status };
}

/** GET /api/bandwidth-stats/nodes/realtime — realtime usage per node (removed in API 2.7.2, kept for compat) */
export function remnaGetNodesRealtimeUsage() {
  return remnaFetch<{
    response: {
      nodeUuid: string;
      nodeName: string;
      countryCode: string;
      downloadBytes: number;
      uploadBytes: number;
      totalBytes: number;
      downloadSpeedBps: number;
      uploadSpeedBps: number;
      totalSpeedBps: number;
    }[];
  }>("/api/bandwidth-stats/nodes/realtime");
}

/** POST /api/ip-control/fetch-users-ips/{nodeUuid} — start async job to fetch user IPs on a node */
export function remnaFetchUsersIps(nodeUuid: string) {
  return remnaFetch<{ response: { jobId: string } }>(
    `/api/ip-control/fetch-users-ips/${nodeUuid}`,
    { method: "POST" },
  );
}

/** GET /api/ip-control/fetch-users-ips/result/{jobId} — poll async job result */
export function remnaGetFetchUsersIpsResult(jobId: string) {
  return remnaFetch<{
    response: {
      isCompleted: boolean;
      isFailed: boolean;
      result: {
        success: boolean;
        nodeUuid: string;
        users: { userId: string; ips: { ip: string; lastSeen: string }[] }[];
      } | null;
    };
  }>(`/api/ip-control/fetch-users-ips/result/${jobId}`);
}

/** GET /api/system/nodes/metrics — Prometheus-style metrics per node */
export function remnaGetNodesMetrics() {
  return remnaFetch<{
    response: {
      nodes: {
        nodeUuid: string;
        nodeName: string;
        countryEmoji: string;
        providerName: string;
        usersOnline: number;
        inboundsStats: { tag: string; upload: string; download: string }[];
        outboundsStats: { tag: string; upload: string; download: string }[];
      }[];
    };
  }>("/api/system/nodes/metrics");
}

/** GET /api/users/{uuid} — resolve user by UUID (returns full user with username, etc.) */
export function remnaGetUserByUuid(uuid: string) {
  return remnaFetch<{
    response: {
      uuid: string;
      username: string;
      shortUuid: string;
      [key: string]: unknown;
    };
  }>(`/api/users/${uuid}`);
}

/**
 * POST /api/system/tools/happ/encrypt — зашифровать ссылку через Happ Crypto.
 *
 * Использует встроенный механизм Remnawave (тот же, что обрабатывает плейсхолдер
 * `{{HAPP_CRYPT4_LINK}}` на встроенной sub-page Remnawave). Возвращает
 * зашифрованную ссылку вида `happ://crypt4/...` либо null, если запрос упал
 * (на старых Remna 1.x этого эндпоинта может не быть).
 *
 * Кэшируем результат в памяти на 10 минут — Remnawave при шифровании одной
 * и той же ссылки возвращает один и тот же crypt4-токен (он детерминирован
 * относительно секрета на стороне Remna), а наш клиент дёргает /subscription
 * на каждый рендер кабинета. Кэш экономит сетевой round-trip.
 */
const _happCryptCache = new Map<string, { value: string; ts: number }>();
const HAPP_CRYPT_TTL_MS = 10 * 60 * 1000;

export async function remnaEncryptHappLink(linkToEncrypt: string): Promise<string | null> {
  const trimmed = linkToEncrypt.trim();
  if (!trimmed) return null;
  // Уже crypt — возвращаем как есть
  if (trimmed.startsWith("happ://")) return trimmed;

  const cached = _happCryptCache.get(trimmed);
  if (cached && Date.now() - cached.ts < HAPP_CRYPT_TTL_MS) {
    return cached.value;
  }

  const result = await remnaFetch<{ response?: { encryptedLink?: string } }>(
    "/api/system/tools/happ/encrypt",
    {
      method: "POST",
      body: JSON.stringify({ linkToEncrypt: trimmed }),
    }
  );

  if (result.error || !result.data) return null;
  const encrypted = result.data.response?.encryptedLink;
  if (!encrypted || !encrypted.startsWith("happ://")) return null;

  _happCryptCache.set(trimmed, { value: encrypted, ts: Date.now() });
  return encrypted;
}

/**
 * Шифрует поле `subscriptionUrl` внутри ответа Remnawave inplace.
 * Принимает `result.data` от `remnaGetUser()` и пытается обновить URL.
 * При неудаче — оставляет оригинал. Безопасно: try/catch внутри.
 */
export async function encryptSubscriptionUrlInPlace(data: unknown): Promise<void> {
  try {
    if (!data || typeof data !== "object") return;
    const obj = data as Record<string, unknown>;
    const resp = (obj.response ?? obj) as Record<string, unknown> | undefined;
    if (!resp || typeof resp !== "object") return;
    const rawUrl = resp.subscriptionUrl;
    if (typeof rawUrl !== "string" || !rawUrl.trim() || rawUrl.startsWith("happ://")) return;
    const encrypted = await remnaEncryptHappLink(rawUrl.trim());
    if (encrypted) {
      resp.subscriptionUrl = encrypted;
    }
  } catch {
    // не падаем — оригинальная ссылка останется
  }
}

/** POST /api/nodes/{uuid}/actions/reset-traffic — обнулить счётчик трафика ноды (API 2.8) */
export function remnaResetNodeTraffic(uuid: string) {
  return remnaFetch(`/api/nodes/${uuid}/actions/reset-traffic`, { method: "POST" });
}

/** POST /api/nodes/actions/restart-all — перезапустить ВСЕ ноды (API 2.8) */
export function remnaRestartAllNodes() {
  return remnaFetch("/api/nodes/actions/restart-all", { method: "POST" });
}

/** GET /api/system/stats/bandwidth — сводка трафика панели (2д/7д/месяц/год, строки уже отформатированы) */
export function remnaGetBandwidthStats() {
  return remnaFetch<{
    response: {
      bandwidthLastTwoDays?: { current: string; previous: string; difference: string };
      bandwidthLastSevenDays?: { current: string; previous: string; difference: string };
      bandwidthCalendarMonth?: { current: string; previous: string; difference: string };
      bandwidthCurrentYear?: { current: string; previous: string; difference: string };
    };
  }>("/api/system/stats/bandwidth");
}

/** GET /api/infra-billing/nodes — учёт оплат серверов (nextBillingAt по нодам, API 2.8) */
export function remnaGetInfraBillingNodes() {
  return remnaFetch<{
    response: {
      totalBillingNodes?: number;
      billingNodes?: {
        uuid: string;
        provider?: { uuid: string; name?: string; loginUrl?: string; faviconLink?: string } | null;
        node?: { uuid: string; name?: string; countryCode?: string } | null;
        nextBillingAt?: string;
      }[];
    };
  }>("/api/infra-billing/nodes");
}

/* ═══ API 2.8 — расширенный набор (шаблоны/HWID/recap/hosts-bulk/torrent/drop) ═══ */

export type RemnaTemplateType = "XRAY_JSON" | "XRAY_BASE64" | "MIHOMO" | "STASH" | "CLASH" | "SINGBOX";

/** GET /api/subscription-templates — список шаблонов (без контента) */
export function remnaGetSubTemplates() {
  return remnaFetch<{ response: { uuid: string; name: string; templateType: RemnaTemplateType; viewPosition?: number }[] }>(
    "/api/subscription-templates",
  );
}

/** GET /api/subscription-templates/{uuid} — полный шаблон */
export function remnaGetSubTemplate(uuid: string) {
  return remnaFetch<{ response: { uuid: string; name: string; templateType: RemnaTemplateType; viewPosition?: number; templateJson?: unknown; encodedTemplateYaml?: string } }>(
    `/api/subscription-templates/${uuid}`,
  );
}

/** PATCH /api/subscription-templates — обновить шаблон (body с uuid) */
export function remnaUpdateSubTemplate(body: { uuid: string; name?: string; templateJson?: unknown; encodedTemplateYaml?: string }) {
  return remnaFetch("/api/subscription-templates", { method: "PATCH", body: JSON.stringify(body) });
}

/** GET /api/hwid/devices/stats — устройства по платформам/приложениям */
export function remnaGetHwidStats() {
  return remnaFetch<{ response: { byPlatform?: { platform: string; count: number; byApp?: { app: string; count: number }[] }[]; totalDevices?: number } }>(
    "/api/hwid/devices/stats",
  );
}

/** GET /api/hwid/devices/top-users — топ юзеров по числу устройств */
export function remnaGetHwidTopUsers() {
  return remnaFetch<{ response: { users?: { userUuid: string; id?: number; username: string; devicesCount: number }[] } }>(
    "/api/hwid/devices/top-users",
  );
}

/** GET /api/system/stats/recap — месячная/суммарная сводка панели */
export function remnaGetRecap() {
  return remnaFetch<{
    response: {
      thisMonth?: { users?: number; traffic?: string };
      total?: { users?: number; nodes?: number; traffic?: string; nodesRam?: string; nodesCpuCores?: number; distinctCountries?: number };
      version?: string;
      initDate?: string;
    };
  }>("/api/system/stats/recap");
}

/** POST /api/hosts/bulk/{action} — массовые действия над хостами */
export function remnaHostsBulk(action: "enable" | "disable" | "delete", uuids: string[]) {
  return remnaFetch(`/api/hosts/bulk/${action}`, { method: "POST", body: JSON.stringify({ uuids }) });
}

/** GET /api/node-plugins/torrent-blocker — отчёты торрент-блокера */
export function remnaGetTorrentReports(params?: { start?: number; size?: number }) {
  const qs = new URLSearchParams();
  if (params?.start != null) qs.set("start", String(params.start));
  if (params?.size != null) qs.set("size", String(params.size));
  const q = qs.toString();
  return remnaFetch<{ response?: unknown }>(`/api/node-plugins/torrent-blocker${q ? "?" + q : ""}`);
}

/** GET /api/node-plugins/torrent-blocker/stats — статистика торрент-блокера */
export function remnaGetTorrentStats() {
  return remnaFetch<{ response?: unknown }>("/api/node-plugins/torrent-blocker/stats");
}

/** POST /api/connections/drop — сбросить соединения (API 3.x; fallback для 2.x). */
export async function remnaDropConnections(dropBy: unknown) {
  const dropObject = dropBy && typeof dropBy === "object" ? dropBy as Record<string, unknown> : null;
  const userUuids = dropObject && Array.isArray(dropObject.userUuids) ? dropObject.userUuids : null;
  const adaptedDropBy = userUuids && userUuids.every((id): id is string => typeof id === "string" && isNumericUserId(id))
    ? (() => {
        const { userUuids: _, ...rest } = dropObject!;
        return { ...rest, userIds: userUuids.map(Number) };
      })()
    : dropBy;
  const body = { dropBy: adaptedDropBy };
  const current = await remnaFetch("/api/connections/drop", { method: "POST", body: JSON.stringify(body) });
  return current.status === 404
    ? remnaFetch("/api/ip-control/drop-connections", { method: "POST", body: JSON.stringify({ dropBy }) })
    : current;
}

/* ═══ API 2.8 — заход 3: hosts-tags / users-bulk / node-plugins ═══ */

/** GET /api/hosts/tags — все существующие теги хостов */
export function remnaGetHostTags() {
  return remnaFetch<{ response: { tags?: string[] } }>("/api/hosts/tags");
}

/** POST /api/users/bulk/reset-traffic — сброс трафика пачке юзеров */
export function remnaUsersBulkResetTraffic(uuids: string[]) {
  return remnaFetch("/api/users/bulk/reset-traffic", { method: "POST", body: JSON.stringify(userIdsBody(uuids)) });
}
/** POST /api/users/bulk/revoke-subscription — перевыпуск подписки пачке */
export function remnaUsersBulkRevoke(uuids: string[]) {
  return remnaFetch("/api/users/bulk/revoke-subscription", { method: "POST", body: JSON.stringify(userIdsBody(uuids)) });
}
/** POST /api/users/bulk/delete — удаление пачки юзеров из Remna */
export function remnaUsersBulkDelete(uuids: string[]) {
  return remnaFetch("/api/users/bulk/delete", { method: "POST", body: JSON.stringify(userIdsBody(uuids)) });
}
/** POST /api/users/bulk/update-squads — назначить сквады пачке */
export function remnaUsersBulkUpdateSquads(uuids: string[], activeInternalSquads: string[]) {
  return remnaFetch(
    "/api/users/bulk/update-squads",
    { method: "POST", body: JSON.stringify(userIdsBody(uuids, { activeInternalSquads })) },
  );
}

/** GET /api/node-plugins — список плагинов нод */
export function remnaGetNodePlugins() {
  return remnaFetch<{ response?: { uuid: string; name: string; viewPosition?: number }[] | { plugins?: unknown[] } }>("/api/node-plugins");
}
/** DELETE /api/node-plugins/{uuid} */
export function remnaDeleteNodePlugin(uuid: string) {
  return remnaFetch(`/api/node-plugins/${uuid}`, { method: "DELETE" });
}
/** PATCH /api/node-plugins — обновить плагин (body с uuid) */
export function remnaUpdateNodePlugin(body: { uuid: string; name?: string }) {
  return remnaFetch("/api/node-plugins", { method: "PATCH", body: JSON.stringify(body) });
}

/* ═══ API 2.8 — зелёный список (infra-billing / sub-settings / hwid-client / squad-users / torrent-truncate) ═══ */

/** GET /api/infra-billing/providers — провайдеры серверов */
export function remnaGetInfraProviders() {
  return remnaFetch<{ response: { total?: number; providers?: { uuid: string; name: string; loginUrl?: string; faviconLink?: string }[] } }>("/api/infra-billing/providers");
}
export function remnaCreateInfraProvider(body: { name: string; loginUrl?: string; faviconLink?: string }) {
  return remnaFetch("/api/infra-billing/providers", { method: "POST", body: JSON.stringify(body) });
}
export function remnaDeleteInfraProvider(uuid: string) {
  return remnaFetch(`/api/infra-billing/providers/${uuid}`, { method: "DELETE" });
}
/** POST /api/infra-billing/nodes — привязать ноду к биллингу */
export function remnaCreateInfraBillingNode(body: { providerUuid: string; nodeUuid: string; name?: string; nextBillingAt: string }) {
  return remnaFetch("/api/infra-billing/nodes", { method: "POST", body: JSON.stringify(body) });
}
export function remnaDeleteInfraBillingNode(uuid: string) {
  return remnaFetch(`/api/infra-billing/nodes/${uuid}`, { method: "DELETE" });
}
export function remnaUpdateInfraBillingNode(body: { uuid: string; nextBillingAt?: string; name?: string }) {
  return remnaFetch("/api/infra-billing/nodes", { method: "PATCH", body: JSON.stringify(body) });
}

/** GET/PATCH /api/subscription-settings — настройки страницы подписки */
export function remnaGetSubSettings() {
  return remnaFetch<{ response: Record<string, unknown> }>("/api/subscription-settings");
}
export function remnaUpdateSubSettings(body: Record<string, unknown>) {
  return remnaFetch("/api/subscription-settings", { method: "PATCH", body: JSON.stringify(body) });
}

/** GET /api/hwid/devices/{userUuid} — устройства конкретного юзера */
export function remnaGetUserDevices(userUuid: string) {
  return remnaFetch<{ response: { total?: number; devices?: { hwid: string; platform?: string; osVersion?: string; deviceModel?: string; userAgent?: string; requestIp?: string; createdAt?: string }[] } }>(`/api/hwid/devices/${userUuid}`);
}
/** POST /api/hwid/devices/delete — удалить одно устройство */
export function remnaDeleteUserDevice(userUuid: string, hwid: string) {
  return remnaFetch("/api/hwid/devices/delete", { method: "POST", body: JSON.stringify(hwidBody(userUuid, hwid)) });
}
/** POST /api/hwid/devices/delete-all — сбросить все устройства юзера */
export function remnaDeleteAllUserDevices(userUuid: string) {
  return remnaFetch("/api/hwid/devices/delete-all", { method: "POST", body: JSON.stringify(hwidBody(userUuid)) });
}

/** сквады: доступные ноды + добавить/убрать юзеров */
export function remnaGetSquadAccessibleNodes(uuid: string) {
  return remnaFetch<{ response?: unknown }>(`/api/internal-squads/${uuid}/accessible-nodes`);
}

function parseAccessibleNodeUuids(data: unknown): Result<string[]> {
  if (!data || typeof data !== "object") {
    return { error: "Malformed Remna accessible nodes response", status: 502 };
  }
  const response = (data as { response?: unknown }).response;
  const nodes = Array.isArray(response)
    ? response
    : response && typeof response === "object"
      ? Array.isArray((response as { accessibleNodes?: unknown }).accessibleNodes)
        ? (response as { accessibleNodes: unknown[] }).accessibleNodes
        : Array.isArray((response as { nodes?: unknown }).nodes)
          ? (response as { nodes: unknown[] }).nodes
          : null
      : null;
  if (!nodes) return { error: "Malformed Remna accessible nodes response", status: 502 };

  const uuids = [...new Set(nodes.flatMap((node) => (
    node && typeof node === "object" && typeof (node as { uuid?: unknown }).uuid === "string"
      ? [(node as { uuid: string }).uuid]
      : []
  )))].sort();
  if (uuids.length === 0) return { error: "No accessible nodes configured for squad", status: 422 };
  return { data: uuids, status: 200 };
}

/** Fetches, normalizes, and verifies the accessible nodes for one internal squad. */
export async function remnaGetSquadAccessibleNodeUuids(squadUuid: string): Promise<Result<string[]>> {
  const result = await remnaGetSquadAccessibleNodes(squadUuid);
  if (result.error) return { error: result.error, status: result.status };
  if (result.data === undefined) return { error: "Malformed Remna accessible nodes response", status: 502 };

  const parsed = parseAccessibleNodeUuids(result.data);
  return parsed.error ? parsed : { data: parsed.data, status: result.status };
}
export function remnaSquadAddUsers(uuid: string) {
  return remnaFetch(`/api/internal-squads/${uuid}/bulk-actions/add-users`, { method: "POST", body: JSON.stringify({}) });
}
export function remnaSquadRemoveUsers(uuid: string) {
  return remnaFetch(`/api/internal-squads/${uuid}/bulk-actions/remove-users`, { method: "DELETE" });
}

/** DELETE /api/node-plugins/torrent-blocker/truncate — очистить отчёты торрент-блокера */
export function remnaTruncateTorrent() {
  return remnaFetch("/api/node-plugins/torrent-blocker/truncate", { method: "DELETE" });
}
