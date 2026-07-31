/** Извлечь прямую ссылку подписки из ответа Remnawave. */
export function extractRemnaSubscriptionUrl(d: unknown): string | null {
  if (!d || typeof d !== "object") return null;
  const value = d as Record<string, unknown>;
  const nested = value.response && typeof value.response === "object"
    ? value.response as Record<string, unknown>
    : value.data && typeof value.data === "object"
      ? value.data as Record<string, unknown>
      : value;
  if (typeof nested.subscriptionUrl !== "string") return null;
  try {
    const raw = nested.subscriptionUrl;
    const url = new URL(raw);
    const shortId = url.pathname.slice(1);
    const expected = `https://sub.lazeika.xyz/${shortId}`;
    return url.protocol === "https:"
      && url.hostname === "sub.lazeika.xyz"
      && !url.port
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && /^[A-Za-z0-9_-]+$/.test(shortId)
      && raw === expected
      ? raw
      : null;
  } catch {
    return null;
  }
}
