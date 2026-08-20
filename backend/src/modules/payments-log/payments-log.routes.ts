/**
 * Админ-API журнала платежей (payments log).
 *
 * GET  /api/admin/payments-log              — объединённый список платежей + external-транзакций
 * GET  /api/admin/payments-log/:id?kind=    — деталь одной записи (payment|external)
 * POST /api/admin/payments-log/sync/platega — sync транзакций из Platega export API
 */

import express, { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdminSection } from "../auth/middleware.js";
import { listPaymentsLog, getPaymentsLogEntry } from "./payments-log.service.js";
import { getProviderSyncAdapter } from "./providers/platega-sync.js";
import { logAdmin } from "../audit/audit.service.js";

function asyncRoute(fn: (req: express.Request, res: express.Response) => Promise<void | express.Response>) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

export const paymentsLogAdminRouter = Router();
paymentsLogAdminRouter.use(requireAuth);
paymentsLogAdminRouter.use(requireAdminSection);

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).optional(),
  provider: z.string().max(20).optional(),
  status: z.string().max(20).optional(),
  source: z.enum(["site", "miniapp", "bot"]).optional(),
  method: z.string().max(30).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

paymentsLogAdminRouter.get(
  "/",
  asyncRoute(async (req, res) => {
    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: "Invalid query", errors: parsed.error.flatten() });
    const q = parsed.data;
    const result = await listPaymentsLog({
      page: q.page,
      limit: q.limit,
      search: q.search?.trim() || undefined,
      provider: q.provider,
      status: q.status && q.status !== "all" ? q.status : undefined,
      source: q.source,
      method: q.method,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
    });
    return res.json(result);
  }),
);

paymentsLogAdminRouter.get(
  "/:id",
  asyncRoute(async (req, res) => {
    const kind = req.query.kind === "external" ? "external" : "payment";
    const entry = await getPaymentsLogEntry(req.params.id, kind);
    if (!entry) return res.status(404).json({ message: "Payment not found" });
    return res.json(entry);
  }),
);

paymentsLogAdminRouter.post(
  "/sync/platega",
  asyncRoute(async (req, res) => {
    const adapter = getProviderSyncAdapter("platega");
    if (!adapter) return res.status(400).json({ message: "Sync для провайдера не поддерживается" });
    try {
      const result = await adapter.sync();
      await logAdmin(req, "payments-log.sync", { type: "provider", id: "platega" }, result);
      return res.json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return res.status(502).json({ message });
    }
  }),
);
