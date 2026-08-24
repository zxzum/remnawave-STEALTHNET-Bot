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

// SSH-креды операции: пароль живёт только в памяти запроса (§4 ТЗ).
const sshSchema = z.object({
  user: z.string().min(1).max(64).default("root"),
  port: z.number().int().min(1).max(65535),
  password: z.string().min(1).max(200),
});
const setupSchema = z.object({
  nodeUuid: z.string().uuid(),
  squadUuid: z.string().uuid().nullable().optional(),
  speedMbit: z.number().int().min(1).max(1000).optional(),
  profileMode: z.enum(["IN_PLACE", "CLONE"]).default("IN_PLACE"),
  ssh: sshSchema,
});
const verifySchema = z.object({ ssh: sshSchema });

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
    ssh: runSsh, sshKnownHostsFile: () => process.env.LAZEIKA_ONLY_SSH_KNOWN_HOSTS ?? "",
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
      ssh: parsed.data.ssh,
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[lazeika-only] setup failed", { phase: message.slice(0, 120) });
    return res.status(502).json({ ok: false, error: message });
  }
});

lazeikaOnlyRouter.post("/verify", async (req: Request, res: Response) => {
  const parsed = verifySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    // Без credentials — одна содержательная проверка вместо каскада (§5 ТЗ).
    return res.json({
      ok: false,
      checks: [{ name: "state", ok: false, detail: "Укажите SSH user/port/password для проверки ноды" }],
    });
  }
  try {
    return res.json(await service().verify(parsed.data.ssh));
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error), checks: [] });
  }
});

lazeikaOnlyRouter.post("/reconcile", async (req: Request, res: Response) => {
  const config = await getSystemConfig();
  if (!config.lazeikaOnlyNodeUuid) {
    return res.status(400).json({ ok: false, error: "Нода не выбрана в настройках" });
  }
  const parsed = setupSchema.safeParse({
    nodeUuid: config.lazeikaOnlyNodeUuid,
    squadUuid: null,
    speedMbit: config.lazeikaOnlySpeedMbit,
    ...(req.body as Record<string, unknown>),
  });
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: "Требуются SSH user/port/password для операции",
      errors: parsed.error.flatten(),
    });
  }
  try {
    const result = await service().setup({
      nodeUuid: parsed.data.nodeUuid,
      // Всегда AUTO-режим: если сохранённый squad удалён, reconcile пересоздаст его,
      // а не упадёт со «squad не найден» на устаревшем UUID из настроек (§2 ревью).
      squadUuid: null,
      speedMbit: parsed.data.speedMbit ?? config.lazeikaOnlySpeedMbit ?? 5,
      ssh: parsed.data.ssh,
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

/**
 * Безопасный сброс resource_state для смены ноды/полной перепрошивки.
 * Разрешён ТОЛЬКО при выключенном режиме (иначе admin мог бы стереть состояние
 * под живым grace). Инфраструктуру в Remna не трогает.
 */
lazeikaOnlyRouter.post("/reset-state", async (_req: Request, res: Response) => {
  const [config, lazeika] = await Promise.all([getSystemConfig(), getLazeikaConfig()]);
  if (lazeika.enabled) {
    return res.status(409).json({ message: "Сначала выключите режим Lazeika-Only" });
  }
  const value = JSON.stringify({
    version: 1,
    status: "UNCONFIGURED",
    nodeUuid: null,
    profileUuid: null,
    baseProfileUuid: null,
    managedInboundUuid: null,
    managedInboundTag: null,
    managedInboundPort: null,
    squadUuid: null,
    squadSource: "AUTO",
    workingHostUuid: null,
    notificationHostUuids: [],
    previousNodeConfig: null,
    createdResourceUuids: [],
    ssh: { interface: null, rateMbit: lazeika.speedMbit },
    lastError: null,
    lastVerifiedAt: null,
    updatedAt: new Date().toISOString(),
  });
  await prisma.systemSetting.upsert({
    where: { key: "lazeika_only_resource_state" },
    create: { key: "lazeika_only_resource_state", value },
    update: { value },
  });
  for (const key of ["lazeika_only_profile_uuid", "lazeika_only_squad_uuid", "lazeika_only_node_uuid", "expired_grace_squad_uuid"]) {
    await prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: "" },
      update: { value: "" },
    });
  }
  invalidateSystemConfigCache();
  return res.json({ ok: true });
});
