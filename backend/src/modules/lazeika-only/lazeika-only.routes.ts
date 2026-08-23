/**
 * Lazeika-Only: админ-API инфраструктуры режима продления (спецификация §6).
 * Закрыт существующими requireAuth + requireAdminSection.
 */
import { Router, Request, Response } from "express";
import { z } from "zod";
import { requireAuth, requireAdminSection } from "../auth/middleware.js";
import { prisma } from "../../db.js";
import { getSystemConfig, invalidateSystemConfigCache } from "../client/client.service.js";
import { getLazeikaConfig, loadResourceState } from "./lazeika-only.config.js";
import { createLazeikaService } from "./lazeika-only.service.js";
import { remnaGetNodes, remnaGetConfigProfiles, remnaCreateConfigProfile, remnaUpdateConfigProfile, remnaDeleteConfigProfile, remnaUpdateNode, remnaGetInternalSquads, remnaCreateInternalSquad, remnaUpdateInternalSquad, remnaDeleteInternalSquad, remnaGetSquadAccessibleNodeUuids, remnaGetHosts, remnaCreateHost, remnaUpdateHost, remnaDeleteHost } from "../remna/remna.client.js";
import { runSsh } from "./ssh.executor.js";

export const lazeikaOnlyRouter = Router();
lazeikaOnlyRouter.use(requireAuth);
lazeikaOnlyRouter.use(requireAdminSection);

const setupSchema = z.object({
  nodeUuid: z.string().uuid(),
  squadUuid: z.string().uuid().nullable().optional(),
  speedMbit: z.number().int().min(1).max(1000).optional(),
});

function service() {
  return createLazeikaService({
    remna: {
      getNodes: remnaGetNodes,
      getConfigProfiles: remnaGetConfigProfiles,
      createConfigProfile: remnaCreateConfigProfile,
      updateConfigProfile: remnaUpdateConfigProfile,
      deleteConfigProfile: remnaDeleteConfigProfile,
      updateNode: (body) => remnaUpdateNode({
        uuid: body.uuid,
        ...(body.configProfile ? {
          configProfile: {
            activeConfigProfileUuid: body.configProfile.activeConfigProfileUuid ?? "",
            activeInbounds: body.configProfile.activeInbounds ?? [],
          },
        } : {}),
      }),
      getInternalSquads: remnaGetInternalSquads,
      createInternalSquad: remnaCreateInternalSquad,
      updateInternalSquad: remnaUpdateInternalSquad,
      deleteInternalSquad: remnaDeleteInternalSquad,
      getSquadAccessibleNodeUuids: remnaGetSquadAccessibleNodeUuids,
      getHosts: remnaGetHosts,
      createHost: remnaCreateHost,
      updateHost: remnaUpdateHost,
      deleteHost: remnaDeleteHost,
    },
    ssh: runSsh,
  });
}

lazeikaOnlyRouter.get("/status", async (_req: Request, res: Response) => {
  const [config, state] = await Promise.all([getLazeikaConfig(), loadResourceState()]);
  let hosts: Array<{ uuid?: string; remark?: string; address?: string; isDisabled?: boolean; tags?: string[] }> = [];
  try {
    const raw = (await remnaGetHosts()).data as { response?: { hosts?: typeof hosts } | typeof hosts } | undefined;
    const list = raw?.response;
    hosts = (Array.isArray(list) ? list : (list as { hosts?: typeof hosts })?.hosts) ?? [];
    hosts = hosts.filter((h) => h.tags?.includes("LAZEIKA_ONLY"));
  } catch {
    // Remna недоступен — статус всё равно отдаём.
  }
  return res.json({
    config: {
      enabled: config.enabled,
      days: config.days,
      speedMbit: config.speedMbit,
      nodeUuid: config.nodeUuid,
      squadUuid: config.squadUuid,
      messageTemplate: config.messageTemplate,
    },
    state,
    /** false → настройки (нода/squad) разошлись с resource_state, нужен reconcile. */
    settingsInSync: config.settingsInSync,
    workingHost: hosts.find((h) => !h.tags?.includes("LAZEIKA_ONLY_NOTIFICATION")) ?? null,
    notificationHosts: hosts.filter((h) => h.tags?.includes("LAZEIKA_ONLY_NOTIFICATION")),
  });
});

lazeikaOnlyRouter.post("/setup", async (req: Request, res: Response) => {
  const parsed = setupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
  }
  try {
    const result = await service().setup({
      nodeUuid: parsed.data.nodeUuid,
      squadUuid: parsed.data.squadUuid ?? null,
      speedMbit: parsed.data.speedMbit ?? (await getSystemConfig()).lazeikaOnlySpeedMbit ?? 5,
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[lazeika-only] setup failed", { phase: message.slice(0, 120) });
    return res.status(502).json({ ok: false, error: message });
  }
});

lazeikaOnlyRouter.post("/verify", async (_req: Request, res: Response) => {
  try {
    return res.json(await service().verify());
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error), checks: [] });
  }
});

lazeikaOnlyRouter.post("/reconcile", async (_req: Request, res: Response) => {
  const config = await getSystemConfig();
  if (!config.lazeikaOnlyNodeUuid) {
    return res.status(400).json({ ok: false, error: "Нода не выбрана в настройках" });
  }
  try {
    const result = await service().setup({
      nodeUuid: config.lazeikaOnlyNodeUuid,
      squadUuid: config.lazeikaOnlySquadUuid,
      speedMbit: config.lazeikaOnlySpeedMbit,
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(502).json({ ok: false, error: message });
  }
});

lazeikaOnlyRouter.post("/disable", async (_req: Request, res: Response) => {
  // Выключаем флаг через те же ключи, что читает cron (новый + legacy-алиас),
  // и сразу инвалидируем system-config cache — иначе до 30 секунд cron может
  // продолжать выдавать новые grace-доступы (§5 ревью).
  for (const key of ["lazeika_only_enabled", "expired_grace_enabled"]) {
    await prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: "false" },
      update: { value: "false" },
    });
  }
  const result = await service().disable();
  invalidateSystemConfigCache();
  return res.json({ ok: true, ...result });
});
