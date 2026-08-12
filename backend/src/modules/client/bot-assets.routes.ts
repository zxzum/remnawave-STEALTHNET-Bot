/**
 * Публичные image-ассеты для rich-сообщений бота (Telegram Bot API 10.1).
 *
 * Telegram rich `![](url)` требует ПУБЛИЧНЫЙ URL, отдающий реальные байты картинки
 * (file_id и data-URL прямо в markdown НЕ работают — RICH_MESSAGE_PHOTO_URL_INVALID /
 * RICH_MESSAGE_PHOTO_NO_MEDIA_FOUND). Логотип в настройках хранится как data-URL
 * base64 → этот роутер декодит его и отдаёт как image/*, чтобы Telegram мог зафетчить.
 *
 * Монтируется на /api/public (см. app.ts) → итоговый URL:
 *   https://<DOMAIN>/api/public/bot-asset/logo.png
 */
import { Router, type Response } from "express";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { prisma } from "../../db.js";
import { getSystemConfig } from "./client.service.js";

export const botAssetsRouter = Router();

type PublicBrandAssetKey = "logo" | "favicon";

const ASSET_CONFIG_KEYS: Record<PublicBrandAssetKey, "logo" | "favicon"> = {
  logo: "logo",
  favicon: "favicon",
};

/**
 * Converts database-backed image values to small, cache-busting public URLs.
 * External URLs are already efficient and are preserved as-is.
 */
export function configuredAssetUrl(
  value: string | null | undefined,
  key: PublicBrandAssetKey,
  origin = "",
): string | null {
  const normalized = (value ?? "").trim();
  if (!normalized) return null;
  if (/^https?:\/\//i.test(normalized)) return normalized;
  const version = createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  return `${origin}/api/public/brand-asset/${key}?v=${version}`;
}

async function imagePayload(value: string): Promise<{ contentType: string; body: Buffer } | null> {
  const normalized = value.trim();
  const dataUrl = /^data:image\/([a-z0-9.+-]+);base64,(.+)$/i.exec(normalized);
  if (dataUrl) {
    const subtype = (dataUrl[1] || "png").toLowerCase();
    const body = Buffer.from(dataUrl[2]!, "base64");
    if (!body.length) return null;
    return { contentType: `image/${subtype === "jpg" ? "jpeg" : subtype}`, body };
  }

  if (/^https?:\/\//i.test(normalized)) {
    const upstream = await fetch(normalized);
    if (!upstream.ok) return null;
    return {
      contentType: upstream.headers.get("content-type") || "image/png",
      body: Buffer.from(await upstream.arrayBuffer()),
    };
  }

  try {
    const body = Buffer.from(normalized, "base64");
    return body.length ? { contentType: "image/png", body } : null;
  } catch {
    return null;
  }
}

async function sendImageValue(value: string, res: Response, cacheControl = "public, max-age=300") {
  const payload = await imagePayload(value);
  if (!payload) return res.status(404).send("unsupported or empty image");
  res.set("Content-Type", payload.contentType);
  res.set("Cache-Control", cacheControl);
  return res.send(payload.body);
}

botAssetsRouter.get("/brand-asset/:key", async (req, res) => {
  try {
    const key = req.params.key as PublicBrandAssetKey;
    const configKey = ASSET_CONFIG_KEYS[key];
    if (!configKey) return res.status(404).send("unknown asset");
    const config = await getSystemConfig();
    const value = String(config[configKey] ?? "").trim();
    if (!value) return res.status(404).send("asset not configured");
    return sendImageValue(value, res, "public, max-age=31536000, immutable");
  } catch (e) {
    console.error("[brand-asset] error:", e instanceof Error ? e.message : e);
    return res.status(500).send("error");
  }
});

botAssetsRouter.get("/bot-asset/logo.png", async (_req, res) => {
  try {
    // logoBot = «Логотип бота» из админки (БД: logo_bot). Приоритет ему,
    // botWelcomeImage (приветственный баннер) — fallback.
    const config = (await getSystemConfig()) as { logoBot?: string | null; botWelcomeImage?: string | null };
    const logo = (config.logoBot || config.botWelcomeImage || "").trim();
    if (!logo) return res.status(404).send("no logo configured");

    return sendImageValue(logo, res);
  } catch (e) {
    console.error("[bot-asset/logo] error:", e instanceof Error ? e.message : e);
    return res.status(500).send("error");
  }
});

const ONBOARDING_ASSETS = new Set([
  "select-your-device.png",
  "happ-how-to-update.png",
  "incy-how-to-update.png",
  "welcome.png",
  "about-us.png",
  "my-devices.png",
  "my-subscription.png",
  "oplata.png",
  "referals.png",
  "tariffs.png",
]);

const SCREEN_BANNERS: Record<string, { setting: string; fallback: string }> = {
  welcome: { setting: "bot_banner_welcome", fallback: "welcome.png" },
  setup: { setting: "bot_banner_setup", fallback: "my-subscription.png" },
  main: { setting: "bot_banner_main", fallback: "welcome.png" },
  subscription: { setting: "bot_banner_subscription", fallback: "my-subscription.png" },
  devices: { setting: "bot_banner_devices", fallback: "my-devices.png" },
  tariffs: { setting: "bot_banner_tariffs", fallback: "tariffs.png" },
  payment: { setting: "bot_banner_payment", fallback: "oplata.png" },
  referral: { setting: "bot_banner_referral", fallback: "referals.png" },
  about: { setting: "bot_banner_about", fallback: "about-us.png" },
};

botAssetsRouter.get("/bot-asset/screen/:screen.png", async (req, res) => {
  const screen = SCREEN_BANNERS[req.params.screen];
  if (!screen) return res.status(404).send("unknown screen");
  try {
    const stored = await prisma.systemSetting.findUnique({ where: { key: screen.setting } });
    const value = stored?.value?.trim();
    if (value) return sendImageValue(value, res, "public, max-age=300");
    const body = await readFile(new URL(`../../assets/guides/${screen.fallback}`, import.meta.url));
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=300");
    return res.send(body);
  } catch {
    return res.status(404).send("asset not found");
  }
});

botAssetsRouter.get("/bot-asset/onboarding/:name", async (req, res) => {
  const name = req.params.name;
  if (!ONBOARDING_ASSETS.has(name)) return res.status(404).send("unknown asset");
  try {
    const body = await readFile(new URL(`../../assets/guides/${name}`, import.meta.url));
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    return res.send(body);
  } catch {
    return res.status(404).send("asset not found");
  }
});
