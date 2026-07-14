export type SubscriptionMergeMode = "base64-json" | "main-only";

export type DetectedSubscriptionClient = {
  name: string;
  mergeMode: SubscriptionMergeMode;
};

export function createCompositeSubscriptionMetrics() {
  let requests = 0;
  let successful = 0;
  let degraded = 0;
  let requiredFailures = 0;
  let latencyCount = 0;
  let latencyTotal = 0;
  let latencyMax = 0;
  const formats: Record<string, number> = {};
  const clients: Record<string, number> = {};

  return {
    record(sample: {
      client: string;
      format: string;
      degraded: boolean;
      requiredFailure: boolean;
      upstreamLatenciesMs: number[];
    }) {
      requests++;
      if (!sample.requiredFailure) successful++;
      if (sample.degraded) degraded++;
      if (sample.requiredFailure) requiredFailures++;
      formats[sample.format] = (formats[sample.format] ?? 0) + 1;
      clients[sample.client] = (clients[sample.client] ?? 0) + 1;
      for (const latency of sample.upstreamLatenciesMs) {
        if (!Number.isFinite(latency) || latency < 0) continue;
        latencyCount++;
        latencyTotal += latency;
        latencyMax = Math.max(latencyMax, latency);
      }
    },
    snapshot() {
      return {
        requests,
        successful,
        degraded,
        requiredFailures,
        formats: { ...formats },
        clients: { ...clients },
        upstreamLatencyMs: {
          count: latencyCount,
          average: latencyCount ? Math.round(latencyTotal / latencyCount) : 0,
          max: latencyMax,
        },
      };
    },
  };
}

export const compositeSubscriptionMetrics = createCompositeSubscriptionMetrics();

const CLIENTS: Array<{ pattern: RegExp; name: string; mergeMode: SubscriptionMergeMode }> = [
  { pattern: /^Happ\//i, name: "happ", mergeMode: "base64-json" },
  { pattern: /^INCY\//i, name: "incy", mergeMode: "base64-json" },
  { pattern: /^v2rayTun\//i, name: "v2raytun", mergeMode: "base64-json" },
  { pattern: /^[Ss]treisand/i, name: "streisand", mergeMode: "base64-json" },
  { pattern: /^v2rayN(?:G)?\//i, name: "v2ray", mergeMode: "base64-json" },
  { pattern: /^V2Box/i, name: "v2box", mergeMode: "base64-json" },
  { pattern: /^ktor-client/i, name: "ktor", mergeMode: "base64-json" },
  { pattern: /^(?:sing-box|SFA|SFI|SFM)\//i, name: "sing-box", mergeMode: "base64-json" },
  { pattern: /^(?:NekoBox|Shadowrocket|FoXray)/i, name: "xray", mergeMode: "base64-json" },
  { pattern: /^koala-clash\//i, name: "koala-clash", mergeMode: "main-only" },
  { pattern: /^(?:FlClash ?X|Flowvy|prizrak-box)\//i, name: "mihomo", mergeMode: "main-only" },
  { pattern: /(?:clash|mihomo|hiddify)/i, name: "clash", mergeMode: "main-only" },
];

export function detectSubscriptionClient(userAgent: string): DetectedSubscriptionClient {
  const client = CLIENTS.find(({ pattern }) => pattern.test(userAgent.trim()));
  return client
    ? { name: client.name, mergeMode: client.mergeMode }
    : { name: "default", mergeMode: "main-only" };
}

const FORWARDED_STANDARD_HEADERS = new Set(["accept", "accept-language", "user-agent"]);
const BLOCKED_X_HEADERS = ["x-api-key", "x-forwarded-", "x-real-ip", "x-remna", "x-internal-"];

export function selectForwardHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const selected: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(headers)) {
    if (rawValue == null) continue;
    const name = rawName.toLowerCase();
    const isSafeXHeader = name.startsWith("x-") && !BLOCKED_X_HEADERS.some((blocked) => name.startsWith(blocked));
    if (!FORWARDED_STANDARD_HEADERS.has(name) && !isSafeXHeader) continue;
    selected[name] = Array.isArray(rawValue) ? rawValue.join(", ") : rawValue;
  }
  return selected;
}

export type SubscriptionBodySource = {
  key: string;
  body: string;
  contentType?: string;
};

export type MergedSubscriptionBody = {
  body: string;
  contentType: string;
  format: "base64" | "json" | "other";
  mergedKeys: string[];
};

const SHARE_LINK = /^(?:vless|vmess|trojan|ss|ssr|hysteria2?|hy2|tuic|wireguard):\/\//i;

function decodeBase64Subscription(body: string): string[] | null {
  const compact = body.replace(/\s+/g, "");
  if (!compact || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact)) return null;
  try {
    const decoded = Buffer.from(compact, "base64").toString("utf8");
    const lines = decoded.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return lines.length > 0 && lines.every((line) => SHARE_LINK.test(line)) ? lines : null;
  } catch {
    return null;
  }
}

function parseJson(body: string): unknown | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed !== null && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rewriteTagReferences(value: unknown, tags: Map<string, string>): unknown {
  if (typeof value === "string") return tags.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => rewriteTagReferences(item, tags));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteTagReferences(item, tags)]));
}

function mergeJsonObjects(main: Record<string, unknown>, extras: Array<{ key: string; value: Record<string, unknown> }>): Record<string, unknown> | null {
  if (!Array.isArray(main.outbounds)) return null;
  const result = structuredClone(main);
  const outbounds = result.outbounds as Array<Record<string, unknown>>;
  const mainSelector = outbounds.find((item) => item?.type === "selector" && Array.isArray(item.outbounds));

  for (const extra of extras) {
    if (!Array.isArray(extra.value.outbounds)) return null;
    const sourceOutbounds = extra.value.outbounds.filter(isRecord);
    const tags = new Map<string, string>();
    for (const outbound of sourceOutbounds) {
      if (typeof outbound.tag === "string") tags.set(outbound.tag, `${extra.key}:${outbound.tag}`);
    }
    const renamed = sourceOutbounds.map((outbound) => rewriteTagReferences(outbound, tags)).filter(isRecord);
    outbounds.push(...renamed);

    if (mainSelector) {
      const entry = renamed.find((item) => item.type === "selector")
        ?? renamed.find((item) => item.type === "urltest")
        ?? renamed.find((item) => typeof item.tag === "string" && !["direct", "block", "dns"].includes(String(item.type)));
      if (entry && typeof entry.tag === "string") {
        const selectorEntries = mainSelector.outbounds as unknown[];
        if (!selectorEntries.includes(entry.tag)) selectorEntries.push(entry.tag);
      }
    }
  }
  return result;
}

export function mergeSubscriptionBodies(sources: SubscriptionBodySource[]): MergedSubscriptionBody {
  const main = sources[0];
  if (!main) return { body: "", contentType: "text/plain; charset=utf-8", format: "other", mergedKeys: [] };

  const base64Sources = sources.map((source) => ({ source, lines: decodeBase64Subscription(source.body) }));
  if (base64Sources[0]?.lines) {
    if (base64Sources.some(({ lines }) => !lines)) {
      return { body: main.body, contentType: main.contentType || "text/plain", format: "base64", mergedKeys: [main.key] };
    }
    const lines = [...new Set(base64Sources.flatMap(({ lines }) => lines ?? []))];
    return {
      body: Buffer.from(lines.join("\n")).toString("base64"),
      contentType: "text/plain; charset=utf-8",
      format: "base64",
      mergedKeys: sources.map((source) => source.key),
    };
  }

  const jsonSources = sources.map((source) => ({ source, value: parseJson(source.body) }));
  const mainJson = jsonSources[0]?.value;
  if (mainJson) {
    if (jsonSources.some(({ value }) => value === null)) {
      return { body: main.body, contentType: main.contentType || "application/json", format: "json", mergedKeys: [main.key] };
    }
    if (Array.isArray(mainJson) && jsonSources.every(({ value }) => Array.isArray(value))) {
      return {
        body: JSON.stringify(jsonSources.flatMap(({ value }) => value as unknown[])),
        contentType: "application/json; charset=utf-8",
        format: "json",
        mergedKeys: sources.map((source) => source.key),
      };
    }
    if (isRecord(mainJson) && jsonSources.slice(1).every(({ value }) => isRecord(value))) {
      const merged = mergeJsonObjects(mainJson, jsonSources.slice(1).map(({ source, value }) => ({
        key: source.key,
        value: value as Record<string, unknown>,
      })));
      if (merged) {
        return {
          body: JSON.stringify(merged),
          contentType: "application/json; charset=utf-8",
          format: "json",
          mergedKeys: sources.map((source) => source.key),
        };
      }
    }
    return { body: main.body, contentType: main.contentType || "application/json", format: "json", mergedKeys: [main.key] };
  }

  return { body: main.body, contentType: main.contentType || "text/plain", format: "other", mergedKeys: [main.key] };
}

function parseUserinfo(value: string): Record<string, bigint> {
  const result: Record<string, bigint> = {};
  for (const entry of value.split(";")) {
    const [key, raw] = entry.trim().split("=", 2);
    if (!key || !raw || !/^\d+$/.test(raw.trim())) continue;
    result[key] = BigInt(raw.trim());
  }
  return result;
}

export function mergeSubscriptionUserinfo(values: string[]): string {
  const parsed = values.map(parseUserinfo);
  const sum = (key: string) => parsed.reduce((total, item) => total + (item[key] ?? 0n), 0n);
  const finiteTotals = parsed.map((item) => item.total ?? 0n).filter((total) => total > 0n);
  const expire = parsed[0]?.expire ?? 0n;
  return [
    `upload=${sum("upload")}`,
    `download=${sum("download")}`,
    `total=${finiteTotals.reduce((total, item) => total + item, 0n)}`,
    `expire=${expire}`,
  ].join("; ");
}

export function extractRemnaSubscriptionUrl(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const nested = isRecord(value.response) ? value.response : isRecord(value.data) ? value.data : value;
  if (typeof nested.subscriptionUrl !== "string") return null;
  try {
    const url = new URL(nested.subscriptionUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function replaceRemnaSubscriptionUrlInPlace(value: unknown, publicUrl: string): boolean {
  if (!isRecord(value)) return false;
  const nested = isRecord(value.response) ? value.response : isRecord(value.data) ? value.data : value;
  if (!("subscriptionUrl" in nested)) return false;
  nested.subscriptionUrl = publicUrl;
  return true;
}

const RESPONSE_HEADERS_FROM_MAIN = [
  "announce",
  "content-disposition",
  "profile-title",
  "profile-update-interval",
  "routing",
  "subscription-refill-date",
  "support-url",
] as const;

export function mergeSubscriptionResponseHeaders(
  sources: Array<{ key: string; headers: Record<string, string> }>,
  publicUrl: string,
  degradedKeys: string[],
): Record<string, string> {
  const result: Record<string, string> = {};
  const mainHeaders = Object.fromEntries(
    Object.entries(sources[0]?.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  );
  for (const name of RESPONSE_HEADERS_FROM_MAIN) {
    if (mainHeaders[name]) result[name] = mainHeaders[name];
  }

  const normalizedSources = sources.map(({ headers }) => Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  ));
  const userinfo = normalizedSources.map((headers) => headers["subscription-userinfo"]).filter(Boolean);
  if (userinfo.length) result["subscription-userinfo"] = mergeSubscriptionUserinfo(userinfo);

  for (const headers of normalizedSources) {
    for (const [name, value] of Object.entries(headers)) {
      if (name.startsWith("x-hwid-")) result[name] = value;
    }
  }
  result["profile-web-page-url"] = publicUrl;
  if (degradedKeys.length) result["x-stealthnet-degraded-components"] = degradedKeys.join(",");
  return result;
}
