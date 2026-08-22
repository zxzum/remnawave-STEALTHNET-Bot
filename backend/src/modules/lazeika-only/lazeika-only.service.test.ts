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

/** Полностью fake-окружение Remna в памяти. */
function createFakeRemna(options: {
  failCreateProfile?: boolean;
} = {}) {
  let seq = 0;
  const nextUuid = () => `${(seq++).toString().padStart(8, "0")}-aaaa-bbbb-cccc-dddddddddddd`;
  // Реальная панель сохраняет UUID inbound по стабильному тегу между PATCH.
  const inboundUuidByTag = new Map<string, string>();
  const ensureInboundUuid = (tag: string) => {
    if (!inboundUuidByTag.has(tag)) inboundUuidByTag.set(tag, `prof-in-${nextUuid().slice(0, 8)}`);
    return inboundUuidByTag.get(tag)!;
  };
  inboundUuidByTag.set("VLESS-REALITY", "inbound-base-uuid");
  const state = {
    nodes: [{
      uuid: NODE_UUID,
      name: "Alpha",
      address: "203.0.113.10",
      isDisabled: false,
      activeConfigProfileUuid: BASE_PROFILE_UUID,
      activeInbounds: ["inbound-base-uuid"],
    }],
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
      Object.assign(n, body);
      state.calls.updateNode.push(body);
      return ok(n);
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

function createSshFake(options: { failInstall?: boolean } = {}) {
  const scripts: string[] = [];
  const ssh = async (_address: string, script: string) => {
    scripts.push(script);
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

function createStateStore(initial = resourceStateSchema.parse({})) {
  let current = initial;
  return {
    loadState: async () => JSON.parse(JSON.stringify(current)),
    saveState: async (next: typeof current) => { current = JSON.parse(JSON.stringify(next)); },
    get state() { return current; },
  };
}

const SSH_ENV = { privateKeyPath: "/keys/id_ed25519", user: "root", port: 22, knownHostsFile: "/keys/known_hosts" };
const SETUP_INPUT = { nodeUuid: NODE_UUID, squadUuid: null as string | null, speedMbit: 5 };

test("setup from clean state creates exactly one profile, squad, working host and three notifications", async () => {
  const env = createFakeRemna();
  const sshf = createSshFake();
  const store = createStateStore();
  const service = createLazeikaService({
    remna: env.remna,
    ssh: sshf.ssh,
    sshEnvLoader: () => SSH_ENV,
    loadState: store.loadState,
    saveState: store.saveState,
    persistProfileUuid: async () => {},
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
  assert.equal(env.state.nodes[0].activeConfigProfileUuid, store.state.profileUuid);
  assert.ok(env.state.nodes[0].activeInbounds.includes(store.state.managedInboundUuid ?? ""));
  assert.ok(env.state.nodes[0].activeInbounds.includes("inbound-base-uuid"));
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
  const store = createStateStore();
  const service = createLazeikaService({
    remna: env.remna, ssh: sshf.ssh, sshEnvLoader: () => SSH_ENV,
    loadState: store.loadState, saveState: store.saveState, persistProfileUuid: async () => {},
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
  const store = createStateStore();
  const service = createLazeikaService({
    remna: env.remna, ssh: createSshFake().ssh, sshEnvLoader: () => SSH_ENV,
    loadState: store.loadState, saveState: store.saveState, persistProfileUuid: async () => {},
  });
  await assert.rejects(
    () => service.setup({ ...SETUP_INPUT, squadUuid: MANUAL_SQUAD_UUID }),
    /чужие inbounds/,
  );
  assert.equal(store.state.status, "ERROR");
  // нода не была изменена
  assert.equal(env.state.nodes[0].activeConfigProfileUuid, BASE_PROFILE_UUID);
});

test("rollback restores the node after a Remna profile failure", async () => {
  const env = createFakeRemna({ failCreateProfile: true });
  const store = createStateStore();
  const service = createLazeikaService({
    remna: env.remna, ssh: createSshFake().ssh, sshEnvLoader: () => SSH_ENV,
    loadState: store.loadState, saveState: store.saveState, persistProfileUuid: async () => {},
  });
  await assert.rejects(() => service.setup(SETUP_INPUT), /profile create failed/);
  assert.equal(store.state.status, "ERROR");
  assert.match(store.state.lastError ?? "", /\[PROFILE\]/);
  assert.equal(env.state.nodes[0].activeConfigProfileUuid, BASE_PROFILE_UUID);
  assert.deepEqual(env.state.nodes[0].activeInbounds, ["inbound-base-uuid"]);
  assert.equal(env.state.squads.length, 0);
});

test("rollback removes only resources created by the failed run after an SSH failure", async () => {
  const env = createFakeRemna();
  const sshf = createSshFake({ failInstall: true });
  const store = createStateStore();
  const service = createLazeikaService({
    remna: env.remna, ssh: sshf.ssh, sshEnvLoader: () => SSH_ENV,
    loadState: store.loadState, saveState: store.saveState, persistProfileUuid: async () => {},
  });
  await assert.rejects(() => service.setup(SETUP_INPUT), /tc-фильтры/);
  assert.equal(store.state.status, "ERROR");
  assert.match(store.state.lastError ?? "", /\[SSH_TC\]/);
  // созданные этим запуском ресурсы удалены
  const deletedKinds = env.state.calls.deleted.map((d) => d.split(":")[0]);
  assert.deepEqual(deletedKinds.sort(), ["host", "host", "host", "host", "profile", "squad"].sort());
  assert.equal(env.state.profiles.length, 1);
  assert.equal(env.state.squads.length, 0);
  // нода восстановлена
  assert.equal(env.state.nodes[0].activeConfigProfileUuid, BASE_PROFILE_UUID);
});

test("reconcile recreates missing hosts without duplicating existing ones", async () => {
  const env = createFakeRemna();
  const sshf = createSshFake();
  const store = createStateStore();
  const service = createLazeikaService({
    remna: env.remna, ssh: sshf.ssh, sshEnvLoader: () => SSH_ENV,
    loadState: store.loadState, saveState: store.saveState, persistProfileUuid: async () => {},
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
