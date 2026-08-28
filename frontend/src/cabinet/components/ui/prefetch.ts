import { api } from "@/lib/api";

/** Кэш промисов, чтобы модалки открывались с уже загруженными данными */
type Entry = { at: number; promise: Promise<unknown> };
const cache = new Map<string, Entry>();
const TTL = 60_000;

export function prefetch<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.promise as Promise<T>;
  const promise = loader().catch((cause) => {
    cache.delete(key);
    throw cause;
  });
  cache.set(key, { at: Date.now(), promise });
  return promise;
}

export const prefetchPublicConfig = () => prefetch("public-config", () => api.getPublicConfig());

export const prefetchConversionPreview = (
  token: string,
  args: Parameters<typeof api.clientTariffConversionPreview>[1],
) =>
  prefetch(
    `conversion:${args.tariffId}:${args.priceOptionId ?? ""}`,
    () => api.clientTariffConversionPreview(token, args),
  );
