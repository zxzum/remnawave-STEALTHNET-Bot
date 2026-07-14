import assert from "node:assert/strict";
import test from "node:test";

const page = (await import("./public-subscription-page.js").catch(() => ({}))) as Record<string, unknown>;

test("HTML выдаётся только обычному браузеру, а не VPN-клиенту", () => {
  assert.equal(typeof page.isBrowserSubscriptionRequest, "function");
  const detects = page.isBrowserSubscriptionRequest as (userAgent: string, accept: string) => boolean;

  assert.equal(detects("Mozilla/5.0 Chrome/126 Safari/537.36", "text/html,application/xhtml+xml"), true);
  assert.equal(detects("Happ/3.2.1", "text/html,*/*"), false);
  assert.equal(detects("v2rayTun/1.0", "text/html,*/*"), false);
  assert.equal(detects("Mozilla/5.0 Chrome/126 Safari/537.36", "*/*"), false);
});

test("страница отображает квоты и все приложения из админского JSON безопасно", () => {
  assert.equal(typeof page.renderPublicSubscriptionPage, "function");
  const render = page.renderPublicSubscriptionPage as (model: Record<string, unknown>) => string;
  const publicUrl = "https://bot.example/api/sub/public-token";
  const html = render({
    publicUrl,
    title: "Стандарт <script>alert(1)</script>",
    status: "ACTIVE",
    expireAt: "2026-08-13T17:25:18.046Z",
    mainStatus: "ACTIVE",
    quotas: [{
      key: "whitelist",
      displayName: "WhiteList",
      limitBytes: String(20 * 1024 ** 3),
      usedBytes: String(5 * 1024 ** 3),
      remainingBytes: String(15 * 1024 ** 3),
      resetMode: "monthly",
      nextResetAt: "2026-08-01T00:00:00.000Z",
      status: "ACTIVE",
    }],
    config: {
      platforms: {
        ios: {
          displayName: { ru: "iOS" },
          apps: [{
            name: "Happ",
            featured: true,
            blocks: [{
              title: { ru: "Подключение" },
              description: { ru: "Добавьте подписку" },
              buttons: [{
                link: "happ://add/{{SUBSCRIPTION_LINK}}",
                text: { ru: "Добавить в Happ" },
                type: "subscriptionLink",
              }],
            }],
          }],
        },
        windows: {
          displayName: { ru: "Windows" },
          apps: [{
            name: "Koala Clash",
            blocks: [{
              buttons: [
                { link: "koala-clash://install-config?url={{SUBSCRIPTION_LINK}}", text: { ru: "Добавить" }, type: "subscriptionLink" },
                { link: "javascript:alert(1)", text: { ru: "Опасно" }, type: "external" },
              ],
            }],
          }],
        },
      },
    },
  });

  assert.match(html, /<!doctype html>/i);
  assert.match(html, /Обычная подписка/);
  assert.match(html, /Основной доступ/);
  assert.match(html, /Безлимит/);
  assert.match(html, /WhiteList/);
  assert.match(html, /5 ГБ/);
  assert.match(html, /15 ГБ/);
  assert.match(html, /Happ/);
  assert.match(html, /INCY/);
  assert.match(html, /Koala Clash/);
  assert.match(html, /happ:\/\/add\/https:\/\/bot\.example\/api\/sub\/public-token/);
  assert.match(html, /incy:\/\/add\/https:\/\/bot\.example\/api\/sub\/public-token/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.doesNotMatch(html, /\/assets\//);
});

