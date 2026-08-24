/**
 * Lazeika-Only: идемпотентный setup/reconcile/verify инфраструктуры режима продления.
 * Спецификация §7. Внешние зависимости инжектятся (remna, ssh, state) — тестируется на fake.
 */
import { randomUUID } from "node:crypto";
import {
  LAZEIKA_HOST_TAG,
  LAZEIKA_NOTIFICATION_HOST_TAG,
  LAZEIKA_PROFILE_KEY,
  LAZEIKA_SQUAD_NAME,
  LAZEIKA_STATE_KEY,
  loadResourceState,
  parseResourceState,
  resourceStateSchema,
  serializeResourceState,
  casUpdateResourceState,
  type LazeikaStateTx,
  saveResourceState,
  type LazeikaResourceState,
} from "./lazeika-only.config.js";
import { applyLazeikaToConfig, buildManagedInbound, managedInboundTag, pickManagedPort, type XrayConfig } from "./xray-rules.js";
import { buildTcScript, buildTcUnit, expectedFilterSpecs, ownedPrefs, TC_POLICE_INDEX_EGRESS, TC_POLICE_INDEX_INGRESS, TC_PREF_BASE, TC_PREF_COUNT, TC_SCRIPT_PATH, TC_UNIT_NAME, validatePort, validateSpeed } from "./tc-script.js";
import { runSsh, type SshCredentials, type SshResult } from "./ssh.executor.js";

export type RemnaResult = { data?: unknown; error?: string; status: number };

export type LazeikaRemnaDeps = {
  getNodes: () => Promise<RemnaResult>;
  getConfigProfiles: () => Promise<RemnaResult>;
  createConfigProfile: (body: { name: string; config: unknown }) => Promise<RemnaResult>;
  updateConfigProfile: (body: { uuid: string; name?: string; config?: unknown }) => Promise<RemnaResult>;
  deleteConfigProfile: (uuid: string) => Promise<RemnaResult>;
  updateNode: (body: { uuid: string; configProfile?: { activeConfigProfileUuid?: string | null; activeInbounds?: string[] } }) => Promise<RemnaResult>;
  getInternalSquads: () => Promise<RemnaResult>;
  createInternalSquad: (body: { name: string; inbounds: string[] }) => Promise<RemnaResult>;
  updateInternalSquad: (body: { uuid: string; inbounds?: string[] }) => Promise<RemnaResult>;
  deleteInternalSquad: (uuid: string) => Promise<RemnaResult>;
  getSquadAccessibleNodeUuids: (uuid: string) => Promise<{ data?: string[]; error?: string }>;
  getHosts: () => Promise<RemnaResult>;
  createHost: (body: Record<string, unknown>) => Promise<RemnaResult>;
  updateHost: (body: { uuid: string } & Record<string, unknown>) => Promise<RemnaResult>;
  deleteHost: (uuid: string) => Promise<RemnaResult>;
};

export class SetupError extends Error {
  constructor(message: string, public phase: string) {
    super(message);
  }
}

/** Отдельный профиль уведомлений: один dummy-inbound + BLOCK catch-all на его тег. */
function buildNotificationConfig(notifTag: string, port: number): XrayConfig {
  return {
    log: { loglevel: "warning" },
    inbounds: [
      {
        tag: notifTag,
        port,
        protocol: "vless",
        settings: { clients: [], decryption: "none" },
        streamSettings: { network: "tcp", security: "none" },
        sniffing: { enabled: true, destOverride: ["http", "tls", "quic"] },
      },
    ],
    outbounds: [
      { protocol: "freedom", tag: "DIRECT" },
      { protocol: "blackhole", tag: "BLOCK" },
    ],
    // Весь трафик этого inbound блокируется — host остаются только строками подписки.
    routing: { rules: [{ inboundTag: [notifTag], network: "tcp,udp", outboundTag: "BLOCK" }] },
  };
}

function unwrap(data: unknown): unknown {
  const d = data as { response?: unknown } | undefined;
  return d?.response !== undefined ? d.response : data;
}

/** upsert UUID в SystemSetting (без секретов, только идентификаторы). */
function defaultPersistUuid(key: string) {
  return async (uuid: string | null, tx?: { systemSetting: { upsert(args: unknown): Promise<unknown> } }): Promise<void> => {
    const mod = await import("../../db.js");
    const client = tx ?? mod.prisma;
    await client.systemSetting.upsert({
      where: { key },
      create: { key, value: uuid ?? "" },
      update: { value: uuid ?? "" },
    } as Parameters<typeof mod.prisma.systemSetting.upsert>[0]);
  };
}
async function requireOk(res: RemnaResult, phase: string): Promise<unknown> {
  const e = res.error ?? (res.status >= 400 ? `Remnawave request failed (${res.status})` : null);
  if (e) throw new SetupError(e, phase);
  return res.data;
}

type RemnaNodeConfigProfile = {
  activeConfigProfileUuid?: string | null;
  activeInbounds?: Array<string | { uuid: string }>;
};
type RemnaNodeShape = {
  uuid: string;
  name?: string;
  address?: string;
  isDisabled?: boolean;
  /** Контракт Remnawave: профиль и активные инбаунды вложены в configProfile. */
  configProfile?: RemnaNodeConfigProfile | null;
};

function nodeActiveProfileUuid(node: RemnaNodeShape): string | null {
  return node.configProfile?.activeConfigProfileUuid ?? null;
}
/** activeInbounds приходят строками UUID либо объектами {uuid} — нормализуем. */
function nodeActiveInboundUuids(node: RemnaNodeShape): string[] {
  return (node.configProfile?.activeInbounds ?? [])
    .map((ib) => (typeof ib === "string" ? ib : ib?.uuid))
    .filter((u): u is string => Boolean(u));
}
function nodeConfigProfilePatch(uuid: string | null | undefined, inboundUuids: string[]) {
  return {
    configProfile: {
      ...(uuid ? { activeConfigProfileUuid: uuid } : {}),
      activeInbounds: inboundUuids,
    },
  };
}
type ProfileInbound = { uuid?: string; tag?: string; port?: number };
type ProfileShape = { uuid?: string; name?: string; config?: XrayConfig; inbounds?: ProfileInbound[] };
type SquadShape = { uuid?: string; name?: string; inbounds?: Array<{ uuid?: string } | string> };
type HostShape = {
  uuid?: string;
  remark?: string;
  address?: string;
  port?: number | null;
  isDisabled?: boolean;
  inbound?: { configProfileUuid?: string; configProfileInboundUuid?: string } | null;
  sni?: string | null;
  host?: string | null;
  path?: string | null;
  tags?: string[];
};

export type SetupInput = {
  nodeUuid: string;
  /** null → автоматический поиск/создание squad по имени. */
  squadUuid: string | null;
  speedMbit: number;
  /** SSH-креды операции (password не сохраняется нигде). host = address выбранной ноды. */
  ssh: Pick<SshCredentials, "user" | "port" | "password">;
  /** Режим профиля: IN_PLACE (по умолчанию) — расширяем активный профиль ноды. */
  profileMode?: "IN_PLACE" | "CLONE";
};

export const NOTIFICATION_REMARKS = [
  "🔐 Доступ к lazeika.xyz и Telegram",
  "⏰ Ваша подписка закончилась!",
  "✅ Доступ сохранён ещё на {count} дней. Продлите подписку!",
];

type CreatedResource = { kind: "profile" | "squad" | "host"; uuid: string };

export type LazeikaServiceDependencies = {
  remna: LazeikaRemnaDeps;
  ssh: (creds: SshCredentials, script: string) => Promise<SshResult>;
  /** known_hosts файл — несекретная настройка окружения. */
  sshKnownHostsFile?: () => string;
  loadState?: typeof loadResourceState;
  saveState?: (state: LazeikaResourceState, tx?: unknown) => Promise<void>;
  persistProfileUuid?: (uuid: string | null, tx?: unknown) => Promise<void>;
  /** Авто-созданный squad пишется и в lazeika_only_squad_uuid (его читает mergeSquads). */
  persistSquadUuid?: (uuid: string | null, tx?: unknown) => Promise<void>;
  /**
   * CAS-захват APPLYING с fencing-токеном. claimed:false → параллельный/свежий setup.
   * token+raw обязательны: все записи состояния setup'а идут через casUpdate с expectedRaw.
   */
  beginSetup?: () => Promise<{ claimed: boolean; token?: string; raw?: string }>;
  /** Fenced запись: атомарный CAS от ожидаемого raw к новому состоянию (fencing, §2 финала). */
  casWrite?: (expectedRaw: string, nextState: LazeikaResourceState) => Promise<{ ok: boolean; raw: string }>;
  /** Сообщения notification-host + имя notification-профиля из настроек. */
  loadNotificationSettings?: () => Promise<{ messages: string[]; profileName: string }>;
  /** Атомарная фиксация входных настроек (нода/squad/скорость) в одной транзакции с READY. */
  persistSetupInputs?: (input: { nodeUuid: string; squadUuid: string | null; speedMbit: number }, tx?: unknown) => Promise<void>;
  /** Транзакционная обёртка финального READY+persist (инъекция для тестов). */
  runAtomic?: (fn: (tx: LazeikaStateTx | undefined) => Promise<void>) => Promise<void>;
};

export function createLazeikaService(dependencies: LazeikaServiceDependencies) {
  const {
    remna,
    ssh,
    sshKnownHostsFile = () => process.env.LAZEIKA_ONLY_SSH_KNOWN_HOSTS ?? "",
    loadState = loadResourceState,
    saveState = saveResourceState,
    persistProfileUuid = defaultPersistUuid(LAZEIKA_PROFILE_KEY),
    persistSquadUuid = defaultPersistUuid("lazeika_only_squad_uuid"),
    runAtomic = async (fn: (tx: LazeikaStateTx | undefined) => Promise<void>) => {
      const { prisma } = await import("../../db.js");
      await prisma.$transaction(async (tx) => fn(tx as LazeikaStateTx));
    },
    // CAS по сырому значению SystemSetting: два параллельных setup'а не могут оба пройти updateMany.
    // CAS по сырому значению + lockToken/lockedAt. APPLYING свежее 10 минут = чужая
    // активная работа; протухший (падение процесса) — забираем себе (§6 ревью).
    // CAS по сырому значению + lockToken/lockedAt. APPLYING свежее 10 минут = чужая
    // активная работа; протухший (падение процесса) — забираем себе (§6 ревью).
    beginSetup = async () => {
      const { prisma } = await import("../../db.js");
      const token = randomUUID();
      const nowIso = new Date().toISOString();
      const row = await prisma.systemSetting.findUnique({ where: { key: LAZEIKA_STATE_KEY } });
      const raw = row?.value ?? "";
      if (raw.includes('"status":"APPLYING"') || raw.includes('"status": "APPLYING"')) {
        let lockedAtMs = NaN;
        try { lockedAtMs = new Date(String((JSON.parse(raw) as Record<string, unknown>).lockedAt)).getTime(); } catch { /* нет метки */ }
        if (Number.isFinite(lockedAtMs) && Date.now() - lockedAtMs < 10 * 60_000) return { claimed: false };
      }
      let current: Record<string, unknown> = {};
      try { current = JSON.parse(raw) as Record<string, unknown>; } catch { current = {}; }
      const nextState = resourceStateSchema.parse({ ...current, status: "APPLYING", lastError: null });
      const next = serializeResourceState({ ...nextState, lockToken: token, lockedAt: nowIso });
      if (!row) {
        try {
          await prisma.systemSetting.create({ data: { key: LAZEIKA_STATE_KEY, value: next } });
          return { claimed: true, token, raw: next };
        } catch (error) {
          // P2002 unique — параллельный создатель выиграл гонку создания строки.
          if ((error as { code?: string }).code === "P2002") return { claimed: false };
          throw error;
        }
      }
      const updated = await prisma.systemSetting.updateMany({
        where: { key: LAZEIKA_STATE_KEY, value: raw },
        data: { value: next },
      });
      return updated.count > 0 ? { claimed: true, token, raw: next } : { claimed: false };
    },
    casWrite = async (expectedRaw: string, nextState: LazeikaResourceState) =>
      casUpdateResourceState(expectedRaw, nextState),
    loadNotificationSettings = async () => {
      const { getLazeikaConfig } = await import("./lazeika-only.config.js");
      const cfg = await getLazeikaConfig();
      return { messages: cfg.notificationMessages, profileName: cfg.notificationProfileName };
    },
    // Настройки фиксируются самим setup'ом: UI мог не сохранить форму перед «Настроить»
    // (иначе resource_state=READY при пустом lazeika_only_node_uuid, §4 ревью).
    persistSetupInputs = async ({ nodeUuid, squadUuid, speedMbit }, tx?: { systemSetting: { upsert(args: unknown): Promise<unknown> } }) => {
      const mod = await import("../../db.js");
      const client = tx ?? mod.prisma;
      const entries: Array<[string, string]> = [
        ["lazeika_only_node_uuid", nodeUuid],
        ["lazeika_only_squad_uuid", squadUuid ?? ""],
        ["lazeika_only_speed_mbit", String(speedMbit)],
        // legacy-алиас squad'а — mergeSquads читает его напрямую из настроек.
        ["expired_grace_squad_uuid", squadUuid ?? ""],
      ];
      for (const [key, value] of entries) {
        await client.systemSetting.upsert({
          where: { key },
          create: { key, value },
          update: { value },
        } as Parameters<typeof mod.prisma.systemSetting.upsert>[0]);
      }
      if (!tx) {
        const { invalidateSystemConfigCache } = await import("../client/client.service.js");
        invalidateSystemConfigCache();
      }
    },
  } = dependencies;

  async function fetchNodes(): Promise<RemnaNodeShape[]> {
    const list = unwrap(await requireOk(await remna.getNodes(), "VALIDATION"));
    const nodes = (list as { nodes?: RemnaNodeShape[] })?.nodes ?? (list as RemnaNodeShape[]);
    return Array.isArray(nodes) ? nodes : [];
  }
  async function fetchProfiles(): Promise<ProfileShape[]> {
    const list = unwrap(await requireOk(await remna.getConfigProfiles(), "PROFILE"));
    const profiles = (list as { configProfiles?: ProfileShape[] })?.configProfiles ?? (list as ProfileShape[]);
    return Array.isArray(profiles) ? profiles : [];
  }
  async function fetchSquads(): Promise<SquadShape[]> {
    const list = unwrap(await requireOk(await remna.getInternalSquads(), "SQUAD"));
    const squads = (list as { internalSquads?: SquadShape[] })?.internalSquads ?? (list as SquadShape[]);
    return Array.isArray(squads) ? squads : [];
  }
  async function fetchHosts(): Promise<HostShape[]> {
    const list = unwrap(await requireOk(await remna.getHosts(), "HOSTS"));
    const hosts = (list as { hosts?: HostShape[] })?.hosts ?? (list as HostShape[]);
    return Array.isArray(hosts) ? hosts : [];
  }

  const isNotificationHost = (h: HostShape) => !!h.tags?.includes(LAZEIKA_NOTIFICATION_HOST_TAG);
  const isLazeikaHost = (h: HostShape) => !!h.tags?.includes(LAZEIKA_HOST_TAG);

  /** Ручной squad допустим только с нашими inbounds (managed + notification). */
  function assertManualSquadSafe(squad: SquadShape, allowedInboundUuids: Set<string>): void {
    const ids = (squad.inbounds ?? [])
      .map((ib) => (typeof ib === "string" ? ib : ib?.uuid))
      .filter((u): u is string => typeof u === "string");
    const foreign = ids.filter((id) => !allowedInboundUuids.has(id));
    if (foreign.length > 0) {
      throw new SetupError(
        `Выбранный squad содержит чужие inbounds (${foreign.length}). Освободите его или выберите другой.`,
        "SQUAD",
      );
    }
  }

  /**
   * Детект топологии: внешний интерфейс + видимость порта на хосте.
   * tc ingress/egress видит порт ДО DNAT — фильтр по порту работает и для docker-published.
   * Неопределимый случай → ошибка «топология не поддерживается», лимитер на весь интерфейс не вешаем.
   */
  function parseDetectOutput(text: string): { iface: string; mode?: string } {
    const iface = /IFACE=(\S+)/.exec(text)?.[1] ?? "";
    const mode = /MODE=(\S+)/.exec(text)?.[1];
    if (!iface) throw new SetupError("Не удалось определить внешний интерфейс ноды", "SSH_TC");
    if (mode === "foreign") {
      // Порт занят чужим процессом — вешать лимитер нельзя, ограничили бы не только Xray.
      throw new SetupError("Топология ноды не поддерживается автоматически: порт занят процессом, который не является Xray/docker-proxy", "SSH_TC");
    }
    if (mode === "unknown") {
      throw new SetupError("Топология ноды не поддерживается автоматически: порт inbound не виден на хосте", "SSH_TC");
    }
    if (text.includes("TC=missing")) throw new SetupError("На ноде отсутствует tc", "SSH_TC");
    return { iface, mode };
  }

  async function setup(input: SetupInput): Promise<{ status: string; state: LazeikaResourceState }> {
    const speed = validateSpeed(input.speedMbit);
    let state = await loadState();
    const created: CreatedResource[] = [];
    let nodeChanged = false;
    let nodeAddress: string | null = null;
    let sshCreds: SshCredentials | null = null;
    let detectedIface: string | null = null;
    let autoSquadCreatedUuid: string | null = null;
    // Снапшоты УЖЕ СУЩЕСТВУЮЩИХ объектов, которые setup изменяет (§5 ревью):
    // rollback обязан вернуть их к состоянию до запуска, а не только удалить созданное.
    let profileSnapshot: { uuid: string; name?: string; config?: unknown } | null = null;
    const hostSnapshots: Array<{ uuid: string; inbound: unknown; tags: string[] }> = [];
    let squadSnapshot: { uuid: string; inbounds: string[] } | null = null;
    let tcFilesExisted: boolean | null = null;
    const prevSsh = { ...state.ssh };

    const profileMode = input.profileMode ?? "IN_PLACE";
    const { messages: notificationMessages, profileName: notificationProfileName } =
      await loadNotificationSettings();

    // Смена ноды запрещена при ЛЮБЫХ следах managed-инфраструктуры (READY/ERROR/APPLYING):
    // иначе snapshot/hosts старой ноды применятся к новой (§1 финального ревью).
    // Безопасный путь: POST /admin/lazeika-only/reset-state → setup на новой ноде.
    const hasManagedTraces = Boolean(
      state.profileUuid || state.squadUuid || state.managedInboundUuid || state.previousNodeConfig,
    );
    if (state.nodeUuid && input.nodeUuid !== state.nodeUuid && hasManagedTraces) {
      throw new SetupError(
        "Смена ноды при наличии managed-инфраструктуры не поддерживается: вызовите POST /admin/lazeika-only/reset-state и настройте заново на другой ноде",
        "VALIDATION",
      );
    }

    // CAS-захват APPLYING (§5 ревью): параллельный setup/reconcile отклоняется,
    // дубли профиля/squad/hosts невозможны.
    const claim = await beginSetup();
    if (!claim.claimed) {
      throw new SetupError("Настройка Lazeika-Only уже выполняется, подождите её завершения", "LOCK");
    }
    // Работаем строго от raw, захваченного claim'ом: каждая запись — атомарный CAS.
    // Потеря лока (другой воркер перезахватил) ⇒ LOCK_LOST и немедленный выход без
    // каких-либо компенсаций над чужими ресурсами (§2 финала).
    state = parseResourceState(claim.raw!);
    let stateRaw = claim.raw!;
    let lockLost = false;
    const fencedSave = async (): Promise<void> => {
      const res = await casWrite(stateRaw, state);
      if (!res.ok) {
        lockLost = true;
        throw new SetupError("LOCK_LOST: состояние изменено другим setup-воркером", "LOCK");
      }
      stateRaw = res.raw;
    };

    try {
      // ── Валидация (§7.1) ──
      const nodes = await fetchNodes();
      const node = nodes.find((n) => n.uuid === input.nodeUuid);
      if (!node) throw new SetupError("Нода не найдена в Remnawave", "VALIDATION");
      if (node.isDisabled) throw new SetupError("Нода отключена", "VALIDATION");
      if (!node.address) throw new SetupError("У ноды нет address", "VALIDATION");
      nodeAddress = node.address;
      sshCreds = {
        host: node.address,
        user: input.ssh.user,
        port: input.ssh.port,
        password: input.ssh.password,
      };

      const profiles = await fetchProfiles();
      let baseProfile = profiles.find((p) => p.uuid === nodeActiveProfileUuid(node));
      if (!baseProfile && state.baseProfileUuid) {
        // Managed-профиль удалён вручную вместе со ссылкой ноды — восстанавливаемся
        // от сохранённого базового профиля (§10 финала).
        baseProfile = profiles.find((p) => p.uuid === state.baseProfileUuid);
        if (baseProfile?.config) {
          console.warn("[lazeika-only] active profile missing; recovering from saved base profile");
          state.previousNodeConfig ??= {
            activeConfigProfileUuid: nodeActiveProfileUuid(node),
            activeInbounds: [...nodeActiveInboundUuids(node)],
          };
        }
      }
      if (!baseProfile?.config) throw new SetupError("Не удалось получить активный config-профиль ноды", "VALIDATION");

      // ── Squad: ручной UUID либо авто-поиск по имени ──
      let squadUuid = input.squadUuid ?? state.squadUuid ?? null;
      let squadSource: "AUTO" | "MANUAL" = input.squadUuid ? "MANUAL" : state.squadSource;
      if (input.squadUuid == null && !state.squadUuid) {
        const named = (await fetchSquads()).filter((s) => s.name === LAZEIKA_SQUAD_NAME);
        if (named.length > 1) {
          throw new SetupError(`Найдено несколько squad с именем «${LAZEIKA_SQUAD_NAME}» — укажите UUID вручную`, "SQUAD");
        }
        squadUuid = named[0]?.uuid ?? null;
        squadSource = "AUTO";
      }

      // ── Managed inbound: стабильный tag + свободный порт ──
      const tag = state.managedInboundTag ?? managedInboundTag(randomUUID());
      const port = state.managedInboundPort ?? pickManagedPort(baseProfile.config as XrayConfig, [input.ssh.port]);
      validatePort(port, [input.ssh.port]);
      const cloneSource = (baseProfile.config.inbounds ?? []).find((ib) => ib.tag !== tag);
      if (!cloneSource) throw new SetupError("В активном профиле нет inbound для клонирования", "PROFILE");

      // ── Профиль: IN_PLACE расширяем активный профиль; CLONE — независимая копия ──
      let managedProfile = state.profileUuid ? profiles.find((p) => p.uuid === state.profileUuid) : undefined;
      if (!managedProfile && profileMode === "IN_PLACE") {
        managedProfile = baseProfile;
      }
      const markerName = profileMode === "IN_PLACE"
        ? (managedProfile?.name ?? `Lazeika-Only — ${node.name ?? node.uuid.slice(0, 8)}`)
        : `Lazeika-Only — ${node.name ?? node.uuid.slice(0, 8)}`;
      const sourceConfig = managedProfile?.config ?? baseProfile.config;
      const { config: newConfig } = applyLazeikaToConfig(sourceConfig as XrayConfig, cloneSource, tag, port);
      state.profileMode = profileMode;
      const updatingExisting = Boolean(managedProfile?.uuid);
      if (updatingExisting) {
        profileSnapshot = { uuid: managedProfile!.uuid!, name: managedProfile!.name, config: managedProfile!.config };
      }
      if (managedProfile?.uuid && (profileMode === "IN_PLACE" || state.profileUuid === managedProfile.uuid)) {
        await requireOk(
          await remna.updateConfigProfile({
            uuid: managedProfile.uuid,
            ...(profileMode === "CLONE" ? { name: markerName } : {}),
            config: newConfig,
          }),
          "PROFILE",
        );
      } else {
        const raw = await requireOk(
          await remna.createConfigProfile({ name: markerName, config: newConfig }),
          "PROFILE",
        );
        const createdProfile = ((unwrap(raw) ?? raw) as ProfileShape) ?? null;
        if (!createdProfile?.uuid) throw new SetupError("Remnawave не вернул UUID созданного профиля", "PROFILE");
        managedProfile = createdProfile;
        created.push({ kind: "profile", uuid: createdProfile.uuid });
      }
      const managedProfileUuid = managedProfile.uuid!;
      let managedInboundUuid =
        (managedProfile.inbounds ?? []).find((ib) => ib.tag === tag)?.uuid ?? state.managedInboundUuid;
      if (!managedInboundUuid) {
        const fresh = await fetchProfiles();
        managedInboundUuid = fresh.find((p) => p.uuid === managedProfileUuid)?.inbounds?.find((ib) => ib.tag === tag)?.uuid ?? null;
      }
      if (!managedInboundUuid) throw new SetupError("Не найден UUID managed inbound в профиле", "PROFILE");

      state.profileUuid = managedProfileUuid;
      state.baseProfileUuid = profileMode === "IN_PLACE" ? null : (baseProfile.uuid ?? null);
      state.managedInboundTag = tag;
      state.managedInboundPort = port;
      state.managedInboundUuid = managedInboundUuid;
      state.nodeUuid = input.nodeUuid;

      // ── Применяем профиль к ноде, сохраняя прежние activeInbounds (§2.2) ──
      const previousInboundUuids = nodeActiveInboundUuids(node);
      state.previousNodeConfig ??= {
        activeConfigProfileUuid: nodeActiveProfileUuid(node),
        activeInbounds: [...previousInboundUuids],
      };
      await fencedSave();
      // ── Notification inbound В УПРАВЛЯЕМОМ профиле (Remnawave: одна активная
      // конфигурация на ноду). Свой порт + BLOCK catch-all по его тегу; hosts указывают
      // на .invalid — подключение невозможно. Отдельное имя профиля уведомлений
      // хранится в настройках и используется как редактируемый marker (§2 ТЗ). ──
      const notifTag = `${tag}_NOTIF`;
      const notifPort = pickManagedPort(newConfig, [input.ssh.port, port]);
      {
        const cfgNotif: XrayConfig = JSON.parse(JSON.stringify(newConfig));
        cfgNotif.inbounds ??= [];
        if (!cfgNotif.inbounds.some((ib) => ib.tag === notifTag)) {
          cfgNotif.inbounds.push(buildManagedInbound(cloneSource as never, notifTag, notifPort));
          cfgNotif.routing ??= { rules: [] };
          cfgNotif.routing.rules = [
            ...(cfgNotif.routing.rules ?? []).filter(
              (r) => !(Array.isArray(r.inboundTag) && (r.inboundTag as string[]).includes(notifTag)),
            ),
            { inboundTag: [notifTag], network: "tcp,udp", outboundTag: "BLOCK" },
          ];
        }
        await requireOk(
          await remna.updateConfigProfile({ uuid: managedProfileUuid, config: cfgNotif }),
          "PROFILE",
        );
        state.notifInboundTag = notifTag;
        state.notifInboundUuid =
          (managedProfile.inbounds ?? []).find((ib) => ib.tag === notifTag)?.uuid ?? null;
        if (!state.notifInboundUuid) {
          const freshNp = await fetchProfiles();
          state.notifInboundUuid =
            freshNp.find((pl) => pl.uuid === managedProfileUuid)?.inbounds?.find((ib) => ib.tag === notifTag)?.uuid ?? null;
        }
        if (!state.notifInboundUuid) throw new SetupError("Не найден UUID notification inbound", "PROFILE");
      }

      const targetActiveProfileUuid = profileMode === "IN_PLACE"
        ? (nodeActiveProfileUuid(node) ?? managedProfileUuid)
        : managedProfileUuid;
      await requireOk(
        await remna.updateNode({
          uuid: input.nodeUuid,
          ...nodeConfigProfilePatch(targetActiveProfileUuid, Array.from(new Set([
            ...previousInboundUuids,
            managedInboundUuid,
            state.notifInboundUuid!,
          ]))),
        }),
        "NODE_APPLY",
      );
      nodeChanged = true;

      // ── Squad: создать при отсутствии / привязать только managed inbound (§7.3) ──
      if (!squadUuid) {
        const raw = await requireOk(
          await remna.createInternalSquad({ name: LAZEIKA_SQUAD_NAME, inbounds: [managedInboundUuid, state.notifInboundUuid!] }),
          "SQUAD",
        );
        const createdSquad = ((unwrap(raw) ?? raw) as SquadShape) ?? null;
        if (!createdSquad?.uuid) throw new SetupError("Remnawave не вернул UUID созданного squad", "SQUAD");
        squadUuid = createdSquad.uuid;
        created.push({ kind: "squad", uuid: squadUuid });
        autoSquadCreatedUuid = squadUuid;
        squadSource = "AUTO";
      } else {
        const squad = (await fetchSquads()).find((s) => s.uuid === squadUuid);
        if (!squad && squadSource === "AUTO") {
          // Авто-squad удалён админом (в т.ч. через reconcile со старым UUID из
          // настроек) → создаём заново без дублей (§10 финала, §2 ревью).
          const rawNew = await requireOk(
            await remna.createInternalSquad({ name: LAZEIKA_SQUAD_NAME, inbounds: [managedInboundUuid, state.notifInboundUuid!] }),
            "SQUAD",
          );
          const createdSquad = ((unwrap(rawNew) ?? rawNew) as SquadShape) ?? null;
          if (!createdSquad?.uuid) throw new SetupError("Remnawave не вернул UUID созданного squad", "SQUAD");
          squadUuid = createdSquad.uuid;
          created.push({ kind: "squad", uuid: squadUuid });
          autoSquadCreatedUuid = squadUuid;
        } else {
          if (!squad) throw new SetupError("Выбранный squad не найден", "SQUAD");
          assertManualSquadSafe(squad, new Set([managedInboundUuid, state.notifInboundUuid!]));
          // Снапшот прежних inbounds — rollback вернёт squad (§4 ревью).
          squadSnapshot = {
            uuid: squadUuid,
            inbounds: (squad.inbounds ?? [])
              .map((ib) => (typeof ib === "string" ? ib : ib?.uuid))
              .filter((u): u is string => Boolean(u)),
          };
          await requireOk(
            await remna.updateInternalSquad({ uuid: squadUuid, inbounds: [managedInboundUuid, state.notifInboundUuid!] }),
            "SQUAD",
          );
        }
      }
      state.squadUuid = squadUuid;
      state.squadSource = squadSource;
      const accessible = await remna.getSquadAccessibleNodeUuids(squadUuid).catch(() => ({ error: "accessible-nodes недоступен" }) as { data?: string[]; error?: string });
      if (accessible.error) {
        throw new SetupError(`Не удалось проверить ноды squad: ${accessible.error}`, "SQUAD");
      }
      const extra = (accessible.data ?? []).filter((u) => u !== input.nodeUuid);
      if (extra.length > 0) throw new SetupError(`Squad доступен на лишних нодах: ${extra.join(", ")}`, "SQUAD");

      // ── Hosts: 1 РАБОЧИЙ (managed inbound) + 3 FAKE notification (.invalid) ──
      const hosts = await fetchHosts();
      // Технический шаблон берём из рабочего host'а ИСХОДНОГО профиля (в CLONE это база).
      const templateProfileUuid = profileMode === "CLONE" ? (baseProfile.uuid ?? null) : managedProfileUuid;
      const baseTemplate = hosts.find(
        (h) => h.inbound?.configProfileUuid === templateProfileUuid && h.address && !isNotificationHost(h) && !isLazeikaHost(h),
      ) ?? null;
      const workingBinding = { configProfileUuid: managedProfileUuid, configProfileInboundUuid: managedInboundUuid };
      const notifBinding = { configProfileUuid: managedProfileUuid, configProfileInboundUuid: state.notifInboundUuid! };

      const workingExisting =
        hosts.find((h) => h.uuid && h.uuid === state.workingHostUuid)
        ?? hosts.find((h) => isLazeikaHost(h) && !isNotificationHost(h));
      if (workingExisting?.uuid) {
        hostSnapshots.push({
          uuid: workingExisting.uuid,
          inbound: workingExisting.inbound ?? null,
          tags: [...(workingExisting.tags ?? [])],
        });
        await requireOk(
          await remna.updateHost({
            uuid: workingExisting.uuid,
            inbound: workingBinding,
            tags: Array.from(new Set([...(workingExisting.tags ?? []), LAZEIKA_HOST_TAG])),
          }),
          "HOSTS",
        );
        state.workingHostUuid = workingExisting.uuid;
      } else {
        const body: Record<string, unknown> = {
          remark: notificationMessages[0],
          address: baseTemplate?.address ?? node.address,
          port,
          inbound: workingBinding,
          tags: [LAZEIKA_HOST_TAG],
        };
        if (baseTemplate?.sni) body.sni = baseTemplate.sni;
        if (baseTemplate?.host) body.host = baseTemplate.host;
        if (baseTemplate?.path) body.path = baseTemplate.path;
        const raw = await requireOk(await remna.createHost(body), "HOSTS");
        const uuid = ((unwrap(raw) ?? raw) as HostShape)?.uuid ?? null;
        if (!uuid) throw new SetupError("Remnawave не вернул UUID рабочего host", "HOSTS");
        created.push({ kind: "host", uuid });
        state.workingHostUuid = uuid;
      }

      // Fake notification-hosts: ровно 3, .invalid, ВИДИМЫЕ в подписке (isDisabled=false),
      // привязаны к notif-inbound'у (техническое требование Remnawave), трафик блокируется
      // BLOCK-правилом по его тегу + неразрешимый DNS.
      for (let i = 0; i < 3; i++) {
        const existing = hosts.filter(isNotificationHost)[i];
        if (existing?.uuid) {
          // Reconcile: обновляем binding/tags; remark — пользовательский, не трогаем.
          hostSnapshots.push({
            uuid: existing.uuid,
            inbound: existing.inbound ?? null,
            tags: [...(existing.tags ?? [])],
          });
          await requireOk(
            await remna.updateHost({
              uuid: existing.uuid,
              inbound: notifBinding,
              // Fake-host обязан оставаться ВИДИМЫМ в подписке.
              isDisabled: false,
              tags: Array.from(new Set([...(existing.tags ?? []), LAZEIKA_HOST_TAG, LAZEIKA_NOTIFICATION_HOST_TAG])),
            }),
            "HOSTS",
          );
          state.notificationHostUuids = Array.from(new Set([...state.notificationHostUuids, existing.uuid]));
          continue;
        }
        const raw = await requireOk(
          await remna.createHost({
            remark: notificationMessages[i],
            address: `notification-${i + 1}.lazeika.invalid`,
            port: null,
            isDisabled: false,
            inbound: notifBinding,
            tags: [LAZEIKA_HOST_TAG, LAZEIKA_NOTIFICATION_HOST_TAG],
          }),
          "HOSTS",
        );
        const uuid = ((unwrap(raw) ?? raw) as HostShape)?.uuid ?? null;
        if (!uuid) throw new SetupError("Remnawave не вернул UUID notification host", "HOSTS");
        created.push({ kind: "host", uuid });
        state.notificationHostUuids = [...state.notificationHostUuids.filter((u) => u !== uuid), uuid];
      }

      // ── SSH / tc (§7.5) ──
      const detectScript = [
        'IF="$(ip -o route show default 2>/dev/null | awk \'{print $5}\' | head -1)"',
        '[ -n "$IF" ] || exit 3',
        `TCP="$(ss -Hltnp "sport = :${port}" 2>/dev/null)"`,
        `UDP="$(ss -Hlunp "sport = :${port}" 2>/dev/null)"`,
        'LISTEN="$TCP"',
        'case "$UDP" in',
        '  *xray*|*docker-proxy*) ;; # udp нашего xray — ок',
        '  "") ;; # udp не занят',
        '  *) LISTEN="$LISTEN foreign-udp:$UDP" ;;',
        'esac',
        'case "$LISTEN" in',
        '  *foreign-udp*) MODE=foreign ;;',
        '  *docker-proxy*) MODE=docker ;;',
        '  *xray*) MODE=host ;;',
        '  "") MODE=unknown ;;',
        '  *) MODE=foreign; echo "FOREIGN=$LISTEN" | cut -c1-160 ;;',
        'esac',
        'echo "IFACE=$IF"',
        'echo "MODE=$MODE"',
        "command -v tc >/dev/null 2>&1 && echo TC=ok || echo TC=missing",
      ].join("\n");
      if (!detectedIface) {
        // До 3 попыток с паузой: после применения профиля xray на ноде стартует не мгновенно.
        let lastText = "";
        for (let attempt = 0; attempt < 3 && !detectedIface; attempt++) {
          const detected = await ssh(sshCreds, detectScript);
          if (!detected.ok) throw new SetupError(`Детект топологии не удался (exit ${detected.exitCode})`, "SSH_TC");
          lastText = detected.stdout || detected.stderr;
          try {
            const parsed = parseDetectOutput(lastText);
            detectedIface = parsed.iface;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // foreign/нет tc — не ретраим, это терминальные состояния.
            if (message.includes("процессом") || message.includes("tc")) throw error;
            if (attempt === 2) throw error;
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }
        if (!detectedIface) {
          throw new SetupError("Топология ноды не поддерживается автоматически: порт inbound не виден на хосте", "SSH_TC");
        }
        void lastText;
      }

      // Существовали ли unit/скрипт до запуска. Неопределённый результат —
      // терминальная ошибка БЕЗ destructive cleanup (§4 ревью).
      try {
        const probe = await ssh(sshCreds, `[ -f ${TC_SCRIPT_PATH} ] && [ -f /etc/systemd/system/${TC_UNIT_NAME} ] && echo TCFILES_EXIST || echo TCFILES_NEW`);
        const probeText = probe.stdout + probe.stderr;
        if (!probe.ok) throw new SetupError(`Не удалось проверить наличие tc-лимитера на ноде (exit ${probe.exitCode})`, "SSH_TC");
        if (probeText.includes("TCFILES_EXIST")) tcFilesExisted = true;
        else if (probeText.includes("TCFILES_NEW")) tcFilesExisted = false;
        else throw new SetupError("Неоднозначный ответ ноды при проверке tc-лимитера", "SSH_TC");
      } catch (error) {
        if (error instanceof SetupError) throw error;
        throw new SetupError(`Не удалось проверить наличие tc-лимитера: ${error instanceof Error ? error.message : String(error)}`, "SSH_TC");
      }

      // Скрипт содержит set -euo pipefail и самопроверку всех 8 pref'ов + обоих
      // общих police actions + enabled unit — любая ошибка ⇒ ненулевой exit (§6 финала).
      const remoteInstall = [
        // Верхнеуровневый fail-fast: ЛЮБАЯ ошибка (heredoc/chmod/systemctl/скрипт)
        // ⇒ ненулевой exit всего install-скрипта (§3 финального ревью).
        "set -euo pipefail",
        "install -d /usr/local/sbin",
        `cat > ${TC_SCRIPT_PATH}.tmp <<'LAZEIKA_TC_EOF'`,
        buildTcScript({ iface: detectedIface!, port, speedMbit: speed }).trimEnd(),
        "LAZEIKA_TC_EOF",
        `chmod 0755 ${TC_SCRIPT_PATH}.tmp && mv ${TC_SCRIPT_PATH}.tmp ${TC_SCRIPT_PATH}`,
        `cat > /etc/systemd/system/${TC_UNIT_NAME}.tmp <<'LAZEIKA_UNIT_EOF'`,
        buildTcUnit().trimEnd(),
        "LAZEIKA_UNIT_EOF",
        `chmod 0644 /etc/systemd/system/${TC_UNIT_NAME}.tmp && mv /etc/systemd/system/${TC_UNIT_NAME}.tmp /etc/systemd/system/${TC_UNIT_NAME}`,
        "systemctl daemon-reload",
        `systemctl enable --now ${TC_UNIT_NAME}`,
        TC_SCRIPT_PATH,
        // Пост-проверка systemd: unit обязан быть enabled после всех шагов.
        `systemctl is-enabled --quiet ${TC_UNIT_NAME} || { echo UNIT_NOT_ENABLED; exit 1; }`,
      ].join("\n");
      const applied = await ssh(sshCreds, remoteInstall);
      if (!applied.ok) {
        throw new SetupError(`tc-фильтры не применились (exit ${applied.exitCode})`, "SSH_TC");
      }
      state.ssh = { interface: detectedIface!, rateMbit: speed };

      // ── Готово: READY + фиксация входных настроек АТОМАРНО (§5 ревью) ──
      state.createdResourceUuids = [];
      state.lastVerifiedAt = new Date().toISOString();
      state.status = "READY";
      state.lockToken = null;
      state.lockedAt = null;
      await fencedSave();
      await runAtomic(async (tx) => {
        await persistProfileUuid(managedProfileUuid, tx);
        // Авто-созданный squad попадает в настройки: mergeSquads читает ключ (§4.4.3).
        await persistSquadUuid(squadUuid, tx);
        await persistSetupInputs?.({ nodeUuid: input.nodeUuid, squadUuid, speedMbit: speed }, tx);
      });
      {
        const { invalidateSystemConfigCache } = await import("../client/client.service.js");
        invalidateSystemConfigCache();
      }
      return { status: "READY", state };
    } catch (error) {
      const phase = error instanceof SetupError ? error.phase : "UNKNOWN";
      const message = error instanceof Error ? error.message : String(error);
      // Лок потерян: чужой воркер владеет состоянием/ресурсами — НИЧЕГО не трогаем (§2 финала).
      if (lockLost) {
        console.error("[lazeika-only] lock lost; skipping compensation to avoid touching new worker resources");
        throw error;
      }
      // Компенсирующий rollback (§7.6): только ресурсы, созданные текущим запуском.
      try {
        if (nodeChanged && state.previousNodeConfig) {
          await remna.updateNode({
            uuid: input.nodeUuid,
            ...nodeConfigProfilePatch(state.previousNodeConfig.activeConfigProfileUuid, state.previousNodeConfig.activeInbounds),
          }).catch(() => {});
        }
        for (const r of [...created].reverse()) {
          if (r.kind === "host") await remna.deleteHost(r.uuid).catch(() => {});
          else if (r.kind === "profile") await remna.deleteConfigProfile(r.uuid).catch(() => {});
          else {
            await remna.deleteInternalSquad(r.uuid).catch(() => {});
            // Удалённый авто-squad не должен оставаться в state — иначе повторный
            // setup вечно падает с «squad не найден».
            if (state.squadUuid === r.uuid) {
              state.squadUuid = null;
              state.squadSource = "AUTO";
              autoSquadCreatedUuid = null;
            }
          }
        }
        // Изменённые существующие объекты возвращаем к снапшоту (до удаления созданного).
        if (state.profileMode === "IN_PLACE" && state.profileUuid) {
          // Хирургия: убираем ТОЛЬКО наши inbound/rules из текущего конфига,
          // чужие изменения не перезаписываем устаревшим снапшотом (§6 ТЗ-финал).
          const freshProfiles = await fetchProfiles().catch(() => [] as ProfileShape[]);
          const prof = freshProfiles.find((pl) => pl.uuid === state.profileUuid);
          if (prof?.config) {
            const cfg: XrayConfig = JSON.parse(JSON.stringify(prof.config));
            const ownTags = [state.managedInboundTag, state.notifInboundTag].filter((t): t is string => Boolean(t));
            cfg.inbounds = (cfg.inbounds ?? []).filter((ib) => !ownTags.includes(String(ib.tag)));
            cfg.routing = cfg.routing ?? {};
            cfg.routing.rules = (cfg.routing.rules ?? []).filter(
              (r) => !(Array.isArray(r.inboundTag) && (r.inboundTag as string[]).some((t) => ownTags.includes(t))),
            );
            await remna.updateConfigProfile({ uuid: state.profileUuid!, config: cfg }).catch(() => {});
          }
        } else if (profileSnapshot) {
          await remna.updateConfigProfile({
            uuid: profileSnapshot.uuid,
            ...(profileSnapshot.name !== undefined ? { name: profileSnapshot.name } : {}),
            ...(profileSnapshot.config !== undefined ? { config: profileSnapshot.config } : {}),
          }).catch(() => {});
        }
        for (const h of hostSnapshots) {
          await remna.updateHost({ uuid: h.uuid, inbound: h.inbound, tags: h.tags }).catch(() => {});
        }
        if (squadSnapshot) {
          await remna.updateInternalSquad({ uuid: squadSnapshot.uuid, inbounds: squadSnapshot.inbounds }).catch(() => {});
        }
        // tc: restore при существовавшем лимитере, cleanup только когда его точно не было,
        // ничего не трогаем если состояние неизвестно (probe упал — setup прервался до установки,
        // но фильтры могли остаться от прежнего READY... нет: probe идёт ДО install; unknown ⇒ мы
        // прервались до любых tc-действий этого запуска).
        let rollbackIncomplete = false;
        if (detectedIface && nodeAddress && tcFilesExisted !== null) {
          if (tcFilesExisted && !(prevSsh.interface && prevSsh.rateMbit)) {
            // Существующий лимитер, но снапшот повреждён: НЕ трогаем tc вовсе (§5 финала).
            rollbackIncomplete = true;
            console.error("[lazeika-only] existing limiter without valid snapshot; tc left untouched");
          } else if (tcFilesExisted) {
            const restoreScript = [
              "install -d /usr/local/sbin",
              `cat > ${TC_SCRIPT_PATH}.tmp <<'LAZEIKA_TC_EOF'`,
              buildTcScript({ iface: prevSsh.interface!, port: state.managedInboundPort ?? 40001, speedMbit: prevSsh.rateMbit! }).trimEnd(),
              "LAZEIKA_TC_EOF",
              `chmod 0755 ${TC_SCRIPT_PATH}.tmp && mv ${TC_SCRIPT_PATH}.tmp ${TC_SCRIPT_PATH}`,
              `cat > /etc/systemd/system/${TC_UNIT_NAME}.tmp <<'LAZEIKA_UNIT_EOF'`,
              buildTcUnit().trimEnd(),
              "LAZEIKA_UNIT_EOF",
              `chmod 0644 /etc/systemd/system/${TC_UNIT_NAME}.tmp && mv /etc/systemd/system/${TC_UNIT_NAME}.tmp /etc/systemd/system/${TC_UNIT_NAME}`,
              "systemctl daemon-reload",
              TC_SCRIPT_PATH,
            ].join("\n");
            await ssh(sshCreds ?? { host: nodeAddress ?? "", user: input.ssh.user, port: input.ssh.port, password: input.ssh.password }, restoreScript).catch(() => {});
          } else {
            const cleanupLines = [
              `systemctl disable --now ${TC_UNIT_NAME} 2>/dev/null || true`,
              `rm -f /etc/systemd/system/${TC_UNIT_NAME} ${TC_SCRIPT_PATH}`,
              "systemctl daemon-reload 2>/dev/null || true",
            ];
            for (const pref of ownedPrefs()) {
              cleanupLines.push(`tc filter del dev "${detectedIface}" ingress pref ${pref} 2>/dev/null || true`);
              cleanupLines.push(`tc filter del dev "${detectedIface}" egress pref ${pref} 2>/dev/null || true`);
            }
            // Общие police actions создаются только нашим скриптом → снимаем их.
            cleanupLines.push(`tc action del action police index ${TC_POLICE_INDEX_INGRESS} 2>/dev/null || true`);
            cleanupLines.push(`tc action del action police index ${TC_POLICE_INDEX_EGRESS} 2>/dev/null || true`);
            await ssh(sshCreds ?? { host: nodeAddress ?? "", user: input.ssh.user, port: input.ssh.port, password: input.ssh.password }, cleanupLines.join("\n")).catch(() => {});
          }
        }
        if (rollbackIncomplete) {
          state.lastError = `${state.lastError ?? ""}; rollback incomplete: существующий tc-лимитер оставлен без изменений`.slice(0, 500);
        }
        // Удалённый авто-squad не должен остаться в настройках для mergeSquads.
        if (!state.squadUuid) await persistSquadUuid(null).catch(() => {});
      } catch (rollbackError) {
        console.error("[lazeika-only] rollback failed", rollbackError);
      }
      state.status = "ERROR";
      state.lastError = `[${phase}] ${message}`;
      state.createdResourceUuids = created.map((r) => r.uuid);
      state.lockToken = null;
      state.lockedAt = null;
      try {
        await fencedSave();
      } catch (fenceError) {
        console.error("[lazeika-only] fenced ERROR write failed; new worker state untouched", fenceError);
      }
      throw error;
    }
  }

  // ─── verify: только чтение, без создания ресурсов (спецификация §6) ──────

  type VerifyCheck = { name: string; ok: boolean; detail?: string };
  async function verify(sshInput: Pick<SshCredentials, "user" | "port" | "password">): Promise<{ ok: boolean; checks: VerifyCheck[] }> {
    let verifyCreds: SshCredentials | null = null;
    const makeCreds = (host: string): SshCredentials => (verifyCreds ??= {
      host, user: sshInput.user, port: sshInput.port, password: sshInput.password,
    });
    const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
    const add = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, ...(detail ? { detail } : {}) });
    const state = await loadState();

    // UNCONFIGURED: одна содержательная подсказка вместо каскада вторичных ошибок (§5 ТЗ).
    if (state.status === "UNCONFIGURED" || (!state.profileUuid && !state.squadUuid)) {
      return {
        ok: false,
        checks: [{ name: "state", ok: false, detail: "Инфраструктура ещё не настроена. Нажмите «Настроить»." }],
      };
    }

    let profiles: ProfileShape[] = [];
    try { profiles = await fetchProfiles(); add("remnawave", true); }
    catch (e) { add("remnawave", false, e instanceof Error ? e.message : String(e)); }

    const profile = profiles.find((p) => p.uuid === state.profileUuid);
    add("profile", !!profile);
    add("inbound", !!profile?.inbounds?.some((ib) => ib.uuid === state.managedInboundUuid));
    // Routing: содержательная сверка (§8 ревью) — telegram/lazeika.xyz → DIRECT,
    // catch-all нашего тега → BLOCK-тег профиля.
    type RuleShape = { inboundTag?: unknown; domain?: unknown; network?: unknown; outboundTag?: unknown };
    const managedRules = ((profile?.config?.routing?.rules ?? []) as RuleShape[])
      .filter((r) => Array.isArray(r.inboundTag) && (r.inboundTag as string[]).includes(state.managedInboundTag ?? ""));
    const blockTag = (profile?.config?.outbounds ?? [])
      .map((o) => String(o.tag ?? ""))
      .find((t) => t.toLowerCase() === "block" || t.toLowerCase() === "blackhole");
    const hasTelegram = managedRules.some((r) =>
      Array.isArray(r.domain) && (r.domain as string[]).includes("geosite:telegram") && r.outboundTag === "DIRECT");
    const hasLazeika = managedRules.some((r) =>
      Array.isArray(r.domain) && (r.domain as string[]).includes("domain:lazeika.xyz") && r.outboundTag === "DIRECT");
    const hasBlockCatchAll = Boolean(blockTag) && managedRules.some((r) =>
      r.outboundTag === blockTag && r.network === "tcp,udp");
    const noStale = managedRules.length === 3;
    add(
      "routing_rules",
      hasTelegram && hasLazeika && hasBlockCatchAll && noStale,
      [
        hasTelegram ? "" : "нет geosite:telegram→DIRECT",
        hasLazeika ? "" : "нет domain:lazeika.xyz→DIRECT",
        hasBlockCatchAll ? "" : `нет catch-all→${blockTag ?? "BLOCK"}`,
        noStale ? "" : `лишние managed-правила: ${managedRules.length} вместо 3`,
      ].filter(Boolean).join("; ") || undefined,
    );

    let squad: SquadShape | undefined;
    try {
      squad = (await fetchSquads()).find((s) => s.uuid === state.squadUuid);
      add("squad", !!squad);
      const ids = (squad?.inbounds ?? [])
        .map((ib) => (typeof ib === "string" ? ib : ib?.uuid))
        .filter((u): u is string => !!u);
      add("squad_inbounds_only_managed", ids.length === 1 && ids[0] === state.managedInboundUuid, ids.join(","));
    } catch (e) { add("squad", false, e instanceof Error ? e.message : String(e)); }
    if (state.squadUuid) {
      const acc = await remna.getSquadAccessibleNodeUuids(state.squadUuid).catch(() => ({ error: "accessible-nodes недоступен" }) as { data?: string[]; error?: string });
      const nodeUuids = acc.data ?? [];
      add(
        "squad_nodes",
        !acc.error && nodeUuids.length > 0 && nodeUuids.every((u) => u === state.nodeUuid),
        acc.error ?? nodeUuids.join(","),
      );
    } else add("squad_nodes", false);

    try {
      const hosts = await fetchHosts();
      const workingHost = hosts.find((h) => h.uuid && h.uuid === state.workingHostUuid);
      add("working_host", !!workingHost);
      // Binding рабочего host должен указывать на managed профиль/inbound.
      add(
        "working_host_binding",
        workingHost?.inbound?.configProfileUuid === state.profileUuid
        && workingHost?.inbound?.configProfileInboundUuid === state.managedInboundUuid,
      );
      const notifications = hosts.filter(isNotificationHost);
      const notifOk = notifications.filter((h) =>
        String(h.address ?? "").endsWith(".invalid")
        && h.isDisabled !== true // видимые в подписке
        && h.inbound?.configProfileUuid === state.profileUuid
        && h.inbound?.configProfileInboundUuid === state.notifInboundUuid
        && h.tags?.includes(LAZEIKA_NOTIFICATION_HOST_TAG));
      add(
        "notification_hosts",
        notifications.length >= NOTIFICATION_REMARKS.length && notifOk.length >= NOTIFICATION_REMARKS.length,
        `${notifications.length}/${notifOk.length} корректных (.invalid+visible+notif-binding+tags)`,
      );
    } catch (e) { add("working_host", false, e instanceof Error ? e.message : String(e)); }

    if (state.nodeUuid) {
      const node = (await fetchNodes().catch(() => [])).find((n) => n.uuid === state.nodeUuid);
      add("node_profile", node ? nodeActiveProfileUuid(node) === state.profileUuid : false);
      add("node_inbound_active", nodeActiveInboundUuids(node ?? { uuid: "" }).includes(state.managedInboundUuid ?? ""));
      if (node?.address && state.managedInboundPort && state.ssh.interface) {
        try {
          // Полный дамп: содержимое КАЖДОГО собственного фильтра + общие actions (§9 финала).
          const iface = state.ssh.interface;
          const probe = await ssh(
            makeCreds(node.address),
            [
              `echo ===FILTERS===`,
              `tc filter show dev "${iface}"`,
              `echo ===ACTIONS===`,
              `tc actions show action police index ${TC_POLICE_INDEX_INGRESS}`,
              `tc actions show action police index ${TC_POLICE_INDEX_EGRESS}`,
              `echo ===FILES===`,
              `[ -x ${TC_SCRIPT_PATH} ] && [ -f /etc/systemd/system/${TC_UNIT_NAME} ] && echo FILES_OK || echo FILES_MISSING`,
              `systemctl is-enabled ${TC_UNIT_NAME} >/dev/null 2>&1 && echo UNIT_ENABLED || echo UNIT_DISABLED`,
              `ss -Hltn "sport = :${state.managedInboundPort}" | grep -q . && echo PORT_LISTENING || echo PORT_SILENT`,
            ].join("\n"),
          );
          const out = probe.stdout + probe.stderr;
          if (!probe.ok) {
            add("ssh", false, `exit ${probe.exitCode}`);
          } else {
            add("ssh", true);
            add("tc_files", out.includes("FILES_OK"), out.includes("FILES_MISSING") ? "скрипт/unit отсутствуют" : undefined);
            add("systemd_unit", out.includes("UNIT_ENABLED"));
            add("port_listening", out.includes("PORT_LISTENING"));

            // ── Содержательная проверка всех собственных фильтров ──
            // Толерантно к формату tc: eth_type/protocol, порядок токенов произвольный.
            const filtersSection = out.split("===FILTERS===")[1]?.split("===ACTIONS===")[0] ?? "";
            type ParsedFilter = {
              pref: number;
              protocol: string;
              ipProto: string;
              port: number;
              direction: string;
              policeIndex: number | null;
            };
            const parsedFilters: ParsedFilter[] = [];
            for (const line of filtersSection.split("\n")) {
              const prefM = /pref\s+(11\d{3})/.exec(line);
              if (!prefM) continue;
              const num = (re: RegExp): string | null => re.exec(line)?.[1] ?? null;
              const proto = num(/(?:eth_type|protocol)\s+(ip\w*)/i) ?? "";
              const ipProto = num(/ip_proto\s+(tcp|udp)/i) ?? "";
              const portDirM = /(dst_port|src_port)\s+(\d+)/.exec(line);
              const policeRaw = num(/police[^\n]*?index\s+(\d+)/i) ?? num(/action[^\n]*?index\s+(\d+)/i);
              parsedFilters.push({
                pref: Number(prefM[1]),
                protocol: proto,
                ipProto: ipProto.toLowerCase(),
                port: portDirM ? Number(portDirM[2]) : -1,
                direction: portDirM ? (portDirM[1] === "dst_port" ? "ingress" : "egress") : "?",
                policeIndex: policeRaw ? Number(policeRaw) : null,
              });
            }
            const specs = expectedFilterSpecs({ port: state.managedInboundPort! });
            const problems: string[] = [];
            for (const spec of specs) {
              const f = parsedFilters.find((pf) => pf.pref === spec.pref);
              if (!f) { problems.push(`pref ${spec.pref} отсутствует`); continue; }
              if (!f.protocol.toLowerCase().startsWith(spec.protocol)) problems.push(`pref ${spec.pref}: protocol ${f.protocol || "?"} != ${spec.protocol}`);
              if (f.ipProto !== spec.ipProto) problems.push(`pref ${spec.pref}: ip_proto ${f.ipProto || "?"} != ${spec.ipProto}`);
              if (f.port !== state.managedInboundPort) problems.push(`pref ${spec.pref}: порт ${f.port} != ${state.managedInboundPort}`);
              if (f.direction !== spec.direction) problems.push(`pref ${spec.pref}: направление ${f.direction} != ${spec.direction}`);
              if (f.policeIndex !== null && f.policeIndex !== spec.policeIndex) problems.push(`pref ${spec.pref}: police index ${f.policeIndex} != общий ${spec.policeIndex}`);
            }
            add("tc_filters", problems.length === 0, problems.slice(0, 4).join("; ") || `${parsedFilters.length}/${TC_PREF_COUNT}`);

            // ── Общие actions: ровно по одному bucket на направление с нужным rate ──
            const actionsSection = out.split("===ACTIONS===")[1]?.split("===FILES===")[0] ?? "";
            let policeOk = true;
            const policeDetails: string[] = [];
            for (const [idx, label] of [[TC_POLICE_INDEX_INGRESS, "ingress"], [TC_POLICE_INDEX_EGRESS, "egress"]] as const) {
              const block = actionsSection.split(`index ${idx} `)[1]?.split("index ")[0] ?? "";
              const rate = /(\d+)\s*mbit/i.exec(block)?.[1];
              if (!block.trim() || rate !== String(state.ssh.rateMbit)) {
                policeOk = false;
                policeDetails.push(`${label}: index ${idx} ${block ? `rate=${rate ?? "?"}` : "отсутствует"}`);
              }
            }
            add("tc_rate_aggregate", policeOk, policeDetails.join("; ") || "общие buckets соответствуют");
          }
        } catch (e) {
          add("ssh", false, e instanceof Error ? e.message : String(e));
        }
      } else add("ssh", false, "инфраструктура настроена не полностью");
    } else add("node", false, "нода не выбрана");

    return { ok: checks.every((c) => c.ok), checks };
  }

  /** Выключение режима: новые grace-доступы прекращаются, инфраструктура не удаляется. */
  async function disable(): Promise<{ status: string }> {
    const state = await loadState();
    state.lastVerifiedAt = new Date().toISOString();
    await saveState(state);
    return { status: state.status };
  }

  return { setup, verify, disable, parseDetectOutput };
}

export type LazeikaService = ReturnType<typeof createLazeikaService>;
