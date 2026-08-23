/**
 * Lazeika-Only: состояние ресурсов и конфигурация режима продления.
 * Спецификация: docs/superpowers/specs/2026-08-22-lazeika-only-design.md
 * Хранится в существующей SystemSetting (key-value), без новых таблиц.
 */
import { z } from "zod";
import { prisma } from "../../db.js";
import { DEFAULT_LAZEIKA_MESSAGE_TEMPLATE } from "../client/client.service.js";

export const LAZEIKA_STATE_KEY = "lazeika_only_resource_state";
export const LAZEIKA_PROFILE_KEY = "lazeika_only_profile_uuid";
export const LAZEIKA_SQUAD_NAME = "Lazeika-Only";
export const LAZEIKA_HOST_TAG = "LAZEIKA_ONLY";
export const LAZEIKA_NOTIFICATION_HOST_TAG = "LAZEIKA_ONLY_NOTIFICATION";

export type ResourceStatus = "UNCONFIGURED" | "APPLYING" | "READY" | "ERROR";

export const resourceStateSchema = z.object({
  version: z.literal(1).default(1),
  status: z.enum(["UNCONFIGURED", "APPLYING", "READY", "ERROR"]).default("UNCONFIGURED"),
  nodeUuid: z.string().uuid().nullable().default(null),
  profileUuid: z.string().uuid().nullable().default(null),
  baseProfileUuid: z.string().uuid().nullable().default(null),
  managedInboundUuid: z.string().uuid().nullable().default(null),
  managedInboundTag: z.string().nullable().default(null),
  managedInboundPort: z.number().int().min(1).max(65535).nullable().default(null),
  squadUuid: z.string().uuid().nullable().default(null),
  squadSource: z.enum(["AUTO", "MANUAL"]).default("AUTO"),
  workingHostUuid: z.string().uuid().nullable().default(null),
  notificationHostUuids: z.array(z.string().uuid()).default([]),
  previousNodeConfig: z
    .object({
      activeConfigProfileUuid: z.string().uuid().nullable(),
      activeInbounds: z.array(z.string()),
    })
    .nullable()
    .default(null),
  createdResourceUuids: z.array(z.string()).default([]),
  ssh: z
    .object({
      interface: z.string().nullable().default(null),
      rateMbit: z.number().int().min(1).max(1000).default(5),
    })
    .default({ interface: null, rateMbit: 5 }),
  lastError: z.string().nullable().default(null),
  lastVerifiedAt: z.string().datetime().nullable().default(null),
  updatedAt: z.string().datetime().nullable().default(null),
  /** Служебные поля CAS-блока setup (очищаются при терминальном статусе). */
  lockToken: z.string().nullable().default(null),
  lockedAt: z.string().datetime().nullable().default(null),
});

/** Минимальный интерфейс транзакции для атомарной записи состояния. */
export type LazeikaStateTx = { systemSetting: { upsert(args: unknown): Promise<unknown> } };
type StateTx = LazeikaStateTx;

export type LazeikaResourceState = z.infer<typeof resourceStateSchema>;

/** ponytail: дефолты через safeParse({}) — отдельная emptyResourceState() не нужна. */
export function parseResourceState(raw: string | null | undefined): LazeikaResourceState {
  if (!raw?.trim()) return resourceStateSchema.parse({});
  try {
    return resourceStateSchema.parse(JSON.parse(raw));
  } catch {
    // Битый JSON трактуем как «не настроено», а не роняем cron.
    return resourceStateSchema.parse({});
  }
}

export async function loadResourceState(): Promise<LazeikaResourceState> {
  const row = await prisma.systemSetting.findUnique({ where: { key: LAZEIKA_STATE_KEY } });
  return parseResourceState(row?.value);
}

export function serializeResourceState(state: LazeikaResourceState): string {
  return JSON.stringify({ ...state, updatedAt: new Date().toISOString() });
}

export async function saveResourceState(state: LazeikaResourceState, tx?: StateTx): Promise<void> {
  const value = serializeResourceState(state);
  const client = tx ?? prisma;
  // Полноценный upsert: без update существующая строка не обновлялась бы никогда (§1 финала).
  await client.systemSetting.upsert({
    where: { key: LAZEIKA_STATE_KEY },
    create: { key: LAZEIKA_STATE_KEY, value },
    update: { value },
  } as Parameters<typeof prisma.systemSetting.upsert>[0]);
}

/**
 * Атомарный compare-and-swap записи состояния: строка обновляется только если её
 * текущее значение равно expectedRaw. Основа fencing для setup-воркеров (§2 финала).
 */
export async function casUpdateResourceState(
  expectedRaw: string,
  nextState: LazeikaResourceState,
): Promise<{ ok: boolean; raw: string }> {
  const value = serializeResourceState(nextState);
  const updated = await prisma.systemSetting.updateMany({
    where: { key: LAZEIKA_STATE_KEY, value: expectedRaw },
    data: { value },
  });
  return { ok: updated.count > 0, raw: value };
}

export type LazeikaConfig = {
  enabled: boolean;
  days: number;
  speedMbit: number;
  nodeUuid: string | null;
  squadUuid: string | null;
  messageTemplate: string;
  /** Инфраструктура полностью настроена И совпадает с активными настройками. */
  ready: boolean;
  /** Настройки (нода/squad) разошлись с resource_state → нужен reconcile. */
  settingsInSync: boolean;
};

type SystemConfigLike = {
  lazeikaOnlyEnabled?: boolean;
  lazeikaOnlyDays?: number;
  lazeikaOnlySpeedMbit?: number;
  lazeikaOnlyNodeUuid?: string | null;
  lazeikaOnlySquadUuid?: string | null;
  lazeikaOnlyMessageTemplate?: string | null;
};

/** Полная конфигурация режима: настройки + готовность инфраструктуры. */
export async function getLazeikaConfig(
  systemConfig?: SystemConfigLike,
): Promise<LazeikaConfig> {
  const cfg =
    systemConfig ??
    ((await import("../client/client.service.js").then((m) => m.getSystemConfig())) as SystemConfigLike);
  const state = await loadResourceState();
  // Ключ настроек может отстать от resource_state (авто-создание squad в setup) — берём сохранённый.
  const effectiveSquadUuid = (cfg.lazeikaOnlySquadUuid ?? "").trim() || state.squadUuid || null;
  // Строгая синхронизация: нода в настройках обязана быть непустой и совпадать с resource_state
  // (пустая ≠ «синхронно» — иначе reconcile потом откажется работать, §4 ревью).
  const settingsInSync =
    Boolean(cfg.lazeikaOnlyNodeUuid)
    && cfg.lazeikaOnlyNodeUuid === state.nodeUuid
    && (!cfg.lazeikaOnlySquadUuid || cfg.lazeikaOnlySquadUuid === state.squadUuid);
  const ready =
    state.status === "READY"
    && Boolean(state.squadUuid)
    && Boolean(state.profileUuid)
    && Boolean(state.managedInboundUuid)
    // Админ переключил squad/ноду в настройках, но не прогнал reconcile →
    // выдавать grace в непроверенный squad нельзя.
    && settingsInSync;
  return {
    enabled: cfg.lazeikaOnlyEnabled === true,
    days: Math.min(365, Math.max(1, Math.trunc(cfg.lazeikaOnlyDays ?? 7))),
    speedMbit: Math.min(1000, Math.max(1, Math.trunc(cfg.lazeikaOnlySpeedMbit ?? 5))),
    nodeUuid: cfg.lazeikaOnlyNodeUuid ?? null,
    squadUuid: effectiveSquadUuid,
    messageTemplate: cfg.lazeikaOnlyMessageTemplate || DEFAULT_LAZEIKA_MESSAGE_TEMPLATE,
    ready,
    settingsInSync,
  };
}

/** {count} → оставшиеся дни (округление вверх, минимум 1 до окончания grace). */
export function renderGraceMessage(template: string, daysLeft: number): string {
  return template.replaceAll("{count}", String(Math.max(1, daysLeft)));
}

/**
 * Валидация шаблона (§5.3): не пустой, ≤1000 символов,
 * единственный разрешённый placeholder — {count}, неизвестные запрещены.
 */
export function validateMessageTemplate(text: string): boolean {
  if (!text.trim() || text.length > 1000) return false;
  return !text.replace(/\{count\}/g, "").match(/\{[^{}]*\}/);
}
