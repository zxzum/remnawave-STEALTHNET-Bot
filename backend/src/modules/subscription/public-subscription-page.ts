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
  brandName: string;
  brandLogo: string | null;
  hosts: string[];
  title: string;
  status: string | null;
  expireAt: string | null;
  mainStatus: string | null;
  quotas: PublicSubscriptionPageQuota[];
  config: unknown;
};

const BROWSER_USER_AGENT = /(?:Mozilla\/|Chrome\/|Chromium\/|CriOS\/|Firefox\/|FxiOS\/|Safari\/|Edg(?:e|A|iOS)?\/)/i;
const BLOCKED_LINK = /^(?:javascript|data|vbscript):/i;
const SAFE_LOGO = /^(?:https:\/\/|\/|data:image\/(?:png|jpe?g|webp|gif);base64,)/i;

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

function appKey(name: string | undefined, index: number): string {
  return name?.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `app-${index + 1}`;
}

export function availableHostNames(value: unknown, squadUuids: string[]): string[] {
  const root = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const hosts = Array.isArray(value) ? value : Array.isArray(root.response) ? root.response : [];
  const names = new Set<string>();
  for (const item of hosts) {
    if (!item || typeof item !== "object") continue;
    const host = item as Record<string, unknown>;
    if (host.isDisabled === true || host.isHidden === true) continue;
    const remark = typeof host.remark === "string" ? host.remark.trim() : "";
    if (!remark) continue;
    const excluded = new Set((Array.isArray(host.excludedInternalSquads) ? host.excludedInternalSquads : []).flatMap((squad) => {
      if (typeof squad === "string") return [squad];
      if (squad && typeof squad === "object" && typeof (squad as Record<string, unknown>).uuid === "string") return [(squad as Record<string, string>).uuid];
      return [];
    }));
    if (squadUuids.length && squadUuids.every((uuid) => excluded.has(uuid))) continue;
    names.add(remark);
  }
  return [...names];
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
  const text = button.type === "subscriptionLink" ? "Подключиться" : localized(button.text) || "Открыть";
  const external = /^https?:\/\//i.test(href);
  return `<a class="action ${button.type === "subscriptionLink" ? "action-primary" : ""}" href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${escapeHtml(text)}</a>`;
}

function renderApps(config: PageConfig, publicUrl: string): string {
  const platforms = Object.entries(config.platforms ?? {}).flatMap(([key, platform]) => {
    const apps = Array.isArray(platform.apps) ? platform.apps : [];
    if (!apps.length) return [];
    return [{ key, name: localized(platform.displayName) || key, apps }];
  });
  if (!platforms.length) return '<p class="empty">Список приложений пока не настроен. Используйте быстрые кнопки выше или скопируйте ссылку.</p>';
  const options = platforms.map(({ key, name }) => `<option value="${escapeHtml(key)}">${escapeHtml(name)}</option>`).join("");
  const sections = platforms.map(({ key, apps }, platformIndex) => {
    const tabs = apps.map((app, index) => {
      const id = appKey(app.name, index);
      return `<button type="button" class="app-tab" data-app="${escapeHtml(id)}" aria-selected="${index === 0}">${app.featured ? '<span aria-hidden="true">☆</span> ' : ""}${escapeHtml(app.name || "Приложение")}</button>`;
    }).join("");
    const guides = apps.map((app, appIndex) => {
      const id = appKey(app.name, appIndex);
      const blocks = (app.blocks ?? []).map((block, blockIndex) => {
        const title = localized(block.title) || (blockIndex === 0 ? "Инструкция" : `Шаг ${blockIndex + 1}`);
        const description = localized(block.description);
        const buttons = (block.buttons ?? []).map((button) => renderButton(button, publicUrl)).join("");
        if (!description && !buttons) return "";
        return `<section class="guide-block"><h4>${escapeHtml(title)}</h4>${description ? `<p>${escapeHtml(description)}</p>` : ""}${buttons ? `<div class="actions">${buttons}</div>` : ""}</section>`;
      }).join("");
      return `<article class="app-guide" data-guide-app="${escapeHtml(id)}"${appIndex ? " hidden" : ""}><h3>${escapeHtml(app.name || "Приложение")}</h3>${blocks || '<p class="muted">Скопируйте ссылку подписки и добавьте её в приложение.</p>'}</article>`;
    }).join("");
    return `<section class="platform" data-platform="${escapeHtml(key)}"${platformIndex ? " hidden" : ""}><div class="app-tabs">${tabs}</div><div class="guides">${guides}</div></section>`;
  });
  return `<section class="installation" id="installation"><div class="installation-heading"><div><div class="eyebrow">Гайд по подключению</div><h2>Установка</h2></div><label class="platform-picker"><span>Устройство</span><select id="platform-select">${options}</select></label></div>${sections.join("")}</section>`;
}

function renderHosts(hosts: string[]): string {
  const cards = hosts.map((host) => `<span class="host-card">${escapeHtml(host)}</span>`).join("");
  return `<details class="hosts"><summary><span>Доступные локации</span><span class="host-count">${hosts.length}</span></summary><div class="host-grid">${cards || '<span class="muted">Список временно недоступен</span>'}</div></details>`;
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
  const brand = model.brandName.trim() || "STEALTHNET";
  const logo = model.brandLogo?.trim() && SAFE_LOGO.test(model.brandLogo.trim()) ? model.brandLogo.trim() : null;
  const brandMark = logo
    ? `<img class="brand-logo" src="${escapeHtml(logo)}" alt="">`
    : `<span class="brand-mark">${escapeHtml(Array.from(brand)[0] || "S")}</span>`;

  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#0b0f19"><title>${escapeHtml(model.title)} — ${escapeHtml(brand)}</title>
<style>
:root{color-scheme:dark;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#f5f7fb;background:#0b0f19}*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;min-height:100vh;background:radial-gradient(circle at 15% 0,#18284a 0,transparent 32%),radial-gradient(circle at 90% 20%,#25183e 0,transparent 28%),#0b0f19}a{color:inherit}.shell{width:min(1060px,calc(100% - 32px));margin:auto;padding:28px 0 56px}.topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:28px}.brand{display:flex;align-items:center;gap:11px;min-width:0;font-weight:800;letter-spacing:.04em}.brand-logo,.brand-mark{width:40px;height:40px;border-radius:12px;flex:0 0 auto}.brand-logo{object-fit:contain}.brand-mark{display:grid;place-items:center;color:white;background:linear-gradient(135deg,#2dd4bf,#6366f1);box-shadow:0 8px 24px #22d3ee26}.status{display:inline-flex;align-items:center;padding:6px 10px;border-radius:999px;background:#12372d;color:#6ee7b7;font-size:12px;font-weight:700;white-space:nowrap}.status-warn{background:#3d2a17;color:#fbbf24}.hero,.stat-card,.connect,.installation,.hosts{background:#111827e8;border:1px solid #263247;box-shadow:0 18px 50px #0004}.hero{padding:32px;border-radius:28px;margin-bottom:18px}.eyebrow{color:#67e8f9;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.1em}.hero h1{font-size:clamp(28px,5vw,46px);line-height:1.05;margin:10px 0 12px}.hero p{color:#a8b1c3;margin:0;line-height:1.6}.quick{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:24px}.quick a{display:flex;align-items:center;justify-content:center;text-decoration:none;padding:16px 18px;border-radius:15px;font-weight:800}.happ{background:linear-gradient(135deg,#0891b2,#4f46e5);color:#fff}.incy{background:#f8fafc;color:#111827}.stats{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin:18px 0}.stat-card{padding:20px;border-radius:20px}.stat-heading,.stat-row{display:flex;justify-content:space-between;gap:12px;align-items:center}.stat-heading{font-weight:700;margin-bottom:16px}.stat-card strong{font-size:22px}.stat-row,.reset,.muted,.empty{color:#929db2;font-size:13px}.progress{height:8px;border-radius:99px;background:#263247;margin:14px 0 8px;overflow:hidden}.progress span{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#22d3ee,#8b5cf6)}.connect{padding:20px;border-radius:20px;margin-bottom:18px}.connect label{display:block;font-size:13px;font-weight:700;margin-bottom:8px}.copy-row{display:flex;gap:8px}.copy-row input,.platform-picker select{border:1px solid #334155;background:#0b1220;color:#e5e7eb;border-radius:12px}.copy-row input{min-width:0;flex:1;padding:12px}.copy-row button{border:1px solid #334155;border-radius:12px;padding:0 18px;background:#1e293b;color:#c7d2fe;font-weight:800;cursor:pointer}.installation{padding:24px;border-radius:24px}.installation-heading{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:20px}.installation-heading h2{margin:5px 0 0}.platform-picker{display:grid;gap:6px;color:#929db2;font-size:12px}.platform-picker select{min-width:170px;padding:10px 38px 10px 12px;font:inherit;font-weight:700}.app-tabs{display:flex;flex-wrap:wrap;gap:9px;margin-bottom:16px}.app-tab{border:1px solid #334155;border-radius:11px;padding:10px 14px;background:#172033;color:#cbd5e1;font:inherit;font-weight:700;cursor:pointer}.app-tab[aria-selected="true"]{border-color:#22d3ee;background:#10313b;color:#67e8f9;box-shadow:0 0 0 1px #22d3ee33}.app-guide{border:1px solid #2a3549;border-radius:18px;padding:20px;background:#0d1422}.app-guide>h3{margin:0 0 14px}.guide-block{border-top:1px solid #263247;padding:16px 0}.guide-block:first-of-type{border-top:0;padding-top:0}.guide-block:last-child{padding-bottom:0}.guide-block h4{margin:0 0 7px}.guide-block p{color:#a8b1c3;line-height:1.55;margin:0}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.action{display:inline-flex;text-decoration:none;border:1px solid #3b475b;border-radius:10px;padding:10px 13px;font-size:13px;font-weight:700;background:#172033}.action-primary{background:#0e7490;border-color:#22d3ee;color:#ecfeff}.hosts{border-radius:20px;margin-top:18px;padding:0 20px}.hosts summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 0;font-weight:800;cursor:pointer}.host-count{display:grid;place-items:center;min-width:27px;height:27px;padding:0 8px;border-radius:99px;background:#1e293b;color:#a5b4fc;font-size:12px}.host-grid{display:flex;flex-wrap:wrap;gap:8px;padding:0 0 18px}.host-card{border:1px solid #334155;border-radius:10px;padding:8px 11px;background:#0d1422;color:#cbd5e1;font-size:13px}.footer{text-align:center;color:#69758a;font-size:12px;margin-top:30px}@media(max-width:700px){.shell{width:min(100% - 20px,1060px);padding-top:18px}.topbar{margin-bottom:18px}.brand{font-size:14px}.hero{padding:24px;border-radius:22px}.quick,.stats{grid-template-columns:1fr}.copy-row{flex-direction:column}.copy-row button{padding:12px}.installation{padding:18px}.installation-heading{align-items:stretch;flex-direction:column;gap:14px}.platform-picker select{width:100%}.app-tab{flex:1 1 auto}.app-guide{padding:16px}}
</style></head><body><main class="shell"><header class="topbar"><div class="brand">${brandMark}<span>${escapeHtml(brand)}</span></div><span class="status ${active ? "" : "status-warn"}">${escapeHtml(active ? "Подписка активна" : statusText(model.status))}</span></header>
<section class="hero"><div class="eyebrow">Обычная подписка</div><h1>${escapeHtml(model.title)}</h1><p>Одна ссылка для подключения на всех ваших устройствах. Действует до ${escapeHtml(formatDate(model.expireAt))}.</p><div class="quick"><a class="happ" data-quick-app="happ" href="${escapeHtml(happLink)}">Подключить в Happ</a><a class="incy" data-quick-app="incy" href="${escapeHtml(incyLink)}">Подключить в INCY</a></div></section>
<section class="stats"><article class="stat-card"><div class="stat-heading"><span>Основной доступ</span><span class="status ${model.mainStatus === "ACTIVE" ? "" : "status-warn"}">${escapeHtml(statusText(model.mainStatus))}</span></div><strong>Безлимит</strong><div class="reset">Основные серверы ${escapeHtml(brand)}</div></article>${quotas}</section>
<section class="connect"><label for="subscription-url">Ссылка подписки</label><div class="copy-row"><input id="subscription-url" readonly value="${escapeHtml(model.publicUrl)}"><button id="copy-subscription" type="button">Копировать</button></div></section>
${renderApps(config, model.publicUrl)}${renderHosts(model.hosts)}<footer class="footer">${escapeHtml(brand)} · Не передавайте эту ссылку другим людям</footer></main>
<script>(function(){var select=document.getElementById("platform-select"),sections=Array.from(document.querySelectorAll("[data-platform]"));function chooseApp(section,key){var tabs=Array.from(section.querySelectorAll("[data-app]")),guides=Array.from(section.querySelectorAll("[data-guide-app]")),chosen=tabs.find(function(tab){return tab.dataset.app===key})||tabs[0];tabs.forEach(function(tab){tab.setAttribute("aria-selected",String(tab===chosen))});guides.forEach(function(guide){guide.hidden=!chosen||guide.dataset.guideApp!==chosen.dataset.app})}function choosePlatform(key,app){var section=sections.find(function(item){return item.dataset.platform===key})||sections[0];sections.forEach(function(item){item.hidden=item!==section});if(section){if(select)select.value=section.dataset.platform||"";chooseApp(section,app)}}function showGuide(app){var section=sections.find(function(item){return item.querySelector('[data-app="'+app+'"]')});if(section){choosePlatform(section.dataset.platform||"",app);document.getElementById("installation")?.scrollIntoView({behavior:"smooth",block:"start"})}}if(select&&sections.length){var ua=navigator.userAgent.toLowerCase(),platform=/iphone|ipad|ipod/.test(ua)?"ios":/android/.test(ua)?"android":/macintosh|mac os x/.test(ua)?"macos":/windows|win32|win64/.test(ua)?"windows":/linux/.test(ua)?"linux":select.options[0]?.value;choosePlatform(platform||"");select.addEventListener("change",function(){choosePlatform(select.value)})}document.querySelectorAll("[data-app]").forEach(function(tab){tab.addEventListener("click",function(){chooseApp(tab.closest("[data-platform]"),tab.dataset.app)})});document.querySelectorAll("[data-quick-app]").forEach(function(link){link.addEventListener("click",function(){var left=false,mark=function(){if(document.hidden)left=true};document.addEventListener("visibilitychange",mark,{once:true});window.addEventListener("pagehide",function(){left=true},{once:true});setTimeout(function(){if(!left&&document.visibilityState==="visible")showGuide(link.dataset.quickApp)},1400)})});document.getElementById("copy-subscription").addEventListener("click",async function(){var input=document.getElementById("subscription-url");try{await navigator.clipboard.writeText(input.value)}catch(e){input.select();document.execCommand("copy")}this.textContent="Скопировано";setTimeout(()=>this.textContent="Копировать",1600)});})();</script></body></html>`;
}
