import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";

import { prisma } from "../../db.js";
import { extractRemnaUuid, remnaGetUserByShortUuid } from "../remna/remna.client.js";
import { toPublicWhitelistQuota } from "./public-whitelist-quota.service.js";

const ORIGIN = "https://sub.lazeika.xyz";
const WINDOW_MS = 60_000;

type Quota = Parameters<typeof toPublicWhitelistQuota>[0];
type Dependencies = {
  maxRequests?: number;
  getRemnaUser: (token: string) => Promise<{ data?: unknown; status: number }>;
  findSubscription: (uuid: string) => Promise<{ id: string } | null>;
  findQuota: (subscriptionId: string) => Promise<Quota | null>;
};

type Window = { startedAt: number; count: number };

function limited(windows: Map<string, Window>, key: string, max: number) {
  const now = Date.now();
  const current = windows.get(key);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    windows.set(key, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > max;
}

function setHeaders(req: Request, res: Response) {
  res.setHeader("X-Request-Id", randomUUID());
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Vary", "Origin, Authorization");
  const origin = req.get("Origin");
  if (origin === ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", ORIGIN);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  }
  return origin;
}

function bearer(req: Request) {
  const value = req.get("Authorization");
  const match = value ? /^Bearer ([A-Za-z0-9_-]{1,128})$/.exec(value) : null;
  return match?.[1] ?? null;
}

function contentIsValid(req: Request) {
  const contentType = req.get("Content-Type");
  if (contentType && !/^application\/json(?:;|$)/i.test(contentType)) return false;
  return Number(req.get("Content-Length") || 0) === 0;
}

async function within<T>(promise: Promise<T>, milliseconds: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), milliseconds); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const defaults: Dependencies = {
  getRemnaUser: (token) => remnaGetUserByShortUuid(token, 5_000),
  findSubscription: (uuid) => prisma.subscription.findFirst({ where: { remnawaveUuid: uuid }, select: { id: true } }),
  findQuota: (subscriptionId) => prisma.squadTrafficQuota.findUnique({
    where: { subscriptionId },
    include: { grants: true },
  }),
};

export function createPublicWhitelistQuotaRouter(overrides: Partial<Dependencies> = {}) {
  const dependencies = { ...defaults, ...overrides };
  const max = dependencies.maxRequests ?? 60;
  const ipWindows = new Map<string, Window>();
  const subjectWindows = new Map<string, Window>();
  const router = Router();

  router.use((req, res, next) => {
    const origin = setHeaders(req, res);
    if (origin && origin !== ORIGIN) return res.status(403).json({ message: "Forbidden" });
    return next();
  });

  router.options("/quota", (req, res) => {
    if (req.get("Access-Control-Request-Method") !== "POST") return res.status(400).json({ message: "Bad request" });
    return res.sendStatus(204);
  });

  router.post("/quota", async (req, res) => {
    if (!contentIsValid(req)) return res.status(req.get("Content-Type") ? 415 : 400).json({ message: "Bad request" });
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    if (limited(ipWindows, ip, max)) return res.setHeader("Retry-After", "60").status(429).json({ message: "Too many requests" });

    const token = bearer(req);
    if (!token) return res.status(401).json({ message: "Unauthorized" });

    let verified: Awaited<ReturnType<Dependencies["getRemnaUser"]>> | undefined;
    try {
      verified = await within(dependencies.getRemnaUser(token), 5_000);
    } catch {
      return res.status(200).json({ status: "unavailable" });
    }
    const uuid = verified?.data ? extractRemnaUuid(verified.data) : null;
    if (verified === undefined || verified.status >= 500) return res.status(200).json({ status: "unavailable" });
    if (!uuid) return res.status(401).json({ message: "Unauthorized" });

    const subscription = await dependencies.findSubscription(uuid);
    if (!subscription) return res.status(200).json({ status: "not_found" });
    if (limited(subjectWindows, subscription.id, max)) return res.setHeader("Retry-After", "60").status(429).json({ message: "Too many requests" });

    const quota = await dependencies.findQuota(subscription.id);
    if (!quota) return res.status(200).json({ status: "not_found" });
    return res.status(200).json(toPublicWhitelistQuota(quota));
  });

  return router;
}

export const publicWhitelistQuotaRouter = createPublicWhitelistQuotaRouter();
