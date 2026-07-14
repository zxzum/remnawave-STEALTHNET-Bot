import assert from "node:assert/strict";
import test from "node:test";

const merge = (await import("./composite-subscription.js").catch(() => ({}))) as Record<string, unknown>;

type Source = { key: string; body: string; contentType?: string };

test("объединяет Base64-подписки без дублей", () => {
  assert.equal(typeof merge.mergeSubscriptionBodies, "function");
  const run = merge.mergeSubscriptionBodies as (sources: Source[]) => { body: string; format: string };
  const main = Buffer.from("vless://main\ntrojan://shared").toString("base64");
  const limited = Buffer.from("trojan://shared\nvless://limited").toString("base64");

  const result = run([
    { key: "primary", body: main, contentType: "text/plain" },
    { key: "limited", body: limited, contentType: "text/plain" },
  ]);

  assert.equal(result.format, "base64");
  assert.equal(Buffer.from(result.body, "base64").toString(), "vless://main\ntrojan://shared\nvless://limited");
});

test("объединяет массивы XRAY JSON", () => {
  assert.equal(typeof merge.mergeSubscriptionBodies, "function");
  const run = merge.mergeSubscriptionBodies as (sources: Source[]) => { body: string; format: string };
  const result = run([
    { key: "primary", body: JSON.stringify([{ remarks: "Default" }]), contentType: "application/json" },
    { key: "limited", body: JSON.stringify([{ remarks: "Limited" }]), contentType: "application/json" },
  ]);

  assert.equal(result.format, "json");
  assert.deepEqual(JSON.parse(result.body), [{ remarks: "Default" }, { remarks: "Limited" }]);
});

test("объединяет Sing-box JSON и изолирует теги дополнительных компонентов", () => {
  assert.equal(typeof merge.mergeSubscriptionBodies, "function");
  const run = merge.mergeSubscriptionBodies as (sources: Source[]) => { body: string; format: string };
  const result = run([
    {
      key: "primary",
      body: JSON.stringify({ outbounds: [{ type: "selector", tag: "proxy", outbounds: ["main"] }, { type: "vless", tag: "main" }] }),
      contentType: "application/json",
    },
    {
      key: "limited",
      body: JSON.stringify({ outbounds: [{ type: "selector", tag: "proxy", outbounds: ["wl"] }, { type: "vless", tag: "wl" }] }),
      contentType: "application/json",
    },
  ]);
  const parsed = JSON.parse(result.body) as { outbounds: Array<{ tag: string; outbounds?: string[] }> };

  assert.equal(result.format, "json");
  assert.deepEqual(parsed.outbounds.map((item) => item.tag), ["proxy", "main", "limited:proxy", "limited:wl"]);
  assert.deepEqual(parsed.outbounds[0]?.outbounds, ["main", "limited:proxy"]);
  assert.deepEqual(parsed.outbounds[2]?.outbounds, ["limited:wl"]);
});

test("при несовместимом формате возвращает основной компонент", () => {
  assert.equal(typeof merge.mergeSubscriptionBodies, "function");
  const run = merge.mergeSubscriptionBodies as (sources: Source[]) => { body: string; format: string; mergedKeys: string[] };
  const main = Buffer.from("vless://main").toString("base64");
  const result = run([
    { key: "primary", body: main, contentType: "text/plain" },
    { key: "limited", body: "proxies:\n  - name: WL", contentType: "text/yaml" },
  ]);

  assert.equal(result.body, main);
  assert.equal(result.format, "base64");
  assert.deepEqual(result.mergedKeys, ["primary"]);
});

test("определяет основные клиенты и оставляет безопасный Default для неизвестных", () => {
  assert.equal(typeof merge.detectSubscriptionClient, "function");
  const detect = merge.detectSubscriptionClient as (ua: string) => { name: string; mergeMode: string };

  assert.deepEqual(detect("Happ/3.2.1"), { name: "happ", mergeMode: "base64-json" });
  assert.deepEqual(detect("INCY/1.0"), { name: "incy", mergeMode: "base64-json" });
  assert.deepEqual(detect("v2rayTun/6.0"), { name: "v2raytun", mergeMode: "base64-json" });
  assert.deepEqual(detect("koala-clash/2.0"), { name: "koala-clash", mergeMode: "main-only" });
  assert.deepEqual(detect("SomeFutureClient/1"), { name: "default", mergeMode: "main-only" });
});

test("проксирует HWID и клиентские заголовки, но не секреты и proxy-заголовки", () => {
  assert.equal(typeof merge.selectForwardHeaders, "function");
  const select = merge.selectForwardHeaders as (headers: Record<string, string | string[] | undefined>) => Record<string, string>;
  assert.deepEqual(select({
    "user-agent": "Happ/3",
    "x-hwid": "device-1",
    "x-device-os": "iOS",
    "x-client-feature": "json",
    authorization: "Bearer secret",
    cookie: "secret=1",
    "x-forwarded-for": "127.0.0.1",
    host: "stealth.example",
  }), {
    "user-agent": "Happ/3",
    "x-hwid": "device-1",
    "x-device-os": "iOS",
    "x-client-feature": "json",
  });
});

test("агрегирует subscription-userinfo: usage суммируется, unlimited main не скрывает limited total", () => {
  assert.equal(typeof merge.mergeSubscriptionUserinfo, "function");
  const aggregate = merge.mergeSubscriptionUserinfo as (values: string[]) => string;
  assert.equal(
    aggregate([
      "upload=10; download=20; total=0; expire=2000000000",
      "upload=3; download=7; total=53687091200; expire=2000000000",
    ]),
    "upload=13; download=27; total=53687091200; expire=2000000000",
  );
});

test("извлекает upstream subscription URL из вариантов ответа Remnawave", () => {
  assert.equal(typeof merge.extractRemnaSubscriptionUrl, "function");
  const extract = merge.extractRemnaSubscriptionUrl as (value: unknown) => string | null;
  assert.equal(extract({ response: { subscriptionUrl: "https://sub.example/sub/a" } }), "https://sub.example/sub/a");
  assert.equal(extract({ data: { subscriptionUrl: "https://sub.example/sub/b" } }), "https://sub.example/sub/b");
  assert.equal(extract({ response: {} }), null);
});

test("объединяет служебные response headers и сохраняет публичную ссылку", () => {
  assert.equal(typeof merge.mergeSubscriptionResponseHeaders, "function");
  const combine = merge.mergeSubscriptionResponseHeaders as (
    sources: Array<{ key: string; headers: Record<string, string> }>,
    publicUrl: string,
    degradedKeys: string[],
  ) => Record<string, string>;
  const result = combine([
    {
      key: "primary",
      headers: {
        "profile-title": "base64:U1RFQUxUSE5FVA==",
        "support-url": "https://t.me/support",
        "subscription-userinfo": "upload=10; download=20; total=0; expire=2000000000",
      },
    },
    {
      key: "limited",
      headers: {
        "subscription-userinfo": "upload=3; download=7; total=100; expire=2000000000",
        "x-hwid-active": "true",
      },
    },
  ], "https://stealth.example/api/sub/token", ["streaming"]);

  assert.equal(result["profile-title"], "base64:U1RFQUxUSE5FVA==");
  assert.equal(result["profile-web-page-url"], "https://stealth.example/api/sub/token");
  assert.equal(result["subscription-userinfo"], "upload=13; download=27; total=100; expire=2000000000");
  assert.equal(result["x-hwid-active"], "true");
  assert.equal(result["x-stealthnet-degraded-components"], "streaming");
});

test("подменяет upstream URL в существующем Remnawave payload без изменения API-контракта", () => {
  assert.equal(typeof merge.replaceRemnaSubscriptionUrlInPlace, "function");
  const replace = merge.replaceRemnaSubscriptionUrlInPlace as (value: unknown, url: string) => boolean;
  const payload = { response: { uuid: "user-1", subscriptionUrl: "https://remna/sub/old" } };

  assert.equal(replace(payload, "https://stealth/api/sub/public"), true);
  assert.equal(payload.response.subscriptionUrl, "https://stealth/api/sub/public");
  assert.equal(replace(null, "https://stealth/api/sub/public"), false);
});
