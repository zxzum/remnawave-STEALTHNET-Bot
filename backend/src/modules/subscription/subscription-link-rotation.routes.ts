import rateLimit from "express-rate-limit";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { isRemnaConfigured } from "../remna/remna.client.js";
import { requireClientAuth } from "../client/client.middleware.js";
import {
  reissueSubscriptionLink,
  type SubscriptionLinkRotationType,
} from "./subscription-link-rotation.service.js";

const REISSUE_WINDOW_MS = 60 * 60 * 1000;
const confirmationSchema = z.object({ confirmed: z.literal(true) }).strict();

function asyncRoute(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: (error?: unknown) => void) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

function getRequestIp(req: Request): string | null {
  const ip = req.ip || req.socket?.remoteAddress || null;
  return ip?.startsWith("::ffff:") ? ip.slice(7) : ip;
}

const reissueIpLimiter = rateLimit({
  windowMs: REISSUE_WINDOW_MS,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const resetTime = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
    res.status(429).json({
      message: "Too many subscription link reissue attempts",
      retryAt: (resetTime ?? new Date(Date.now() + REISSUE_WINDOW_MS)).toISOString(),
    });
  },
});

export const subscriptionLinkRotationRouter = Router();

subscriptionLinkRotationRouter.post(
  "/subscription/:type/:id/reissue",
  reissueIpLimiter,
  requireClientAuth,
  asyncRoute(async (req, res) => {
    const body = confirmationSchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ message: "confirmed: true is required" });
    }
    if (!isRemnaConfigured()) {
      return res.status(503).json({ message: "Remnawave is not configured" });
    }

    const accountId = (req as Request & { clientId: string }).clientId;
    const result = await reissueSubscriptionLink({
      accountId,
      type: req.params.type as SubscriptionLinkRotationType,
      id: req.params.id,
      confirmed: body.data.confirmed,
      ip: getRequestIp(req),
    });

    if (!result.ok) {
      return res.status(result.status).json({
        message: result.message,
        ...(result.retryAt ? { retryAt: result.retryAt.toISOString() } : {}),
      });
    }

    return res.json({
      ok: true,
      degraded: false,
      subscriptionUrl: result.subscriptionUrl,
    });
  }),
);
