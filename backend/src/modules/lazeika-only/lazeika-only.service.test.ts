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
  const ssh = async (_address: string, script: string) => {
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
  };
}

const SSH_ENV = { privateKeyPath: "/keys/id_ed25519", user: "root", port: 22, knownHostsFile: "/keys/known_hosts" };
const SETUP_INPUT = { nodeUuid: NODE_UUID, squadUuid: null as string | null, speedMbit: 5 };

test("setup from clean state creates exactly one profile, squad, working host and three notifications", async () => {
  const env = createFakeRemna();
  const sshf = createSshFake();
  const store = createFencedStore();
  const service = createLazeikaService({
    remna: env.remna,
    ssh: sshf.ssh,
    sshEnvLoader: () => SSH_ENV,
    ...fencedDeps(store),
    persistProfileUuid: async () => {},
    persistSquadUuid: async () => {},
    runAtomic: async (fn: (tx: never) => Promise<void>) => fn(undefined as never),
    persistSetupInputs: async () => {},
  });

  const result = await service.setup(SETUP_INPUT);
  assert.equal(result.status, "READY");
  assert.equal(store.state.status, "READY");
  assert.equal(env.state.profiles.length, 2, "base + один managed профиль");
  assert.match(env.state.profiles[1].name as string, /^Lazeika-Only — Alpha$/);
  assert.equal(env.state.squads.length, 1);
  assert.equal(env.state.squads[0].name, "Lazeika-Only");
  assert.deepEqual(env.state.squads[0].inbounds, [{ uuid: store.state.managedInboundUuid }]);
  // нода переключена на managed профиль + managed inbound добавлен к прежним
  assert.equal(env.state.nodes[0].configProfile?.activeConfigProfileUuid, store.state.profileUuid);
  assert.ok(env.state.nodes[0].configProfile?.activeInbounds?.includes(store.state.managedInboundUuid ?? ""));
  assert.ok(env.state.nodes[0].configProfile?.activeInbounds?.includes("inbound-base-uuid"));
  // PATCH ноды уходит во вложенном контракте configProfile (не плоские поля)
  const appliedPatch = env.state.updateNodeBodies.find((b) => b.configProfile && (b.configProfile as { activeConfigProfileUuid?: string }).activeConfigProfileUuid === store.state.profileUuid);
  assert.ok(appliedPatch, "updateNode body must use nested configProfile");
  assert.deepEqual((appliedPatch!.configProfile as { activeInbounds: string[] }).activeInbounds.sort(), ["inbound-base-uuid", store.state.managedInboundUuid].sort());
  const lazeikaHosts = env.state.hosts.filter((h) => (h.tags as string[])?.includes("LAZEIKA_ONLY"));
  assert.equal(lazeikaHosts.length, 4);
  assert.equal(lazeikaHosts.filter((h) => h.isDisabled).length, 3);
  const notifications = lazeikaHosts.filter((h) => h.isDisabled);
  assert.deepEqual(notifications.map((h) => h.remark).sort(), [...NOTIFICATION_REMARKS].sort());
  assert.ok(notifications.every((h) => String(h.address).endsWith(".invalid")));
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
    remna: env.remna, ssh: sshf.ssh, sshEnvLoader: () => SSH_ENV,
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
    remna: env.remna, ssh: createSshFake().ssh, sshEnvLoader: () => SSH_ENV,
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
  const env = createFakeRemna({ failCreateProfile: true });
  const store = createFencedStore();
  const service = createLazeikaService({
    remna: env.remna, ssh: createSshFake().ssh, sshEnvLoader: () => SSH_ENV,
    ...fencedDeps(store), persistProfileUuid: async () => {},
    persistSquadUuid: async () => {},
    runAtomic: async (fn: (tx: never) => Promise<void>) => fn(undefined as never),
    persistSetupInputs: async () => {},
  });
  await assert.rejects(() => service.setup(SETUP_INPUT), /profile create failed/);
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
    remna: env.remna, ssh: sshf.ssh, sshEnvLoader: () => SSH_ENV,
    ...fencedDeps(store), persistProfileUuid: async () => {},
    persistSquadUuid: async () => {},
    runAtomic: async (fn: (tx: never) => Promise<void>) => fn(undefined as never),
    persistSetupInputs: async () => {},
  });
  const persistedSquadUuids: Array<string | null> = [];
  // переопределяем сервис с записью persistSquadUuid
  const service2 = createLazeikaService({
    remna: env.remna, ssh: sshf.ssh, sshEnvLoader: () => SSH_ENV,
    ...fencedDeps(store),
    persistProfileUuid: async () => {},
    persistSquadUuid: async (uuid) => { persistedSquadUuids.push(uuid); },
    runAtomic: async (fn: (tx: never) => Promise<void>) => fn(undefined as never),
    persistSetupInputs: async () => {},
  });
  await assert.rejects(() => service2.setup(SETUP_INPUT), /tc-фильтры/);
  assert.equal(store.state.status, "ERROR");
  assert.match(store.state.lastError ?? "", /\[SSH_TC\]/);
  // созданные этим запуском ресурсы удалены
  const deletedKinds = env.state.calls.deleted.map((d) => d.split(":")[0]);
  assert.deepEqual(deletedKinds.sort(), ["host", "host", "host", "host", "profile", "squad"].sort());
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
    remna: env.remna, ssh: sshf.ssh, sshEnvLoader: () => SSH_ENV,
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
    remna: env.remna, ssh: sshf.ssh, sshEnvLoader: () => SSH_ENV,
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
    remna: env.remna, ssh: sshf.ssh, sshEnvLoader: () => SSH_ENV,
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
    remna: env.remna, ssh: sshf.ssh, sshEnvLoader: () => SSH_ENV,
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
    ssh: async (addr: string, script: string) => {
      if (script.startsWith("[ -f")) return sshf.ssh(addr, script); // probe файлов не фейлим
      if (failNow && script.includes("lazeika-only-tc")) {
        sshf.scripts.push(script);
        return { ok: false, exitCode: 9, stdout: "", stderr: "boom" };
      }
      return sshf.ssh(addr, script);
    },
    sshEnvLoader: () => SSH_ENV,
    ...fencedDeps(store),
    persistProfileUuid: async () => {}, persistSquadUuid: async () => {},
    persistSetupInputs: async () => {},
    runAtomic: async (fn: (tx: never) => Promise<void>) => fn(undefined as never),
  });

  // Успешный setup №1.
  await service.setup(SETUP_INPUT);
  const profileAfterFirst = JSON.parse(JSON.stringify(env.state.profiles.find((p) => p.uuid === store.state.profileUuid)));
  const hostAfterFirst = JSON.parse(JSON.stringify(env.state.hosts.find((h) => h.uuid === store.state.workingHostUuid)));

  // Повторный setup падает на tc — но уже изменил существующие профиль/hosts.
  failNow = true;
  await assert.rejects(() => service.setup(SETUP_INPUT), /tc-фильтры/);

  // Профиль восстановлен к снапшоту (имя и конфиг как после первого setup).
  const profileNow = env.state.profiles.find((p) => p.uuid === store.state.profileUuid);
  assert.equal(profileNow?.name, profileAfterFirst.name);
  assert.deepEqual(profileNow?.config, profileAfterFirst.config);
  // Binding рабочего host'а восстановлен.
  const hostNow = env.state.hosts.find((h) => h.uuid === store.state.workingHostUuid);
  assert.deepEqual(hostNow?.inbound, hostAfterFirst.inbound);
  assert.deepEqual(hostNow?.tags, hostAfterFirst.tags);
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

test("manual deletion of managed profile recovers from saved base profile", async () => {
  const env = createFakeRemna();
  const sshf = createSshFake();
  const store = createFencedStore();
  const service = createLazeikaService({
    remna: env.remna, ssh: sshf.ssh, sshEnvLoader: () => SSH_ENV,
    ...fencedDeps(store),
    persistProfileUuid: async () => {}, persistSquadUuid: async () => {},
    persistSetupInputs: async () => {},
    runAtomic: async (fn: (tx: never) => Promise<void>) => fn(undefined as never),
  });
  await service.setup(SETUP_INPUT);
  // Админ удалил managed профиль; нода всё ещё ссылается на него.
  env.state.profiles = env.state.profiles.filter((p) => p.uuid !== store.state.profileUuid);
  env.state.nodes[0].configProfile!.activeConfigProfileUuid = store.state.profileUuid ?? null;
  await service.setup(SETUP_INPUT);
  assert.equal(store.state.status, "READY");
  // Профиль пересоздан (ровно один managed) и нода снова на нём.
  const managedProfiles = (env.state.profiles as Array<{ uuid: string; name?: string }>).filter((p) => typeof p.name === "string" && p.name.startsWith("Lazeika-Only"));
  assert.equal(managedProfiles.length, 1);
  assert.equal(env.state.nodes[0].configProfile?.activeConfigProfileUuid, managedProfiles[0]!.uuid);
});

test("deleted auto-squad is recreated without duplicates", async () => {
  const env = createFakeRemna();
  const sshf = createSshFake();
  const store = createFencedStore();
  const service = createLazeikaService({
    remna: env.remna, ssh: sshf.ssh, sshEnvLoader: () => SSH_ENV,
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
    remna: env.remna, ssh: sshf.ssh, sshEnvLoader: () => SSH_ENV,
    ...fencedDeps(store),
    persistProfileUuid: async () => {}, persistSquadUuid: async () => {},
    persistSetupInputs: async () => {},
    runAtomic: async (fn: (tx: never) => Promise<void>) => fn(undefined as never),
  });
  await serviceB.setup(SETUP_INPUT);
  assert.equal(store.state.status, "READY");

  // Воркер A стартовал ДО B, его claim-raw устарел; Remna у него падает на создании профиля.
  const staleClaim = { claimed: true, token: "worker-a", raw: JSON.stringify({ ...resourceStateSchema.parse({}), status: "APPLYING", lockToken: "worker-a", lockedAt: new Date().toISOString() }) };
  const serviceA = createLazeikaService({
    remna: { ...env.remna, createConfigProfile: async () => ({ status: 502, error: "boom" }) },
    ssh: sshf.ssh,
    sshEnvLoader: () => SSH_ENV,
    loadState: store.loadState,
    saveState: store.saveState,
    beginSetup: async () => staleClaim,
    casWrite: store.casWrite,
    persistProfileUuid: async () => {}, persistSquadUuid: async () => {},
    persistSetupInputs: async () => {},
    runAtomic: async (fn: (tx: never) => Promise<void>) => fn(undefined as never),
  });
  await assert.rejects(() => serviceA.setup(SETUP_INPUT), /boom/);
  // ERROR воркера A не перезаписал READY воркера B.
  assert.equal(store.state.status, "READY");
});

test("node change from ERROR state with managed traces is rejected", async () => {
  const env = createFakeRemna();
  const sshf = createSshFake();
  const store = createFencedStore();
  const service = createLazeikaService({
    remna: env.remna, ssh: sshf.ssh, sshEnvLoader: () => SSH_ENV,
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
    remna: env.remna, ssh: sshf.ssh, sshEnvLoader: () => SSH_ENV,
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
});

test("remoteInstall has top-level set -euo and verifies systemd enabled", async () => {
  const env = createFakeRemna();
  const sshf = createSshFake();
  const store = createFencedStore();
  const service = createLazeikaService({
    remna: env.remna, ssh: sshf.ssh, sshEnvLoader: () => SSH_ENV,
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

test("reconcile forces notification hosts back to disabled", async () => {
  const env = createFakeRemna();
  const sshf = createSshFake();
  const store = createFencedStore();
  const service = createLazeikaService({
    remna: env.remna, ssh: sshf.ssh, sshEnvLoader: () => SSH_ENV,
    ...fencedDeps(store),
    persistProfileUuid: async () => {}, persistSquadUuid: async () => {},
    persistSetupInputs: async () => {},
    runAtomic: async (fn: (tx: never) => Promise<void>) => fn(undefined as never),
  });
  await service.setup(SETUP_INPUT);
  // Админ вручную включил один notification-host.
  const notif = env.state.hosts.find((h) => h.isDisabled === true)!;
  notif.isDisabled = false;
  await service.setup(SETUP_INPUT);
  assert.equal(notif.isDisabled, true, "notification-host принудительно выключен обратно");
});
