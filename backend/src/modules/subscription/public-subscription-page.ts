type LocalizedText = Record<string, string>;

type PageButton = {
  link?: string;
  text?: LocalizedText;
  type?: string;
};

type PageBlock = {
  title?: LocalizedText;
  description?: LocalizedText;
  buttons?: PageButton[];
};

type PageApp = {
  name?: string;
  featured?: boolean;
  blocks?: PageBlock[];
};

type PagePlatform = {
  displayName?: LocalizedText;
  apps?: PageApp[];
};

type PageConfig = {
  platforms?: Record<string, PagePlatform>;
  brandingSettings?: { title?: string; supportUrl?: string };
};

export type PublicSubscriptionPageQuota = {
  key: string;
  displayName: string;
  limitBytes: string;
  usedBytes: string;
  remainingBytes: string;
  resetMode: string;
  nextResetAt: string | null;
  status: string | null;
};

export type PublicSubscriptionPageModel = {
  publicUrl: string;
  title: string;
  status: string | null;
  expireAt: string | null;
  mainStatus: string | null;
  quotas: PublicSubscriptionPageQuota[];
  config: unknown;
};

const BROWSER_USER_AGENT = /(?:Mozilla\/|Chrome\/|Chromium\/|CriOS\/|Firefox\/|FxiOS\/|Safari\/|Edg(?:e|A|iOS)?\/)/i;
const BLOCKED_LINK = /^(?:javascript|data|vbscript):/i;

export function isBrowserSubscriptionRequest(userAgent: string, accept: string): boolean {
  return accept.toLowerCase().includes("text/html") && BROWSER_USER_AGENT.test(userAgent);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char] ?? char);
}

function localized(value: LocalizedText | undefined): string {
  if (!value) return "";
  return value.ru?.trim() || value.en?.trim() || Object.values(value).find((item) => item?.trim())?.trim() || "";
}

function replacePlaceholders(value: string, publicUrl: string): string {
  return value
    .replace(/\{\{SUBSCRIPTION_LINK\}\}/g, publicUrl)
    .replace(/\{\{HAPP_CRYPT[34]_LINK\}\}/g, publicUrl)
    .replace(/\{\{USERNAME\}\}/g, "");
}

function safeHref(value: string, publicUrl: string): string {
  const filled = replacePlaceholders(value, publicUrl).trim();
  return !filled || BLOCKED_LINK.test(filled) ? "#" : filled;
}

function formatBytes(value: string): string {
  let bytes = 0n;
  try { bytes = BigInt(value); } catch { return "0 ГБ"; }
  const gib = Number(bytes) / 1024 ** 3;
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: gib < 10 ? 1 : 0 }).format(gib)} ГБ`;
}

function formatDate(value: string | null): string {
  if (!value) return "Не указана";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Не указана";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Moscow" }).format(date);
}

function statusText(status: string | null): string {
  if (status === "ACTIVE") return "Активна";
  if (status === "LIMITED") return "Лимит исчерпан";
  if (status === "DISABLED") return "Отключена";
  if (status === "EXPIRED") return "Истекла";
  return "Статус обновляется";
}

function readConfig(value: unknown): PageConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as PageConfig;
}

function appButtons(app: PageApp): PageButton[] {
  return (app.blocks ?? []).flatMap((block) => Array.isArray(block.buttons) ? block.buttons : []);
}

function quickLink(config: PageConfig, appPattern: RegExp, fallback: string, publicUrl: string): string {
  for (const platform of Object.values(config.platforms ?? {})) {
    for (const app of platform.apps ?? []) {
      if (!appPattern.test(app.name ?? "")) continue;
      const button = appButtons(app).find((item) => item.type === "subscriptionLink" && item.link);
      if (button?.link) return safeHref(button.link, publicUrl);
    }
  }
  return fallback;
}

function renderButton(button: PageButton, publicUrl: string): string {
  if (!button.link) return "";
  const href = safeHref(button.link, publicUrl);
  const text = localized(button.text) || (button.type === "subscriptionLink" ? "Добавить подписку" : "Открыть");
  const external = /^https?:\/\//i.test(href);
  return `<a class="action ${button.type === "subscriptionLink" ? "action-primary" : ""}" href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${escapeHtml(text)}</a>`;
}

function renderApps(config: PageConfig, publicUrl: string): string {
  const sections = Object.entries(config.platforms ?? {}).flatMap(([key, platform]) => {
    const apps = Array.isArray(platform.apps) ? platform.apps : [];
    if (!apps.length) return [];
    const cards = apps.map((app) => {
      const blocks = (app.blocks ?? []).map((block, index) => {
        const title = localized(block.title) || (index === 0 ? "Инструкция" : `Шаг ${index + 1}`);
        const description = localized(block.description);
        const buttons = (block.buttons ?? []).map((button) => renderButton(button, publicUrl)).join("");
        if (!description && !buttons) return "";
        return `<details${index === 0 ? " open" : ""}><summary>${escapeHtml(title)}</summary>${description ? `<p>${escapeHtml(description)}</p>` : ""}${buttons ? `<div class="actions">${buttons}</div>` : ""}</details>`;
      }).join("");
      return `<article class="app-card"><div class="app-title"><span class="app-icon">${escapeHtml((app.name ?? "?").slice(0, 1).toUpperCase())}</span><div><h3>${escapeHtml(app.name || "Приложение")}</h3>${app.featured ? '<span class="featured">Рекомендуем</span>' : ""}</div></div>${blocks || '<p class="muted">Скопируйте ссылку подписки и добавьте её в приложение.</p>'}</article>`;
    }).join("");
    return [`<section class="platform"><h2>${escapeHtml(localized(platform.displayName) || key)}</h2><div class="apps">${cards}</div></section>`];
  });
  return sections.join("") || '<p class="empty">Список приложений пока не настроен. Используйте быстрые кнопки выше или скопируйте ссылку.</p>';
}

function renderQuota(quota: PublicSubscriptionPageQuota): string {
  const limit = formatBytes(quota.limitBytes);
  const used = formatBytes(quota.usedBytes);
  const remaining = formatBytes(quota.remainingBytes);
  const limitNumber = Number(quota.limitBytes);
  const usedNumber = Number(quota.usedBytes);
  const progress = limitNumber > 0 ? Math.min(100, Math.max(0, usedNumber / limitNumber * 100)) : 0;
  return `<article class="stat-card"><div class="stat-heading"><span>${escapeHtml(quota.displayName)}</span><span class="status ${quota.status === "LIMITED" ? "status-warn" : ""}">${escapeHtml(statusText(quota.status))}</span></div><strong>${remaining} осталось</strong><div class="progress"><span style="width:${progress.toFixed(1)}%"></span></div><div class="stat-row"><span>Использовано ${used}</span><span>из ${limit}</span></div>${quota.nextResetAt ? `<div class="reset">Сброс лимита: ${escapeHtml(formatDate(quota.nextResetAt))}</div>` : ""}</article>`;
}

export function renderPublicSubscriptionPage(model: PublicSubscriptionPageModel): string {
  const config = readConfig(model.config);
  const happLink = quickLink(config, /happ/i, `happ://add/${model.publicUrl}`, model.publicUrl);
  const incyLink = quickLink(config, /incy/i, `incy://add/${model.publicUrl}`, model.publicUrl);
  const active = model.status === "ACTIVE" || model.mainStatus === "ACTIVE";
  const quotas = model.quotas.map(renderQuota).join("");
  const brand = config.brandingSettings?.title?.trim() || "STEALTHNET";

  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#f7f8fc"><title>${escapeHtml(model.title)} — ${escapeHtml(brand)}</title>
<style>
:root{color-scheme:light;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172033;background:#f7f8fc}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 20% 0,#e9efff 0,transparent 35%),#f7f8fc;min-height:100vh}a{color:inherit}.shell{width:min(1060px,calc(100% - 32px));margin:auto;padding:28px 0 56px}.topbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px}.brand{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:.08em}.brand-mark{display:grid;place-items:center;width:36px;height:36px;border-radius:12px;color:white;background:linear-gradient(135deg,#2563eb,#7c3aed);box-shadow:0 8px 20px #4f46e533}.status{display:inline-flex;align-items:center;padding:5px 9px;border-radius:999px;background:#eaf9f0;color:#13713b;font-size:12px;font-weight:700}.status-warn{background:#fff3df;color:#9a5700}.hero,.stat-card,.connect,.platform{background:#fff;border:1px solid #e4e8f1;box-shadow:0 12px 32px #25345c0d}.hero{padding:32px;border-radius:28px;margin-bottom:18px}.eyebrow{color:#5b67d7;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}.hero h1{font-size:clamp(28px,5vw,46px);line-height:1.05;margin:10px 0 12px}.hero p{color:#687086;margin:0;line-height:1.6}.quick{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:24px}.quick a{display:flex;align-items:center;justify-content:center;gap:10px;text-decoration:none;padding:15px 18px;border-radius:16px;font-weight:800}.happ{background:linear-gradient(135deg,#2563eb,#4f46e5);color:#fff}.incy{background:#172033;color:#fff}.stats{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin:18px 0}.stat-card{padding:20px;border-radius:20px}.stat-heading,.stat-row{display:flex;justify-content:space-between;gap:12px;align-items:center}.stat-heading{font-weight:700;margin-bottom:16px}.stat-card strong{font-size:22px}.stat-row,.reset,.muted,.empty{color:#747c90;font-size:13px}.progress{height:8px;border-radius:99px;background:#edf0f6;margin:14px 0 8px;overflow:hidden}.progress span{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#2563eb,#7c3aed)}.connect{padding:20px;border-radius:20px;margin-bottom:30px}.connect label{display:block;font-size:13px;font-weight:700;margin-bottom:8px}.copy-row{display:flex;gap:8px}.copy-row input{min-width:0;flex:1;border:1px solid #dce1eb;background:#f8f9fc;border-radius:12px;padding:12px;color:#414a60}.copy-row button{border:0;border-radius:12px;padding:0 18px;background:#eef2ff;color:#3949ab;font-weight:800;cursor:pointer}.platform{padding:24px;border-radius:24px;margin-top:16px}.platform>h2{margin:0 0 16px}.apps{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.app-card{border:1px solid #e7eaf1;border-radius:18px;padding:18px;background:#fcfcfe}.app-title{display:flex;align-items:center;gap:12px;margin-bottom:14px}.app-title h3{margin:0;font-size:18px}.app-icon{display:grid;place-items:center;width:42px;height:42px;border-radius:13px;background:#eef2ff;color:#4f46e5;font-weight:900}.featured{display:inline-block;margin-top:3px;color:#5b67d7;font-size:11px;font-weight:800}.app-card details{border-top:1px solid #edf0f5;padding:12px 0}.app-card summary{cursor:pointer;font-weight:700}.app-card details p{color:#687086;line-height:1.55;font-size:14px}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.action{display:inline-flex;text-decoration:none;border:1px solid #dbe0ea;border-radius:10px;padding:9px 12px;font-size:13px;font-weight:700;background:#fff}.action-primary{background:#eef2ff;border-color:#d8defe;color:#3847b7}.footer{text-align:center;color:#8a91a2;font-size:12px;margin-top:30px}@media(max-width:700px){.shell{width:min(100% - 20px,1060px);padding-top:18px}.hero{padding:24px;border-radius:22px}.quick,.stats,.apps{grid-template-columns:1fr}.copy-row{flex-direction:column}.copy-row button{padding:12px}.platform{padding:18px}.topbar{margin-bottom:18px}}
</style></head><body><main class="shell"><header class="topbar"><div class="brand"><span class="brand-mark">S</span>${escapeHtml(brand)}</div><span class="status ${active ? "" : "status-warn"}">${escapeHtml(active ? "Подписка активна" : statusText(model.status))}</span></header>
<section class="hero"><div class="eyebrow">Обычная подписка</div><h1>${escapeHtml(model.title)}</h1><p>Одна ссылка для подключения на всех ваших устройствах. Действует до ${escapeHtml(formatDate(model.expireAt))}.</p><div class="quick"><a class="happ" href="${escapeHtml(happLink)}">Подключить в Happ</a><a class="incy" href="${escapeHtml(incyLink)}">Подключить в INCY</a></div></section>
<section class="stats"><article class="stat-card"><div class="stat-heading"><span>Основной доступ</span><span class="status ${model.mainStatus === "ACTIVE" ? "" : "status-warn"}">${escapeHtml(statusText(model.mainStatus))}</span></div><strong>Безлимит</strong><div class="reset">Обычные серверы STEALTHNET</div></article>${quotas}</section>
<section class="connect"><label for="subscription-url">Ссылка подписки</label><div class="copy-row"><input id="subscription-url" readonly value="${escapeHtml(model.publicUrl)}"><button id="copy-subscription" type="button">Копировать</button></div></section>
<section><div class="eyebrow">Приложения и инструкции</div>${renderApps(config, model.publicUrl)}</section><footer class="footer">${escapeHtml(brand)} · Не передавайте эту ссылку другим людям</footer></main>
<script>document.getElementById("copy-subscription").addEventListener("click",async function(){var input=document.getElementById("subscription-url");try{await navigator.clipboard.writeText(input.value)}catch(e){input.select();document.execCommand("copy")}this.textContent="Скопировано";setTimeout(()=>this.textContent="Копировать",1600)});</script></body></html>`;
}

