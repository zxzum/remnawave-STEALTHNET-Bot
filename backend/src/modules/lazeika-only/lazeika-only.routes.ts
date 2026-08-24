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

export const lazeikaOnlyRouter = Router();
lazeikaOnlyRouter.use(requireAuth);
lazeikaOnlyRouter.use(requireAdminSection);

/** Экспортировано для route-level тестов валидации входных параметров. */
export const lazeikaSetupSchema = z.object({
  nodeUuid: z.string().uuid(),
  squadUuid: z.string().uuid().nullable().optional(),
  speedMbit: z.number().int().min(1).max(1000).optional(),
  profileMode: z.enum(["IN_PLACE", "CLONE"]).default("IN_PLACE"),
});
/** SSH для операций с Remnawave не нужен. */
export const lazeikaVerifySchema = z.object({});

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
    // tc запускается вручную на выбранной VPS; backend не подключается к ней.
  });
}

lazeikaOnlyRouter.get("/status", async (_req: Request, res: Response) => {
  res.set("Cache-Control", "no-store");
  const [config, state] = await Promise.all([getLazeikaConfig(), loadResourceState()]);
  let hosts: Array<{ uuid?: string; remark?: string; address?: string; isDisabled?: boolean; tags?: string[] }> = [];
  let nodes: Array<{ uuid: string; name?: string; isDisabled?: boolean }> = [];
  try {
    const raw = (await remnaGetHosts()).data as { response?: { hosts?: typeof hosts } | typeof hosts } | undefined;
    const list = raw?.response;
    hosts = (Array.isArray(list) ? list : (list as { hosts?: typeof hosts })?.hosts) ?? [];
    hosts = hosts.filter((h) => h.tags?.includes("LAZEIKA_ONLY"));
  } catch {
    // Remna недоступен — статус всё равно отдаём.
  }
  try {
    const raw = (await remnaGetNodes()).data as { response?: unknown } | undefined;
    const list = Array.isArray(raw?.response) ? raw.response : [];
    nodes = list
      .filter((node): node is { uuid: string; name?: string; isDisabled?: boolean } =>
        typeof node === "object" && node !== null && typeof (node as { uuid?: unknown }).uuid === "string",
      )
      .map((node) => ({ uuid: node.uuid, name: node.name, isDisabled: node.isDisabled }));
  } catch {
    // Ноды необязательны для чтения статуса; UI покажет пустой список без падения карточки.
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
    nodes,
    // Показываем только ПРИНАДЛЕЖАЩИЕ конфигурации host'ы по сохранённым UUID,
    // не «все с тегом» — чужие host'ы с тем же тегом не наши (§8 ревью).
    workingHost: hosts.find((h) => h.uuid !== undefined && h.uuid === state.workingHostUuid) ?? null,
    notificationHosts: hosts.filter((h) => h.uuid !== undefined && state.notificationHostUuids.includes(h.uuid)),
  });
});

lazeikaOnlyRouter.post("/setup", async (req: Request, res: Response) => {
  const parsed = lazeikaSetupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
  }
  try {
    const result = await service().setup({
      nodeUuid: parsed.data.nodeUuid,
      squadUuid: parsed.data.squadUuid ?? null,
      speedMbit: parsed.data.speedMbit ?? (await getSystemConfig()).lazeikaOnlySpeedMbit ?? 5,
      profileMode: parsed.data.profileMode,
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[lazeika-only] setup failed", { phase: message.slice(0, 120) });
    return res.status(502).json({ ok: false, error: message });
  }
});

lazeikaOnlyRouter.post("/verify", async (req: Request, res: Response) => {
  const parsed = lazeikaVerifySchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ ok: false, checks: [] });
  try {
    return res.json(await service().verify());
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error), checks: [] });
  }
});

lazeikaOnlyRouter.post("/reconcile", async (req: Request, res: Response) => {
  const config = await getSystemConfig();
  if (!config.lazeikaOnlyNodeUuid) {
    return res.status(400).json({ ok: false, error: "Нода не выбрана в настройках" });
  }
  const parsed = lazeikaVerifySchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Invalid input" });
  try {
    const result = await service().setup({
      nodeUuid: config.lazeikaOnlyNodeUuid,
      // Всегда AUTO-режим: если сохранённый squad удалён, reconcile пересоздаст его,
      // а не упадёт со «squad не найден» на устаревшем UUID из настроек (§2 ревью).
      squadUuid: null,
      speedMbit: config.lazeikaOnlySpeedMbit ?? 5,
      profileMode: (await loadResourceState()).profileMode,
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(502).json({ ok: false, error: message });
  }
});

lazeikaOnlyRouter.post("/disable", async (_req: Request, res: Response) => {
  // Порядок (§10 ревью): сервис атомарно (одна транзакция) проверяет lock, пишет CAS state
  // и флаги enabled=false (новый + legacy-алиас). При активном setup — 409 без частичных
  // изменений. Cache инвалидируем только после успешной операции.
  try {
    const result = await service().disable();
    invalidateSystemConfigCache();
    return res.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Активный APPLYING-лок не трогаем: отключение во время setup — 409.
    const applying = message.includes("выполняется") || message.includes("LOCK_LOST");
    return res.status(applying ? 409 : 502).json({ ok: false, error: message });
  }
});

/**
 * Безопасный сброс resource_state для смены ноды/полной перепрошивки.
 * Разрешён ТОЛЬКО при выключенном режиме (иначе admin мог бы стереть состояние
 * под живым grace). Инфраструктуру в Remna не трогает.
 */
lazeikaOnlyRouter.post("/reset-state", async (_req: Request, res: Response) => {
  const lazeika = await getLazeikaConfig();
  if (lazeika.enabled) {
    return res.status(409).json({ message: "Сначала выключите режим Lazeika-Only" });
  }
  try {
    await service().resetState();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const applying = message.includes("выполняется") || message.includes("LOCK_LOST");
    return res.status(applying ? 409 : 502).json({ ok: false, error: message });
  }
  // Производные ключи очищены в той же транзакции, что и CAS state (service.resetState).
  invalidateSystemConfigCache();
  return res.json({ ok: true });
});
