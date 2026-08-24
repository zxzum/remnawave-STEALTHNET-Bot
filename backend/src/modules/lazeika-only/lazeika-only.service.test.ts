import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";

const { createLazeikaService, NOTIFICATION_REMARKS } = await import("./lazeika-only.service.js");
const { resourceStateSchema } = await import("./lazeika-only.config.js");

type RemnaResult = { data?: unknown; error?: string; status: number };

const NODE_UUID = "11111111-1111-1111-1111-111111111111";
const BASE_PROFILE_UUID = "22222222-2222-2222-2222-222222222222";
const MANUAL_SQUAD_UUID = "33333333-3333-3333-3333-333333333333";

const baseInbound = {
  tag: "VLESS-REALITY",
  port: 443,
  protocol: "vless",
  settings: { clients: [], decryption: "none" },
  streamSettings: { network: "tcp", security: "reality" },
  sniffing: { enabled: true, destOverride: ["tls"] },
};

type FakeNode = {
  uuid: string;
  name?: string;
  address?: string;
  isDisabled?: boolean;
  configProfile?: { activeConfigProfileUuid?: string | null; activeInbounds?: string[] };
};

/** Полностью fake-окружение Remna в памяти. */
function createFakeRemna(options: {
  failCreateProfile?: boolean;
  failUpdateProfile?: boolean;
} = {}) {
  let seq = 0;
  // Валидные v4-style UUID: resource_state прогоняется через Zod при каждом чтении.
  const nextUuid = () => {
    const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    seq++;
    return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
  };
  // Реальная панель сохраняет UUID inbound по стабильному тегу между PATCH.
  const inboundUuidByTag = new Map<string, string>();
  const ensureInboundUuid = (tag: string) => {
    if (!inboundUuidByTag.has(tag)) inboundUuidByTag.set(tag, nextUuid());
    return inboundUuidByTag.get(tag)!;
  };
  inboundUuidByTag.set("VLESS-REALITY", "inbound-base-uuid");
  const state = {
    nodes: [{
      uuid: NODE_UUID,
      name: "Alpha",
      address: "203.0.113.10",
      isDisabled: false,
      // Реальный контракт Remnawave: профиль/инбаунды вложены в configProfile.
      configProfile: {
        activeConfigProfileUuid: BASE_PROFILE_UUID,
        activeInbounds: ["inbound-base-uuid"],
      },
    }] as FakeNode[],
    // PATCH-тела updateNode — для проверки формы запроса к реальной панели.
    updateNodeBodies: [] as Array<Record<string, unknown>>,
    profiles: [{
      uuid: BASE_PROFILE_UUID,
      name: "Main",
      config: {
        inbounds: [baseInbound],
        outbounds: [{ protocol: "freedom", tag: "DIRECT" }, { protocol: "blackhole", tag: "BLOCK" }],
        routing: { rules: [] },
      },
      inbounds: [{ uuid: "inbound-base-uuid", tag: "VLESS-REALITY", port: 443 }],
    }] as Array<Record<string, unknown>>,
    squads: [] as Array<Record<string, unknown>>,
    hosts: [
      // рабочий host базового профиля — источник технических параметров
      {
        uuid: "host-base-working",
        remark: "Alpha main",
        address: "vpn.example.com",
        port: 443,
        isDisabled: false,
        inbound: { configProfileUuid: BASE_PROFILE_UUID, configProfileInboundUuid: "inbound-base-uuid" },
        sni: "vpn.example.com",
        host: "vpn.example.com",
        path: "/base",
        tags: [],
      },
    ] as Array<Record<string, unknown>>,
    calls: { updateNode: [] as Array<Record<string, unknown>>, deleted: [] as string[] },
  };

  const ok = (data: unknown): RemnaResult => ({ status: 200, data });
  const remna = {
    getNodes: async () => ok({ response: { nodes: state.nodes } }),
    getConfigProfiles: async () => ok({ response: { configProfiles: state.profiles } }),
    createConfigProfile: async (body: { name: string; config: unknown }) => {
      if (options.failCreateProfile) return { status: 502, error: "profile create failed" };
      const managedInbounds = ((body.config as { inbounds: Array<{ tag: string }> }).inbounds ?? [])
        .filter((ib) => ib.tag.startsWith("LAZEIKA_ONLY_INBOUND"));
      const profile = {
        uuid: nextUuid(),
        name: body.name,
        config: body.config,
        inbounds: managedInbounds.map((ib) => ({ uuid: ensureInboundUuid(ib.tag), tag: ib.tag, port: 40001 })),
      };
      state.profiles.push(profile);
      return ok({ response: profile });
    },
    updateConfigProfile: async (body: { uuid: string; config?: unknown; name?: string }) => {
      if (options.failUpdateProfile) return { status: 502, error: "profile update failed" };
      const p = state.profiles.find((x) => x.uuid === body.uuid);
      if (!p) return { status: 404, error: "not found" };
      if (body.name !== undefined) p.name = body.name;
      if (body.config !== undefined) {
        p.config = body.config;
        const managedTags = ((body.config as { inbounds: Array<{ tag: string }> }).inbounds ?? [])
          .filter((ib) => ib.tag.startsWith("LAZEIKA_ONLY_INBOUND"))
          .map((ib) => ib.tag);
        p.inbounds = managedTags.map((t) => ({ uuid: ensureInboundUuid(t), tag: t, port: 40001 }));
      }
      return ok(p);
    },
    deleteConfigProfile: async (uuid: string) => {
      state.profiles = state.profiles.filter((p) => p.uuid !== uuid);
      state.calls.deleted.push(`profile:${uuid}`);
      return ok({});
    },
    updateNode: async (body: Record<string, unknown>) => {
      const n = state.nodes.find((x) => x.uuid === body.uuid);
      if (!n) return { status: 404, error: "node not found" };
      const patch = body.configProfile as Record<string, unknown> | undefined;
      if (patch) {
        n.configProfile = {
          activeConfigProfileUuid: (patch.activeConfigProfileUuid as string | null | undefined) ?? null,
          activeInbounds: (patch.activeInbounds ?? []) as string[],
        };
      }
      state.updateNodeBodies.push(body);
      return ok({ ...n });
    },
    getInternalSquads: async () => ok({ response: { internalSquads: state.squads } }),
    createInternalSquad: async (body: { name: string; inbounds: string[] }) => {
      const squad = { uuid: nextUuid(), name: body.name, inbounds: body.inbounds.map((u) => ({ uuid: u })) };
      state.squads.push(squad);
      return ok({ response: squad });
    },
    updateInternalSquad: async (body: { uuid: string; inbounds?: string[] }) => {
      const s = state.squads.find((x) => x.uuid === body.uuid);
      if (!s) return { status: 404, error: "not found" };
      if (body.inbounds) s.inbounds = body.inbounds.map((u) => ({ uuid: u }));
      return ok(s);
    },
    deleteInternalSquad: async (uuid: string) => {
      state.squads = state.squads.filter((s) => s.uuid !== uuid);
      state.calls.deleted.push(`squad:${uuid}`);
      return ok({});
    },
    getSquadAccessibleNodeUuids: async () => ({ data: [NODE_UUID], error: undefined }),
    getHosts: async () => ok({ response: { hosts: state.hosts } }),
    createHost: async (body: Record<string, unknown>) => {
      const host = { ...body, uuid: nextUuid() };
      state.hosts.push(host);
      return ok({ response: host });
    },
    updateHost: async (body: Record<string, unknown>) => {
      const h = state.hosts.find((x) => x.uuid === body.uuid);
      if (!h) return { status: 404, error: "not found" };
      Object.assign(h, body);
      return ok(h);
    },
    deleteHost: async (uuid: string) => {
      state.hosts = state.hosts.filter((h) => h.uuid !== uuid);
      state.calls.deleted.push(`host:${uuid}`);
      return ok({});
    },
  };
  return { remna, state };
}

function createSshFake(options: { failInstall?: boolean; tcFilesExisted?: string } = {}) {
  const scripts: string[] = [];
  const ssh = async (_creds: { host: string; user: string; port: number; password: string }, script: string) => {
    scripts.push(script);
    if (script.startsWith("[ -f")) {
      // probe существования tc-файлов до установки
      return { ok: true, exitCode: 0, stdout: options.tcFilesExisted ?? "TCFILES_NEW", stderr: "" };
    }
    if (options.failInstall && script.includes("lazeika-only-tc")) {
      return { ok: false, exitCode: 7, stdout: "", stderr: "tc netem permission denied" };
    }
    if (script.includes("ip -o route show default")) {
      return { ok: true, exitCode: 0, stdout: "IFACE=eth0\nMODE=host\nTC=ok\n", stderr: "" };
    }
    return { ok: true, exitCode: 0, stdout: "", stderr: "" };
  };
  return { ssh, scripts };
}

/**
 * Fenced-стор: хранит raw-строку состояния; beginSetup/casWrite эмулируют
 * атомарный CAS реальной SystemSetting (сравнение точной строки).
 */
function createFencedStore(initial: Record<string, unknown> = {}) {
  let raw = Object.keys(initial).length ? JSON.stringify(initial) : "";
  const parseRaw = () => {
    try { return resourceStateSchema.parse(raw ? JSON.parse(raw) : {}); }
    catch { return resourceStateSchema.parse({}); }
  };
  const store = {
    loadState: async () => parseRaw(),
    saveState: async (next: unknown) => { raw = JSON.stringify(next); },
    beginSetup: async (): Promise<{ claimed: boolean; token?: string; raw?: string }> => {
      const cur = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      if (cur.status === "APPLYING") {
        const lockedAt = new Date(String(cur.lockedAt ?? 0)).getTime();
        if (Number.isFinite(lockedAt) && Date.now() - lockedAt < 10 * 60_000) return { claimed: false };
      }
      const token = `tok-${Math.random().toString(36).slice(2)}`;
      const next = JSON.stringify({ ...cur, status: "APPLYING", lastError: null, lockToken: token, lockedAt: new Date().toISOString() });
      raw = next;
      return { claimed: true, token, raw: next };
    },
    casWrite: async (expectedRaw: string, next: unknown): Promise<{ ok: boolean; raw: string }> => {
      if (raw !== expectedRaw) return { ok: false, raw };
      raw = JSON.stringify(next);
      return { ok: true, raw };
    },
    /** Прямая подмена raw — только для сценариев «чужой воркер перезахватил». */
    setRaw: (r: string) => { raw = r; },
    get state() { return parseRaw(); },
    get rawValue() { return raw; },
  };
  return store;
}
const createStore = createFencedStore;

/** Общие deps сервиса поверх fenced-стора. */
function fencedDeps(store: ReturnType<typeof createFencedStore>) {
  return {
    loadState: store.loadState,
    saveState: store.saveState,
    beginSetup: store.beginSetup,
    casWrite: store.casWrite,
    readStateRaw: async () => store.rawValue,
    loadNotificationSettings: async () => ({
      messages: [
        "🔐 Доступ к lazeika.xyz и Telegram",
        "⏰ Ваша подписка закончилась!",
        "✅ Доступ сохранён в режиме продления!",
      ],
    }),
  };
}

const SETUP_SSH = { user: "root", port: 22, password: "test-pass" };
const SETUP_INPUT = {
  nodeUuid: NODE_UUID, squadUuid: null as string | null, speedMbit: 5, ssh: SETUP_SSH,
};

test("setup from clean state creates exactly one profile, squad, working host and three notifications", async () => {
  const env = createFakeRemna();
  const sshf = createSshFake();
  const store = createFencedStore();
  const service = createLazeikaService({
    remna: env.remna,
    ssh: sshf.ssh,
    ...fencedDeps(store),
    persistProfileUuid: async () => {},
    persistSquadUuid: async () => {},
    runAtomic: async (fn: (tx: never) => Promise<void>) => fn(undefined as never),
    persistSetupInputs: async () => {},
  });

  const result = await service.setup(SETUP_INPUT);
  assert.equal(result.status, "READY");
  assert.equal(store.state.status, "READY");
  // IN_PLACE: активный профиль ноды расширен, новый профиль НЕ создаётся.
  assert.equal(env.state.profiles.length, 1, "только исходный профиль, расширенный in-place");
  assert.equal(store.state.profileUuid, BASE_PROFILE_UUID);
  // Managed+notification inbound появились в конфиге того же профиля.
  const cfg = env.state.profiles[0].config as { inbounds: Array<{ tag: string; port: number }>; routing: { rules: Array<Record<string, unknown>> } };
  assert.ok(cfg.inbounds.some((ib) => ib.tag === store.state.managedInboundTag));
  assert.ok(cfg.inbounds.some((ib) => ib.tag === store.state.notifInboundTag));
  assert.equal(env.state.squads.length, 1);
  assert.equal(env.state.squads[0].name, "Lazeika-Only");
  assert.deepEqual(env.state.squads[0].inbounds, [{ uuid: store.state.managedInboundUuid }, { uuid: store.state.notifInboundUuid }]);
  // нода остаётся на своём активном профиле + managed/notif inbound добавлены к прежним
  assert.equal(env.state.nodes[0].configProfile?.activeConfigProfileUuid, store.state.profileUuid);
  assert.ok(env.state.nodes[0].configProfile?.activeInbounds?.includes(store.state.managedInboundUuid ?? ""));
  assert.ok(env.state.nodes[0].configProfile?.activeInbounds?.includes("inbound-base-uuid"));
  // PATCH ноды уходит во вложенном контракте configProfile (не плоские поля)
  const appliedPatch = env.state.updateNodeBodies.find((b) => b.configProfile && (b.configProfile as { activeConfigProfileUuid?: string }).activeConfigProfileUuid === store.state.profileUuid);
  assert.ok(appliedPatch, "updateNode body must use nested configProfile");
  assert.deepEqual(
    (appliedPatch!.configProfile as { activeInbounds: string[] }).activeInbounds.sort(),
    ["inbound-base-uuid", store.state.managedInboundUuid, store.state.notifInboundUuid!].sort(),
  );
  const lazeikaHosts = env.state.hosts.filter((h) => (h.tags as string[])?.includes("LAZEIKA_ONLY"));
  assert.equal(lazeikaHosts.length, 4);
  // Fake-hosts ВИДИМЫ в подписке (isDisabled=false), адреса нерабочие.
  assert.equal(lazeikaHosts.filter((h) => !h.isDisabled).length, 4);
  const notifications = (lazeikaHosts as Array<{ tags?: string[]; remark?: string; address?: string; inbound?: Record<string, string>; isDisabled?: boolean }>).filter((h) => h.tags?.includes("LAZEIKA_ONLY_NOTIFICATION"));
  assert.equal(notifications.length, 3);
  assert.deepEqual(notifications.map((h) => h.remark).sort(), [
    "🔐 Доступ к lazeika.xyz и Telegram",
    "⏰ Ваша подписка закончилась!",
    "✅ Доступ сохранён в режиме продления!",
  ].sort());
  assert.ok(notifications.every((h) => String(h.address).endsWith(".invalid")));
  assert.ok(notifications.every((h) => (h.inbound as Record<string, string>)?.configProfileInboundUuid === store.state.notifInboundUuid));
  // рабочий host наследует технические параметры базового и указывает на managed inbound
  const working = lazeikaHosts.find((h) => !h.isDisabled)!;
  assert.equal(working.address, "vpn.example.com");
  assert.equal(working.sni, "vpn.example.com");
  assert.equal((working.inbound as Record<string, string>).configProfileUuid, store.state.profileUuid);
  // ssh установил tc с интерфейсом eth0
  assert.equal(store.state.ssh.interface, "eth0");
  assert.ok(sshf.scripts.some((s) => s.includes("tc filter replace")));
});

test("second setup does not duplicate resources", async () => {
  const env = createFakeRemna();
  const sshf = createSshFake();
  const store = createFencedStore();
  const service = createLazeikaService({
    remna: env.remna, ssh: sshf.ssh,
    ...fencedDeps(store), persistProfileUuid: async () => {},
    persistSquadUuid: async () => {},
    runAtomic: async (fn: (tx: never) => Promise<void>) => fn(undefined as never),
    persistSetupInputs: async () => {},
  });
  await service.setup(SETUP_INPUT);
  const snapshot = {
    profiles: env.state.profiles.length,
    squads: env.state.squads.length,
    hosts: env.state.hosts.length,
  };
  await service.setup(SETUP_INPUT);
  assert.equal(env.state.profiles.length, snapshot.profiles);
  assert.equal(env.state.squads.length, snapshot.squads);
  assert.equal(env.state.hosts.length, snapshot.hosts);
});

test("manual squad containing foreign inbounds is rejected without changes", async () => {
  const env = createFakeRemna();
  env.state.squads.push({
    uuid: MANUAL_SQUAD_UUID,
    name: "Manual",
    inbounds: [{ uuid: "foreign-inbound" }],
  });
  const store = createFencedStore();
  const service = createLazeikaService({
    remna: env.remna, ssh: createSshFake().ssh,
    ...fencedDeps(store), persistProfileUuid: async () => {},
    persistSquadUuid: async () => {},
    runAtomic: async (fn: (tx: never) => Promise<void>) => fn(undefined as never),
    persistSetupInputs: async () => {},
  });
  await assert.rejects(
    () => service.setup({ ...SETUP_INPUT, squadUuid: MANUAL_SQUAD_UUID }),
    /чужие inbounds/,
  );
  assert.equal(store.state.status, "ERROR");
  // нода не была изменена
  assert.equal(env.state.nodes[0].configProfile?.activeConfigProfileUuid, BASE_PROFILE_UUID);
});

test("rollback restores the node after a Remna profile failure", async () => {
  const env = createFakeRemna({ failUpdateProfile: true });
  const store = createFencedStore();
  const service = createLazeikaService({
    remna: env.remna, ssh: createSshFake().ssh,
    ...fencedDeps(store), persistProfileUuid: async () => {},
    persistSquadUuid: async () => {},
    runAtomic: async (fn: (tx: never) => Promise<void>) => fn(undefined as never),
    persistSetupInputs: async () => {},
  });
  await assert.rejects(() => service.setup(SETUP_INPUT), /profile update failed/);
  assert.equal(store.state.status, "ERROR");
  assert.match(store.state.lastError ?? "", /\[PROFILE\]/);
  assert.equal(env.state.nodes[0].configProfile?.activeConfigProfileUuid, BASE_PROFILE_UUID);
  assert.deepEqual(env.state.nodes[0].configProfile?.activeInbounds, ["inbound-base-uuid"]);
  assert.equal(env.state.squads.length, 0);
});

test("rollback removes only resources created by the failed run after an SSH failure", async () => {
  const env = createFakeRemna();
  const sshf = createSshFake({ failInstall: true });
  const store = createFencedStore();
  const service = createLazeikaService({
    remna: env.remna, ssh: sshf.ssh,
    ...fencedDeps(store), persistProfileUuid: async () => {},
    persistSquadUuid: async () => {},
    runAtomic: async (fn: (tx: never) => Promise<void>) => fn(undefined as never),
    persistSetupInputs: async () => {},
  });
  const persistedSquadUuids: Array<string | null> = [];
  // переопределяем сервис с записью persistSquadUuid
  const service2 = createLazeikaService({
    remna: env.remna, ssh: sshf.ssh,
    ...fencedDeps(store),
    persistProfileUuid: async () => {},
    persistSquadUuid: async (uuid) => { persistedSquadUuids.push(uuid); },
    runAtomic: async (fn: (tx: never) => Promise<void>) => fn(undefined as never),
    persistSetupInputs: async () => {},
  });
  await assert.rejects(() => service2.setup(SETUP_INPUT), /tc-фильтры/);
  assert.equal(store.state.status, "ERROR");
  assert.match(store.state.lastError ?? "", /\[SSH_TC\]/);
  // созданные этим запуском ресурсы удалены (IN_PLACE: профиль НЕ создаётся — только squad+hosts)
  const deletedKinds = env.state.calls.deleted.map((d) => d.split(":")[0]);
  assert.deepEqual(deletedKinds.sort(), ["host", "host", "host", "host", "squad"].sort());
  assert.equal(env.state.profiles.length, 1);
  assert.equal(env.state.squads.length, 0);
  // stale auto-squad UUID сброшен в state и в настройках — иначе повторный setup вечно падает
  assert.equal(store.state.squadUuid, null);
  assert.ok(persistedSquadUuids.includes(null), "persisted squad uuid cleared");
  // tc-cleanup отправлен: свои pref'ы + unit
  const cleanup = sshf.scripts.find((sc) => sc.includes("systemctl disable --now lazeika-only-tc.service"));
  assert.ok(cleanup, "tc cleanup script sent");
  assert.match(cleanup!, /tc filter del dev "eth0" ingress pref 11000/);
  assert.match(cleanup!, /tc filter del dev "eth0" egress pref 11007/);
  assert.match(cleanup!, /tc action del action police index 45101/);
  assert.match(cleanup!, /tc action del action police index 45102/);
  // нода восстановлена
  assert.equal(env.state.nodes[0].configProfile?.activeConfigProfileUuid, BASE_PROFILE_UUID);
});

test("auto-created squad uuid is persisted to settings for mergeSquads", async () => {
  const env = createFakeRemna();
  const sshf = createSshFake();
  const store = createFencedStore();
  const persisted: Array<string | null> = [];
  const service = createLazeikaService({
    remna: env.remna, ssh: sshf.ssh,
    ...fencedDeps(store),
    persistProfileUuid: async () => {},
    persistSquadUuid: async (uuid) => { persisted.push(uuid); },
    runAtomic: async (fn: (tx: never) => Promise<void>) => fn(undefined as never),
    persistSetupInputs: async () => {},
  });
  await service.setup(SETUP_INPUT);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0], store.state.squadUuid);
});

test("reconcile recreates missing hosts without duplicating existing ones", async () => {
  const env = createFakeRemna();
  const sshf = createSshFake();
  const store = createFencedStore();
  const service = createLazeikaService({
    remna: env.remna, ssh: sshf.ssh,
    ...fencedDeps(store), persistProfileUuid: async () => {},
    persistSquadUuid: async () => {},
    runAtomic: async (fn: (tx: never) => Promise<void>) => fn(undefined as never),
    persistSetupInputs: async () => {},
  });
  await service.setup(SETUP_INPUT);
  // админ удалил все хосты вручную
  const before = env.state.hosts.length;
  env.state.hosts = [];
  await service.setup(SETUP_INPUT);
  const lazeikaHosts = env.state.hosts.filter((h) => (h.tags as string[])?.includes("LAZEIKA_ONLY"));
  assert.equal(lazeikaHosts.length, 4, "рабочий + 3 notification пересозданы");
  assert.ok(env.state.profiles.length <= 2, "профиль не дублируется");
  void before;
});

test("parallel setup is rejected by fresh APPLYING lock of another worker", async () => {
  const env = createFakeRemna();
  const sshf = createSshFake();
  const store = createFencedStore();
  // «Чужой» воркер только что захватил лок — свежий APPLYING.
  store.setRaw(JSON.stringify({
    ...resourceStateSchema.parse({}),
    status: "APPLYING",
    lockToken: "foreign-token",
    lockedAt: new Date().toISOString(),
  }));
  const service = createLazeikaService({
    remna: env.remna, ssh: sshf.ssh,
    ...fencedDeps(store),
    persistProfileUuid: async () => {}, persistSquadUuid: async () => {},
    persistSetupInputs: async () => {},
    runAtomic: async (fn: (tx: never) => Promise<void>) => fn(undefined as never),
  });
  await assert.rejects(() => service.setup(SETUP_INPUT), /уже выполняется/);
  // Состояние чужого лока не тронуто.
  assert.equal(store.state.status, "APPLYING");
  assert.equal(store.state.lockToken, "foreign-token");
});

test("node change after READY is rejected with a clear error", async () => {
  const env = createFakeRemna();
  const sshf = createSshFake();
  const store = createFencedStore();
  const service = createLazeikaService({
    remna: env.remna, ssh: sshf.ssh,
    ...fencedDeps(store),
    persistProfileUuid: async () => {}, persistSquadUuid: async () => {},
    runAtomic: async (fn: (tx: never) => Promise<void>) => fn(undefined as never),
    persistSetupInputs: async () => {},
  });
  await service.setup(SETUP_INPUT);
  assert.equal(store.state.status, "READY");
  const otherNode = "99999999-9999-9999-9999-999999999999";
  await assert.rejects(
    () => service.setup({ ...SETUP_INPUT, nodeUuid: otherNode }),
    /Смена ноды/,
  );
  // состояние не изменилось
  assert.equal(store.state.status, "READY");
  assert.equal(store.state.nodeUuid, NODE_UUID);
});

test("failed re-setup restores modified existing profile/hosts and reinstalls previous tc", async () => {
  const env = createFakeRemna();
  const sshf = createSshFake({ tcFilesExisted: "TCFILES_EXIST" });
  const store = createFencedStore();
  let failNow = false;
  const service = createLazeikaService({
    remna: env.remna,
    ssh: async (creds: { host: string }, script: string) => {
      if (script.startsWith("[ -f")) return sshf.ssh(creds as never, script);
      if (failNow && script.includes("lazeika-only-tc")) {
        sshf.scripts.push(script);
        return { ok: false, exitCode: 9, stdout: "", stderr: "boom" };
      }
      return sshf.ssh(creds as never, script);
    },
    ...fencedDeps(store),
    persistProfileUuid: async () => {}, persistSquadUuid: async () => {},
    persistSetupInputs: async () => {},
    runAtomic: async (fn: (tx: never) => Promise<void>) => fn(undefined as never),
  });

  // Успешный setup №1.
  await service.setup(SETUP_INPUT);
  const profileAfterFirst = JSON.parse(JSON.stringify(env.state.profiles.find((p) => p.uuid === store.state.profileUuid)));
  const hostAfterFirst = JSON.parse(JSON.stringify(env.state.hosts.find((h) => h.uuid === store.state.workingHostUuid)));

  // Админ изменил поля host'ов вручную — rollback обязан вернуть ВСЕ изменяемые поля
  // (port/remark/isDisabled/binding/tags), а не только binding+tags (§7 финала).
  const workingNow = env.state.hosts.find((h) => h.uuid === store.state.workingHostUuid) as Record<string, unknown>;
  workingNow.isDisabled = true;
  workingNow.remark = "admin changed remark";
  workingNow.port = 12345;
  const notifNow = env.state.hosts.find((h) => h.uuid === store.state.notificationHostUuids[0]) as Record<string, unknown>;
  notifNow.remark = "admin custom notif";
  notifNow.port = 23456;
  const notifSnap = JSON.parse(JSON.stringify(notifNow));

  // Повторный setup падает на tc — но уже изменил существующие профиль/hosts.
  failNow = true;
  await assert.rejects(() => service.setup(SETUP_INPUT), /tc-фильтры/);

  // Профиль восстановлен к снапшоту (конфиг как после первого setup).
  const profileNow = env.state.profiles.find((p) => p.uuid === store.state.profileUuid);
  assert.equal(profileNow?.name, profileAfterFirst.name);
  assert.deepEqual(profileNow?.config, profileAfterFirst.config);
  // Binding рабочего host'а восстановлен.
  const hostNow = env.state.hosts.find((h) => h.uuid === store.state.workingHostUuid);
  assert.deepEqual(hostNow?.inbound, hostAfterFirst.inbound);
  assert.deepEqual(hostNow?.tags, hostAfterFirst.tags);
  // …и все остальные изменяемые поля — к значениям на момент запуска.
  assert.equal(hostNow?.isDisabled, true, "isDisabled восстановлен");
  assert.equal(hostNow?.remark, "admin changed remark", "remark восстановлен");
  assert.equal(hostNow?.port, 12345, "port восстановлен");
  const notifAfter = env.state.hosts.find((h) => h.uuid === store.state.notificationHostUuids[0]);
  assert.equal(notifAfter?.remark, notifSnap.remark, "notif remark восстановлен");
  assert.equal(notifAfter?.port, notifSnap.port, "notif port восстановлен");
  // tc НЕ сносился: cleanup отсутствует, вместо него restore-установка прежнего лимита.
  assert.ok(!sshf.scripts.some((sc) => sc.includes("systemctl disable --now lazeika-only-tc.service")), "cleanup не должен запускаться при существовавшем лимитере");
  assert.ok(sshf.scripts.filter((sc) => sc.includes("police rate 5mbit")).length >= 2, "restore переустановил прежний rate");
});

test("expired lease is reclaimed by a new worker", async () => {
  const store = createFencedStore();
  // Чужой APPLYING, но lockedAt 11 минут назад → lease протух.
  store.setRaw(JSON.stringify({
    ...resourceStateSchema.parse({}),
    status: "APPLYING",
    lockToken: "stale-token",
    lockedAt: new Date(Date.now() - 11 * 60_000).toISOString(),
  }));
  const claim = await store.beginSetup();
  assert.equal(claim.claimed, true);
  assert.notEqual(claim.token, "stale-token");
  const parsed = resourceStateSchema.parse(JSON.parse(claim.raw!));
  assert.equal(parsed.status, "APPLYING");
  assert.equal(parsed.lockToken, claim.token);
});

test("stale worker cannot overwrite READY of the new worker", async () => {
  const store = createFencedStore();
  // Воркер A захватил лок.
  const claimA = await store.beginSetup();
  // Lease протух, воркер B перезахватил.
  const rawStale = JSON.stringify(JSON.parse(store.rawValue));
  store.setRaw(JSON.stringify({
    ...JSON.parse(store.rawValue),
    lockedAt: new Date(Date.now() - 15 * 60_000).toISOString(),
  }));
  const claimB = await store.beginSetup();
  assert.equal(claimB.claimed, true);
  // B завершился READY.
  const readyState = { ...resourceStateSchema.parse(JSON.parse(claimB.raw!)), status: "READY" as const };
  await store.casWrite(claimB.raw!, readyState);

  // A (со своим устаревшим raw) пытается записать ERROR поверх — CAS отклоняет.
  const errorState = { ...resourceStateSchema.parse(JSON.parse(rawStale)), status: "ERROR" as const, lastError: "boom" };
  const res = await store.casWrite(claimA.raw!, errorState);
  assert.equal(res.ok, false);
  assert.equal(store.state.status, "READY", "READY нового воркера не затёрт");
});

test("manual deletion of managed profile in IN_PLACE is rejected with a clear error", async () => {
  const env = createFakeRemna();
  const sshf = createSshFake();
  const store = createFencedStore();
  const service = createLazeikaService({
    remna: env.remna, ssh: sshf.ssh,
    ...fencedDeps(store),
    persistProfileUuid: async () => {}, persistSquadUuid: async () => {},
    persistSetupInputs: async () => {},
    runAtomic: async (fn: (tx: never) => Promise<void>) => fn(undefined as never),
  });
  await service.setup(SETUP_INPUT);
  // Админ удалил managed профиль (= активный профиль ноды в IN_PLACE); восстанавливать
  // его «с нуля» нельзя — полного снапшота конфига у нас нет. Ожидаем понятную ошибку.
  env.state.profiles = env.state.profiles.filter((p) => p.uuid !== store.state.profileUuid);
  await assert.rejects(() => service.setup(SETUP_INPUT), /активный config-профиль/);
  assert.equal(store.state.status, "ERROR");
  // Новый профиль не создавался.
  assert.equal(env.state.profiles.length, 0);
});

test("deleted auto-squad is recreated without duplicates", async () => {
  const env = createFakeRemna();
  const sshf = createSshFake();
  const store = createFencedStore();
  const service = createLazeikaService({
    remna: env.remna, ssh: sshf.ssh,
    ...fencedDeps(store),
    persistProfileUuid: async () => {}, persistSquadUuid: async () => {},
    persistSetupInputs: async () => {},
    runAtomic: async (fn: (tx: never) => Promise<void>) => fn(undefined as never),
  });
  await service.setup(SETUP_INPUT);
  // Админ удалил авто-squad.
  env.state.squads = [];
  await service.setup(SETUP_INPUT);
  const squads = env.state.squads.filter((sq) => sq.name === "Lazeika-Only");
  assert.equal(squads.length, 1, "ровно один auto-squad после пересоздания");
  assert.equal(store.state.squadUuid, squads[0]!.uuid);
  assert.equal(store.state.status, "READY");
});

test("stale worker cannot overwrite READY/ERROR written by the new worker (service-level)", async () => {
  const env = createFakeRemna();
  const sshf = createSshFake();
  const store = createFencedStore();
  // Воркер B успешно настраивает всё.
  const serviceB = createLazeikaService({
    remna: env.remna, ssh: sshf.ssh,
    ...fencedDeps(store),
    persistProfileUuid: async () => {}, persistSquadUuid: async () => {},
    persistSetupInputs: async () => {},
    runAtomic: async (fn: (tx: never) => Promise<void>) => fn(undefined as never),
  });
  await serviceB.setup(SETUP_INPUT);
  assert.equal(store.state.status, "READY");

  // Воркер A стартовал ДО B, его claim-raw устарел; Remna у него падает на обновлении профиля.
  const staleClaim = { claimed: true, token: "worker-a", raw: JSON.stringify({ ...resourceStateSchema.parse({}), status: "APPLYING", lockToken: "worker-a", lockedAt: new Date().toISOString() }) };
  const serviceA = createLazeikaService({
    remna: { ...env.remna, updateConfigProfile: async () => ({ status: 502, error: "boom" }) },
    ssh: sshf.ssh,
    loadState: store.loadState,
    saveState: store.saveState,
    beginSetup: async () => staleClaim,
    casWrite: store.casWrite,
    readStateRaw: async () => store.rawValue,
    loadNotificationSettings: async () => ({ messages: ["m1", "m2", "m3"] }),
    persistProfileUuid: async () => {}, persistSquadUuid: async () => {},
    persistSetupInputs: async () => {},
    runAtomic: async (fn: (tx: never) => Promise<void>) => fn(undefined as never),
  });
  // A выбывает на первом heartbeat с LOCK_LOST, не создав НИЧЕГО и не тронув READY воркера B.
  await assert.rejects(() => serviceA.setup(SETUP_INPUT), /LOCK_LOST: lease потерян/);
  assert.equal(store.state.status, "READY");
  assert.equal(env.state.profiles.length, 1, "IN_PLACE: новый профиль не создаётся");
});

test("node change from ERROR state with managed traces is rejected", async () => {
  const env = createFakeRemna();
  const sshf = createSshFake();
  const store = createFencedStore();
  const service = createLazeikaService({
    remna: env.remna, ssh: sshf.ssh,
    ...fencedDeps(store),
    persistProfileUuid: async () => {}, persistSquadUuid: async () => {},
    persistSetupInputs: async () => {},
    runAtomic: async (fn: (tx: never) => Promise<void>) => fn(undefined as never),
  });
  // Успешный setup, затем искусственный ERROR (инфраструктурные ссылки остаются в state).
  await service.setup(SETUP_INPUT);
  store.setRaw(JSON.stringify({ ...store.state, status: "ERROR", lastError: "[SSH_TC] x" }));
  const otherNode = "99999999-9999-9999-9999-999999999999";
  await assert.rejects(
    () => service.setup({ ...SETUP_INPUT, nodeUuid: otherNode }),
    /reset-state/,
  );
  assert.equal(store.state.status, "ERROR");
});

test("reconcile with stale auto-squad uuid in state recreates the squad", async () => {
  const env = createFakeRemna();
  const sshf = createSshFake();
  const store = createFencedStore();
  const service = createLazeikaService({
    remna: env.remna, ssh: sshf.ssh,
    ...fencedDeps(store),
    persistProfileUuid: async () => {}, persistSquadUuid: async () => {},
    persistSetupInputs: async () => {},
    runAtomic: async (fn: (tx: never) => Promise<void>) => fn(undefined as never),
  });
  await service.setup(SETUP_INPUT);
  const oldSquadUuid = store.state.squadUuid;
  env.state.squads = []; // админ удалил auto-squad
  // Повторный setup: state.squadUuid указывает на удалённый (как reconcile-маршрут).
  await service.setup(SETUP_INPUT);
  const squads = env.state.squads.filter((sq) => sq.name === "Lazeika-Only");
  assert.equal(squads.length, 1);
  assert.notEqual(store.state.squadUuid, oldSquadUuid);

  // Пустой accessible-nodes НЕ считается успехом (§7 ревью).
  env.state.squads = []; // чистый лист для строгого под-теста
  const serviceStrict = createLazeikaService({
    remna: { ...env.remna, getSquadAccessibleNodeUuids: async () => ({ data: [], error: undefined }) },
    ssh: sshf.ssh,
    ...fencedDeps(store),
    persistProfileUuid: async () => {}, persistSquadUuid: async () => {},
    persistSetupInputs: async () => {},
    runAtomic: async (fn: (tx: never) => Promise<void>) => fn(undefined as never),
  });
  store.setRaw(JSON.stringify({ ...resourceStateSchema.parse({}), status: "READY", nodeUuid: NODE_UUID }));
  delete (serviceStrict as unknown as Record<string, unknown>).noop;
  await assert.rejects(
    () => serviceStrict.setup({ ...SETUP_INPUT, squadUuid: null }),
    /ровно на выбранной ноде/,
  );
});

test("remoteInstall has top-level set -euo and verifies systemd enabled", async () => {
  const env = createFakeRemna();
  const sshf = createSshFake();
  const store = createFencedStore();
  const service = createLazeikaService({
    remna: env.remna, ssh: sshf.ssh,
    ...fencedDeps(store),
    persistProfileUuid: async () => {}, persistSquadUuid: async () => {},
    persistSetupInputs: async () => {},
    runAtomic: async (fn: (tx: never) => Promise<void>) => fn(undefined as never),
  });
  await service.setup(SETUP_INPUT);
  const install = sshf.scripts.find((sc) => sc.includes("systemctl enable --now"));
  assert.ok(install, "install script sent");
  assert.match(install!, /^set -euo pipefail/);
  assert.match(install!, /systemctl is-enabled --quiet lazeika-only-tc\.service \|\| \{ echo UNIT_NOT_ENABLED; exit 1; \}/);
});

test("reconcile keeps fake notification hosts visible and rebinds them to notif inbound", async () => {
  const env = createFakeRemna();
  const sshf = createSshFake();
  const store = createFencedStore();
  const service = createLazeikaService({
    remna: env.remna, ssh: sshf.ssh,     ...fencedDeps(store),
    persistProfileUuid: async () => {}, persistSquadUuid: async () => {},
    persistSetupInputs: async () => {},
    runAtomic: async (fn: (tx: never) => Promise<void>) => fn(undefined as never),
  });
  await service.setup(SETUP_INPUT);
  // Админ «сломал» один fake-host: включил и отвязал.
  const notif = (env.state.hosts as Array<{ uuid: string; tags?: string[]; isDisabled?: boolean; inbound?: Record<string, string> | null }>)
    .find((h) => h.tags?.includes("LAZEIKA_ONLY_NOTIFICATION"))!;
  notif.isDisabled = true;
  notif.inbound = null;
  await service.setup(SETUP_INPUT);
  assert.equal(notif.isDisabled, false, "fake-host остаётся видимым в подписке");
  const rebound = notif.inbound as Record<string, string> | null;
  assert.equal(rebound?.configProfileInboundUuid, store.state.notifInboundUuid, "binding восстановлен к notif inbound");
});

test("IN_PLACE drift: admin switched node active profile -> setup rejects without mutations", async () => {
  const env = createFakeRemna();
  const sshf = createSshFake();
  const store = createFencedStore();
  const service = createLazeikaService({
    remna: env.remna, ssh: sshf.ssh,
    ...fencedDeps(store),
    persistProfileUuid: async () => {}, persistSquadUuid: async () => {},
    persistSetupInputs: async () => {},
    runAtomic: async (fn: (tx: never) => Promise<void>) => fn(undefined as never),
  });
  // Первый setup в IN_PLACE: profileUuid == активный профиль ноды.
  await service.setup(SETUP_INPUT);
  assert.equal(env.state.nodes[0].configProfile?.activeConfigProfileUuid, store.state.profileUuid);
  // Админ вручную переключил ноду на ДРУГОЙ (сторонний) профиль.
  env.state.profiles.push({
    uuid: "77777777-7777-4777-8777-777777777777",
    name: "Other",
    config: { inbounds: [baseInbound], outbounds: [{ protocol: "blackhole", tag: "BLOCK" }], routing: { rules: [] } },
    inbounds: [{ uuid: "inbound-other-uuid", tag: baseInbound.tag, port: 443 }],
  });
  env.state.nodes[0].configProfile!.activeConfigProfileUuid = "77777777-7777-4777-8777-777777777777";
  const profilesBefore = env.state.profiles.length;
  await assert.rejects(
    () => service.setup(SETUP_INPUT),
    /изменён вручную|reset-state/,
  );
  // Мутаций не было.
  assert.equal(env.state.profiles.length, profilesBefore);
});

test("SSH preflight runs BEFORE any Remnawave mutation", async () => {
  const env = createFakeRemna();
  const sshf = createSshFake();
  const store = createFencedStore();
  let sshCalls = 0;
  const service = createLazeikaService({
    remna: {
      ...env.remna,
      updateConfigProfile: async (body: { uuid: string; name?: string; config?: unknown }) => {
        assert.ok(sshCalls >= 1, "preflight должен выполниться до первой мутации профиля");
        return env.remna.updateConfigProfile(body);
      },
    },
    ssh: async (_creds, script) => { sshCalls++; return sshf.ssh({ host: "x" } as never, script); },
    ...fencedDeps(store),
    persistProfileUuid: async () => {}, persistSquadUuid: async () => {},
    persistSetupInputs: async () => {},
    runAtomic: async (fn: (tx: never) => Promise<void>) => fn(undefined as never),
  });
  await service.setup(SETUP_INPUT);
  assert.ok(sshCalls >= 1);
});

test("notification fake-hosts are created with numeric notif port (not null)", async () => {
  const env = createFakeRemna();
  const sshf = createSshFake();
  const store = createFencedStore();
  const service = createLazeikaService({
    remna: env.remna, ssh: sshf.ssh,
    ...fencedDeps(store),
    persistProfileUuid: async () => {}, persistSquadUuid: async () => {},
    persistSetupInputs: async () => {},
    runAtomic: async (fn: (tx: never) => Promise<void>) => fn(undefined as never),
  });
  await service.setup(SETUP_INPUT);
  const notifications = (env.state.hosts as Array<{ tags?: string[]; port?: number | null }>)
    .filter((h) => h.tags?.includes("LAZEIKA_ONLY_NOTIFICATION"));
  assert.equal(notifications.length, 3);
  for (const h of notifications) {
    assert.equal(typeof h.port, "number", `port обязателен (${h.port})`);
  }
});

/** Общий хелпер сборки сервиса поверх fake-окружения. */
function buildService(env: ReturnType<typeof createFakeRemna>, sshf: ReturnType<typeof createSshFake>, store: ReturnType<typeof createFencedStore>, remnaOverride?: Record<string, unknown>) {
  return createLazeikaService({
    remna: { ...env.remna, ...(remnaOverride ?? {}) } as typeof env.remna,
    ssh: sshf.ssh,
    ...fencedDeps(store),
    persistProfileUuid: async () => {}, persistSquadUuid: async () => {},
    persistSetupInputs: async () => {},
    runAtomic: async (fn: (tx: never) => Promise<void>) => fn(undefined as never),
  });
}

function profileConfig(env: ReturnType<typeof createFakeRemna>["state"], uuid: string) {
  return env.profiles.find((p) => p.uuid === uuid)?.config as {
    inbounds: Array<{ tag?: string; port?: number }>;
    routing: { rules: Array<Record<string, unknown>> };
  };
}

test("second setup keeps notification port stable; all three host ports match it", async () => {
  const env = createFakeRemna();
  const sshf = createSshFake();
  const store = createFencedStore();
  const service = buildService(env, sshf, store);

  await service.setup(SETUP_INPUT);
  const notifPortFirst = store.state.notificationHostUuids.map(
    (u) => (env.state.hosts.find((h) => h.uuid === u) as { port?: number })?.port,
  );
  assert.equal(new Set(notifPortFirst).size, 1, "все три fake-host имеют один порт");
  const cfgFirst = profileConfig(env.state, store.state.profileUuid!);
  const inboundPortFirst = cfgFirst.inbounds.find((ib) => ib.tag === store.state.notifInboundTag)?.port;
  assert.equal(notifPortFirst[0], inboundPortFirst, "порт host'ов == порт notification-inbound");

  await service.setup(SETUP_INPUT);
  const cfgSecond = profileConfig(env.state, store.state.profileUuid!);
  const inboundPortSecond = cfgSecond.inbounds.find((ib) => ib.tag === store.state.notifInboundTag)?.port;
  assert.equal(inboundPortSecond, inboundPortFirst, "повторный setup НЕ сменил порт notification-inbound");
  const notifPortSecond = store.state.notificationHostUuids.map(
    (u) => (env.state.hosts.find((h) => h.uuid === u) as { port?: number })?.port,
  );
  assert.deepEqual(notifPortSecond.sort(), notifPortFirst.sort(), "порты fake-host'ов не изменились");
  assert.ok(notifPortSecond.every((p) => p === inboundPortSecond), "host port == inbound port после reconcile");
});

test("foreign notification-tagged host is never captured or modified", async () => {
  const env = createFakeRemna();
  const sshf = createSshFake();
  const store = createFencedStore();
  // Чужой host с нашим notification-тегом — не должен быть захвачен.
  const foreign = {
    uuid: "44444444-4444-4444-4444-444444444444",
    remark: "foreign keep me",
    address: "foreign.example.com",
    port: 8443,
    isDisabled: true,
    inbound: { configProfileUuid: BASE_PROFILE_UUID, configProfileInboundUuid: "inbound-base-uuid" },
    tags: ["LAZEIKA_ONLY_NOTIFICATION"],
  };
  env.state.hosts.push({ ...foreign });
  const service = buildService(env, sshf, store);

  await service.setup(SETUP_INPUT);
  await service.setup(SETUP_INPUT); // и reconcile тоже не трогает чужой host

  const foreignNow = env.state.hosts.find((h) => h.uuid === foreign.uuid);
  assert.deepEqual(foreignNow, foreign, "чужой host не изменён");
  assert.equal(store.state.notificationHostUuids.length, 3, "ровно три СВОИХ UUID в state");
  assert.ok(!store.state.notificationHostUuids.includes(foreign.uuid), "чужой UUID не захвачен");
});

test("null remark of owned notification host is overwritten from settings on reconcile", async () => {
  const env = createFakeRemna();
  const sshf = createSshFake();
  const store = createFencedStore();
  const service = buildService(env, sshf, store);
  await service.setup(SETUP_INPUT);
  // Админ/панель обнулила remark второго fake-host'а (null вместо строки).
  const second = env.state.hosts.find((h) => h.uuid === store.state.notificationHostUuids[1]) as Record<string, unknown>;
  second.remark = null;
  await service.setup(SETUP_INPUT);
  assert.equal(second.remark, "⏰ Ваша подписка закончилась!", "null remark приведён к текущему сообщению");
});

test("legacy CLONE state with managed resources is rejected without silent conversion", async () => {
  const env = createFakeRemna();
  const sshf = createSshFake();
  const store = createFencedStore();
  store.setRaw(JSON.stringify(resourceStateSchema.parse({
    status: "READY",
    profileMode: "CLONE",
    nodeUuid: NODE_UUID,
    profileUuid: BASE_PROFILE_UUID,
    squadUuid: MANUAL_SQUAD_UUID,
    managedInboundUuid: "55555555-5555-4555-8555-555555555555",
  })));
  const service = buildService(env, sshf, store);
  await assert.rejects(() => service.setup(SETUP_INPUT), /CLONE|reset-state/);
  // Состояние и инфраструктура не тронуты.
  assert.equal(store.state.status, "READY");
  assert.equal(store.state.profileMode, "CLONE");
  assert.equal(env.state.updateNodeBodies.length, 0);
});

test("managed port shared with another inbound is rejected before mutations", async () => {
  const env = createFakeRemna();
  const sshf = createSshFake();
  const store = createFencedStore();
  const service = buildService(env, sshf, store);
  await service.setup(SETUP_INPUT);
  const managedPort = store.state.managedInboundPort!;
  // Админ вручную добавил inbound на тот же порт — tc-лимит задел бы чужой трафик.
  const cfg = profileConfig(env.state, store.state.profileUuid!);
  cfg.inbounds.push({ tag: "FOREIGN-SAME-PORT", port: managedPort });
  const installScriptsBefore = sshf.scripts.filter((s) => s.includes("systemctl enable --now")).length;

  await assert.rejects(() => service.setup(SETUP_INPUT), /уже используется|reset-state/);
  const installScriptsAfter = sshf.scripts.filter((s) => s.includes("systemctl enable --now")).length;
  assert.equal(installScriptsAfter, installScriptsBefore, "tc-установка не запускалась повторно");
});

test("lease lost in the middle of rollback stops compensation immediately", async () => {
  const env = createFakeRemna();
  const sshf = createSshFake({ failInstall: true });
  const store = createFencedStore();
  let deleteCount = 0;
  const service = buildService(env, sshf, store, {
    deleteHost: async (uuid: string) => {
      deleteCount++;
      if (deleteCount === 2) {
        // Другой воркер перезахватил lease прямо посередине rollback.
        store.setRaw(JSON.stringify({
          ...resourceStateSchema.parse({}),
          status: "APPLYING",
          lockToken: "other-worker",
          lockedAt: new Date().toISOString(),
        }));
      }
      return env.remna.deleteHost(uuid);
    },
  });
  await assert.rejects(() => service.setup(SETUP_INPUT), /tc-фильтры/);
  assert.equal(deleteCount, 2, "после LOCK_LOST компенсационные удаления прекращены");
  // Оставшиеся созданные ресурсы (2 host'а и squad) НЕ тронуты — их удалит новый владелец.
  assert.equal(env.state.calls.deleted.length, 2);
  assert.equal(env.state.squads.length, 1, "squad не удалён чужим воркером");
  // ERROR поверх чужого APPLYING не записан.
  assert.equal(store.state.lockToken, "other-worker");
});

test("rollback restores manual squad inbounds to the pre-setup snapshot", async () => {
  const env = createFakeRemna();
  env.state.squads.push({ uuid: MANUAL_SQUAD_UUID, name: "Manual", inbounds: [] });
  const sshf = createSshFake({ failInstall: true });
  const store = createFencedStore();
  const service = buildService(env, sshf, store);
  await assert.rejects(
    () => service.setup({ ...SETUP_INPUT, squadUuid: MANUAL_SQUAD_UUID }),
    /tc-фильтры/,
  );
  const squad = env.state.squads.find((s) => s.uuid === MANUAL_SQUAD_UUID);
  assert.deepEqual(squad?.inbounds, [], "inbounds ручного squad восстановлены");
  // Созданные hosts удалены, squad остался.
  assert.equal(env.state.calls.deleted.filter((d) => d.startsWith("host:")).length, 4);
});
