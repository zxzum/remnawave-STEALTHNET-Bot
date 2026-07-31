import express, { Router } from "express";
import { z } from "zod";

import { prisma } from "../../db.js";
import { logAdmin } from "../audit/audit.service.js";
import { requireAdminSection, requireAuth } from "../auth/middleware.js";
import {
  grantTrafficBytes,
  resumeTrafficQuota,
  revokeTrafficGrant,
  suspendTrafficQuota,
} from "./traffic-entitlement.service.js";

function asyncRoute(fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

const grantSchema = z.object({
  bytes: z.string().regex(/^[1-9]\d*$/),
  scope: z.enum(["CURRENT_PERIOD", "WHILE_TARIFF_ACTIVE"]),
});

function quotaToJson(quota: {
  id: string;
  subscriptionId: string;
  tariffIdAtPeriodStart: string | null;
  meteredSquadUuid: string;
  baseLimitBytes: bigint;
  usedBytes: bigint;
  status: string;
  periodStartedAt: Date;
  periodEndsAt: Date;
}) {
  return {
    id: quota.id,
    subscriptionId: quota.subscriptionId,
    tariffIdAtPeriodStart: quota.tariffIdAtPeriodStart,
    meteredSquadUuid: quota.meteredSquadUuid,
    baseLimitBytes: quota.baseLimitBytes.toString(),
    usedBytes: quota.usedBytes.toString(),
    status: quota.status,
    periodStartedAt: quota.periodStartedAt.toISOString(),
    periodEndsAt: quota.periodEndsAt.toISOString(),
  };
}

function isMissingQuotaResource(error: unknown): error is Error {
  return error instanceof Error && [
    "Локальная квота подписки не найдена",
    "Начисление трафика не найдено",
  ].includes(error.message);
}

export const trafficQuotaAdminRouter = Router();
trafficQuotaAdminRouter.use(requireAuth);
trafficQuotaAdminRouter.use(requireAdminSection);

trafficQuotaAdminRouter.get("/subscriptions/:id/traffic-quota", asyncRoute(async (req, res) => {
  const subscription = await prisma.subscription.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!subscription) return res.status(404).json({ message: "Подписка не найдена" });

  const quota = await prisma.squadTrafficQuota.findUnique({ where: { subscriptionId: subscription.id } });
  if (!quota) return res.status(404).json({ message: "Локальная квота подписки не найдена" });
  const [grants, events] = await Promise.all([
    prisma.trafficQuotaGrant.findMany({ where: { quotaId: quota.id, status: "ACTIVE" }, orderBy: { createdAt: "desc" } }),
    prisma.trafficQuotaEvent.findMany({ where: { quotaId: quota.id }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  return res.json({
    quota: quotaToJson(quota),
    activeGrants: grants.map((grant) => ({
      id: grant.id,
      bytes: grant.bytes.toString(),
      scope: grant.scope,
      createdAt: grant.createdAt.toISOString(),
    })),
    events: events.map((event) => ({
      id: event.id,
      kind: event.kind,
      deltaBytes: event.deltaBytes?.toString() ?? null,
      usedBytes: event.usedBytes.toString(),
      limitBytes: event.limitBytes.toString(),
      detail: event.detail,
      createdAt: event.createdAt.toISOString(),
    })),
  });
}));

async function requireSubscription(id: string) {
  return prisma.subscription.findUnique({ where: { id }, select: { id: true } });
}

trafficQuotaAdminRouter.post("/subscriptions/:id/traffic-grants", asyncRoute(async (req, res) => {
  const parsed = grantSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });
  const subscriptionId = req.params.id;
  if (!await requireSubscription(subscriptionId)) return res.status(404).json({ message: "Подписка не найдена" });
  const adminId = (req as express.Request & { adminId: string }).adminId;
  let grant;
  try {
    grant = await grantTrafficBytes(subscriptionId, BigInt(parsed.data.bytes), parsed.data.scope, adminId);
  } catch (error) {
    if (isMissingQuotaResource(error)) return res.status(404).json({ message: error.message });
    throw error;
  }
  await logAdmin(req, "traffic_quota.grant", { type: "subscription", id: subscriptionId }, { grantId: grant.id, bytes: parsed.data.bytes, scope: parsed.data.scope });
  return res.status(201).json({ id: grant.id });
}));

trafficQuotaAdminRouter.post("/traffic-grants/:id/revoke", asyncRoute(async (req, res) => {
  const adminId = (req as express.Request & { adminId: string }).adminId;
  let grant;
  try {
    grant = await revokeTrafficGrant(req.params.id, adminId);
  } catch (error) {
    if (isMissingQuotaResource(error)) return res.status(404).json({ message: error.message });
    throw error;
  }
  await logAdmin(req, "traffic_quota.revoke", { type: "traffic_quota_grant", id: grant.id }, { quotaId: grant.quotaId });
  return res.json({ id: grant.id, status: grant.status });
}));

for (const [action, changeStatus, kind] of [
  ["suspend", suspendTrafficQuota, "traffic_quota.suspend"],
  ["resume", resumeTrafficQuota, "traffic_quota.resume"],
] as const) {
  trafficQuotaAdminRouter.post(`/subscriptions/:id/traffic-quota/${action}`, asyncRoute(async (req, res) => {
    const subscriptionId = req.params.id;
    if (!await requireSubscription(subscriptionId)) return res.status(404).json({ message: "Подписка не найдена" });
    const adminId = (req as express.Request & { adminId: string }).adminId;
    let quota;
    try {
      quota = await changeStatus(subscriptionId, adminId);
    } catch (error) {
      if (isMissingQuotaResource(error)) return res.status(404).json({ message: error.message });
      throw error;
    }
    await logAdmin(req, kind, { type: "subscription", id: subscriptionId }, { quotaId: quota.id });
    return res.json({ quota: quotaToJson(quota) });
  }));
}
