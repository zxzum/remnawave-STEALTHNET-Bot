import { createHash } from "node:crypto";
import { prisma } from "../db.js";
import { logAdminEvent } from "../modules/audit/audit.service.js";
import { remnaCreateUser, remnaGetUser, extractRemnaUuid, remnaUsernameFromClient } from "../modules/remna/remna.client.js";
import { deleteSingleSubscription } from "../modules/subscription/single-subscription-lifecycle.service.js";
import { extractRemnaSubscriptionUrl } from "../modules/subscription/subscription-url.js";
import { nextMonthlyBoundary } from "../modules/squad-traffic/traffic-period.js";

export type CutoverArgs = { apply: boolean; dryRun: boolean; resume: boolean; cleanupLegacy: boolean; subscriptionId: string | null };
export type CutoverInventory = {
  subscriptionId: string; ownerId: string; active: boolean; createdAt: string; expireAt: string | null;
  tariffId: string | null; targetSquads: string[]; trafficLimitMode: "REMNAWAVE" | "LOCAL_SQUAD";
  oldUuids: string[]; canonicalUuid: string | null; blockers: string[];
};

export type DuplicateCleanupArgs = { cleanupDuplicates: boolean; apply: boolean; dryRun: boolean; username: string | null };
export type DuplicateCleanupSubscription = {
  clientId: string; ownerId: string; subscriptionId: string; id: string; subscriptionIndex: number; index: number;
  tariffId: string | null; tariffName: string | null; tariff: string | null;
  remnawaveUuid: string | null; uuid: string | null; remnawaveShortUuid: string | null; shortUuid: string | null;
  remnawaveUsername: string | null; expireAt: string | null; expiry: string | null;
  status: string; action: "unchanged" | "preserve" | "delete" | "blocked"; blockers: string[];
};
export type DuplicateCleanupClient = {
  clientId: string; clientUsername: string | null; status: "unchanged" | "planned" | "blocked";
  subscriptions: DuplicateCleanupSubscription[]; blockers: string[];
};
type DuplicateCleanupDeletion = { deleted: boolean; failures?: Array<{ error?: string }> };

export function parseDuplicateCleanupArgs(args: string[]): DuplicateCleanupArgs {
  const cleanupDuplicates = args.includes("--cleanup-duplicates");
  const apply = cleanupDuplicates && args.includes("--apply");
  const usernameIndex = args.indexOf("--username");
  const username = usernameIndex < 0 ? null : normalizedUsername(args[usernameIndex + 1]);
  if (usernameIndex >= 0 && !username) throw new Error("--username requires a non-empty username");
  return { cleanupDuplicates, apply, dryRun: !apply || args.includes("--dry-run"), username };
}

function normalizedUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const username = value.trim().replace(/^@/, "").toLowerCase();
  return username || null;
}

function clientUsername(row: any): string | null {
  return normalizedUsername(row.clientUsername ?? row.telegramUsername ?? row.owner?.telegramUsername ?? row.ownerUsername);
}

function tariffName(row: any): string | null {
  const value = typeof row.tariff === "string" ? row.tariff : row.tariff?.name;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isoDate(value: unknown): string | null {
  if (!value) return null;
  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function duplicateSubscriptionStatus(row: any, expireAt: string | null, now: Date): string {
  if (row.deletionRequestedAt != null) return "DELETION_PENDING";
  if (typeof row.status === "string" && row.status.trim()) return row.status.trim().toUpperCase();
  if (!expireAt) return "UNKNOWN_EXPIRY";
  return new Date(expireAt).getTime() > now.getTime() ? "ACTIVE" : "EXPIRED";
}

function duplicateSubscriptionItem(row: any, clientId: string, now: Date): DuplicateCleanupSubscription {
  const subscriptionId = String(row.id);
  const subscriptionIndex = Number.isInteger(row.subscriptionIndex) ? row.subscriptionIndex : -1;
  const expireAt = isoDate(row.expireAt);
  const remnawaveUuid = typeof row.remnawaveUuid === "string" && row.remnawaveUuid ? row.remnawaveUuid : null;
  const remnawaveShortUuid = typeof row.remnawaveShortUuid === "string" && row.remnawaveShortUuid ? row.remnawaveShortUuid : null;
  const name = tariffName(row);
  const status = duplicateSubscriptionStatus(row, expireAt, now);
  return {
    clientId, ownerId: clientId, subscriptionId, id: subscriptionId, subscriptionIndex, index: subscriptionIndex,
    tariffId: row.tariffId ?? row.tariff?.id ?? null, tariffName: name, tariff: name,
    remnawaveUuid, uuid: remnawaveUuid, remnawaveShortUuid, shortUuid: remnawaveShortUuid,
    remnawaveUsername: typeof row.remnawaveUsername === "string" && row.remnawaveUsername ? row.remnawaveUsername : null,
    expireAt, expiry: expireAt, status, action: "blocked", blockers: [],
  };
}

function markDuplicateClient(client: DuplicateCleanupClient, action: DuplicateCleanupSubscription["action"], blockers: string[] = []) {
  client.status = blockers.length ? "blocked" : action === "unchanged" ? "unchanged" : "planned";
  client.blockers = [...new Set(blockers)];
  for (const subscription of client.subscriptions) {
    subscription.action = blockers.length ? "blocked" : action;
    subscription.blockers = [...client.blockers];
  }
}

function decideDuplicateClient(client: DuplicateCleanupClient, duplicateUsernames: Set<string>) {
  const subscriptions = client.subscriptions;
  if (subscriptions.length <= 1) {
    markDuplicateClient(client, "unchanged");
    return;
  }

  const blockers: string[] = [];
  if (subscriptions.length !== 2) blockers.push("UNEXPECTED_SUBSCRIPTION_COUNT");
  if (subscriptions.some((subscription) => subscription.remnawaveUsername && duplicateUsernames.has(subscription.remnawaveUsername.trim().toLowerCase()))) blockers.push("DUPLICATE_USERNAME");

  const owner = client.clientUsername;
  let preserved: DuplicateCleanupSubscription | undefined;
  if (owner === "sallyqx") {
    const standard = subscriptions.filter((subscription) => subscription.tariffName === "Стандарт");
    const ordinary = subscriptions.filter((subscription) => subscription.tariffName === "Обычный ВПН");
    if (standard.length !== 1 || ordinary.length !== 1) blockers.push("UNCLEAR_TARIFF");
    else preserved = standard[0];
  } else if (owner === "vssarovv") {
    const active = subscriptions.filter((subscription) => subscription.status === "ACTIVE" && subscription.remnawaveUuid);
    if (active.length !== 1) blockers.push("UNCLEAR_ACTIVE_UUID");
    else preserved = active[0];
  } else {
    const names = subscriptions.map((subscription) => subscription.tariffName);
    const active = subscriptions.filter((subscription) => subscription.status === "ACTIVE");
    if (names.some((name) => !name) || new Set(names).size !== subscriptions.length || active.length !== 1) blockers.push("UNCLEAR_TARIFF");
    else preserved = active[0];
  }

  if (blockers.length || !preserved) {
    markDuplicateClient(client, "blocked", blockers.length ? blockers : ["UNCLEAR_TARIFF"]);
    return;
  }
  client.status = "planned";
  client.blockers = [];
  for (const subscription of subscriptions) {
    subscription.action = subscription === preserved ? "preserve" : "delete";
    subscription.blockers = [];
  }
}

export function buildDuplicateCleanupInventory(rows: any[], now = new Date()): DuplicateCleanupClient[] {
  const clients = new Map<string, DuplicateCleanupClient>();
  const duplicateCounts = new Map<string, number>();
  for (const row of rows) {
    const clientId = String(row.ownerId ?? row.clientId);
    const client = clients.get(clientId) ?? { clientId, clientUsername: clientUsername(row), status: "unchanged", subscriptions: [], blockers: [] };
    client.clientUsername ??= clientUsername(row);
    client.subscriptions.push(duplicateSubscriptionItem(row, clientId, now));
    clients.set(clientId, client);
    const username = normalizedUsername(row.remnawaveUsername);
    if (username) duplicateCounts.set(username, (duplicateCounts.get(username) ?? 0) + 1);
  }
  const duplicateUsernames = new Set([...duplicateCounts].filter(([, count]) => count > 1).map(([username]) => username));
  for (const client of clients.values()) {
    client.subscriptions.sort((a, b) => a.subscriptionIndex - b.subscriptionIndex || a.subscriptionId.localeCompare(b.subscriptionId));
    decideDuplicateClient(client, duplicateUsernames);
  }
  return [...clients.values()].sort((a, b) => a.clientId.localeCompare(b.clientId));
}

function duplicateCleanupCanonical(inventory: DuplicateCleanupClient[]) {
  return inventory
    .slice()
    .sort((a, b) => a.clientId.localeCompare(b.clientId))
    .map((client) => ({
      clientId: client.clientId, clientUsername: client.clientUsername, status: client.status, blockers: [...client.blockers].sort(),
      subscriptions: client.subscriptions
        .slice()
        .sort((a, b) => a.subscriptionIndex - b.subscriptionIndex || a.subscriptionId.localeCompare(b.subscriptionId))
        .map((subscription) => ({
          clientId: subscription.clientId, ownerId: subscription.ownerId, subscriptionId: subscription.subscriptionId, subscriptionIndex: subscription.subscriptionIndex, tariffId: subscription.tariffId,
          tariffName: subscription.tariffName, remnawaveUuid: subscription.remnawaveUuid, remnawaveShortUuid: subscription.remnawaveShortUuid,
          remnawaveUsername: subscription.remnawaveUsername, expireAt: subscription.expireAt, status: subscription.status,
          action: subscription.action, blockers: [...subscription.blockers].sort(),
        })),
    }));
}

export function computeDuplicateCleanupPlanHash(inventory: DuplicateCleanupClient[]): string {
  return createHash("sha256").update(JSON.stringify(duplicateCleanupCanonical(inventory))).digest("hex");
}

export async function runDuplicateCleanup(args: DuplicateCleanupArgs, dependencies: {
  listSubscriptions: () => Promise<any[]>;
  deleteSubscription?: (subscriptionId: string) => Promise<DuplicateCleanupDeletion>;
  writeJournal?: (kind: string, payload: Record<string, unknown>) => Promise<void>;
}, now = new Date()) {
  const rows = await dependencies.listSubscriptions();
  const fullInventory = buildDuplicateCleanupInventory(rows, now);
  const inventory = args.username ? fullInventory.filter((client) => client.clientUsername === args.username) : fullInventory;
  const planHash = computeDuplicateCleanupPlanHash(inventory);
  const blocked = inventory.filter((client) => client.blockers.length);
  if (!args.apply || args.dryRun) return { mutated: false, inventory, planHash, results: [] as Array<{ clientId: string; subscriptionId: string; status: string; error?: string }> };
  if (blocked.length) throw new Error(`Duplicate cleanup blocked: ${blocked.map((client) => `${client.clientId}:${client.blockers.join(",")}`).join(";")}`);

  const rereadFull = buildDuplicateCleanupInventory(await dependencies.listSubscriptions(), now);
  const reread = args.username ? rereadFull.filter((client) => client.clientUsername === args.username) : rereadFull;
  const rereadHash = computeDuplicateCleanupPlanHash(reread);
  if (rereadHash !== planHash) throw new Error(`Duplicate cleanup plan changed before apply: ${planHash} != ${rereadHash}`);

  const deleteSubscription = dependencies.deleteSubscription ?? ((subscriptionId: string) => deleteSingleSubscription(subscriptionId));
  const writeJournal = dependencies.writeJournal ?? (async () => {});
  const results: Array<{ clientId: string; subscriptionId: string; status: "deleted" | "retryable"; error?: string }> = [];
  for (const client of reread) {
    for (const subscription of client.subscriptions.filter((item) => item.action === "delete")) {
      try {
        const result = await deleteSubscription(subscription.subscriptionId);
        if (result.deleted) {
          results.push({ clientId: client.clientId, subscriptionId: subscription.subscriptionId, status: "deleted" });
          await writeJournal("subscription.duplicate_cleanup.deleted", { clientId: client.clientId, subscriptionId: subscription.subscriptionId, planHash });
        } else {
          const error = result.failures?.map((failure) => failure.error).filter(Boolean).join("; ") || "Remote deletion failed";
          results.push({ clientId: client.clientId, subscriptionId: subscription.subscriptionId, status: "retryable", error });
          await writeJournal("subscription.duplicate_cleanup.failed", { clientId: client.clientId, subscriptionId: subscription.subscriptionId, planHash, error });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ clientId: client.clientId, subscriptionId: subscription.subscriptionId, status: "retryable", error: message });
        await writeJournal("subscription.duplicate_cleanup.failed", { clientId: client.clientId, subscriptionId: subscription.subscriptionId, planHash, error: message });
      }
    }
  }
  return { mutated: results.length > 0, inventory: reread, planHash, results };
}

export type ReplacementInput = { subscriptionId: string; ownerId: string; subscriptionIndex?: number; telegramId?: string | null; telegramUsername?: string | null; email?: string | null; tariffId?: string | null; meteredSquadUuid?: string | null; createdAt: string; expireAt: string; squads: string[]; deviceLimit: number; trafficLimitMode: "REMNAWAVE" | "LOCAL_SQUAD"; trafficLimitBytes: bigint | string };

function asRemnawaveTrafficLimit(value: bigint | string): number {
  const bytes = typeof value === "bigint" ? value : BigInt(value);
  if (bytes < 0n || bytes > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Traffic limit cannot be represented safely by Remnawave API");
  }
  return Number(bytes);
}

function squadUuids(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const uuids = value.map((squad) => typeof squad === "string" ? squad : squad && typeof squad === "object" && typeof (squad as { uuid?: unknown }).uuid === "string" ? (squad as { uuid: string }).uuid : null);
  return uuids.every((uuid): uuid is string => uuid !== null) ? uuids : null;
}

function trialSquads(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch { return []; }
}

function cutoverPolicy(row: any): any {
  if (!row.trialId) return row.tariff;
  const inherited = row.trial?.tariff;
  if (!row.trial) return inherited;
  const directSquads = trialSquads(row.trial.squadUuids);
  return {
    ...inherited,
    internalSquadUuids: directSquads.length ? directSquads : inherited?.internalSquadUuids ?? [],
    trafficLimitMode: row.trial.trafficLimitMode ?? inherited?.trafficLimitMode ?? "REMNAWAVE",
    trafficLimitBytes: row.trial.trafficLimitBytes ?? inherited?.trafficLimitBytes ?? 0n,
    meteredSquadUuid: row.trial.meteredSquadUuid ?? inherited?.meteredSquadUuid ?? null,
    deviceLimit: row.trial.deviceLimit ?? inherited?.deviceLimit ?? 1,
  };
}

export function localSquadQuotaLimit(value: bigint | string): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

export function buildReplacementPayload(input: Omit<ReplacementInput, "ownerId"> & { username: string }) {
  return {
    username: input.username, createdAt: input.createdAt, expireAt: input.expireAt, status: "ACTIVE",
    activeInternalSquads: input.squads, trafficLimitBytes: input.trafficLimitMode === "LOCAL_SQUAD" ? 0 : asRemnawaveTrafficLimit(input.trafficLimitBytes),
    trafficLimitStrategy: input.trafficLimitMode === "LOCAL_SQUAD" ? "NO_RESET" : "MONTH", hwidDeviceLimit: input.deviceLimit,
    ...(input.telegramId?.trim() && { telegramId: Number(input.telegramId) }),
    ...(input.email?.trim() && { email: input.email.trim() }),
  };
}

function replacementUsername(input: ReplacementInput): string {
  return input.telegramId || input.telegramUsername || input.email
    ? remnaUsernameFromClient({ telegramId: input.telegramId, telegramUsername: input.telegramUsername, email: input.email, clientIdFallback: input.ownerId, subscriptionIndex: input.subscriptionIndex })
    : `ordinary-${input.subscriptionId}`;
}

export async function runReplacementCutover(input: ReplacementInput, dependencies: {
  createUser: (payload: ReturnType<typeof buildReplacementPayload>) => Promise<{ uuid: string; username: string; shortUuid: string; subscriptionUrl: string }>;
  getUser: (uuid: string) => Promise<Record<string, unknown>>;
  writeJournal: (kind: string, payload?: Record<string, unknown>) => Promise<void>;
  switchLocal: (replacement: { uuid: string; username: string; shortUuid: string }) => Promise<void>;
}): Promise<{ ok: boolean; error?: string }> {
  const username = replacementUsername(input);
  const replacement = await dependencies.createUser(buildReplacementPayload({ ...input, username }));
  await dependencies.writeJournal("subscription.cutover.replacement_created", replacement);
  try {
    const url = new URL(replacement.subscriptionUrl);
    if (url.hostname !== "sub.lazeika.xyz") throw new Error("Replacement URL is not direct sub.lazeika.xyz");
    const user = await dependencies.getUser(replacement.uuid);
    const expected = buildReplacementPayload({ ...input, username });
    for (const key of ["username", "createdAt", "expireAt", "trafficLimitBytes", "trafficLimitStrategy"] as const) {
      if (user[key] !== expected[key]) throw new Error(`Replacement verification mismatch: ${key}`);
    }
    for (const key of ["telegramId", "email"] as const) {
      if (key in expected && user[key] !== expected[key]) throw new Error(`Replacement verification mismatch: ${key}`);
    }
    if (JSON.stringify(squadUuids(user.activeInternalSquads)) !== JSON.stringify(expected.activeInternalSquads)) throw new Error("Replacement verification mismatch: squads");
    await dependencies.writeJournal("subscription.cutover.verified", { subscriptionUrl: replacement.subscriptionUrl, host: url.hostname });
    await dependencies.switchLocal(replacement);
    await dependencies.writeJournal("subscription.cutover.switched", replacement);
    return { ok: true };
  } catch (error) {
    await dependencies.writeJournal("subscription.cutover.failed", { error: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function cleanupLegacyUsers(input: { oldUuids: string[]; replacementUuid: string; currentUuid: string; verified: boolean; switched: boolean }, dependencies: {
  revoke: (uuid: string) => Promise<void>; getUser: (uuid: string) => Promise<{ status?: string } | null>; deleteUser: (uuid: string) => Promise<void>; writeJournal: (kind: string) => Promise<void>;
}): Promise<{ ok: boolean; error?: string }> {
  if (!input.verified || !input.switched) return { ok: false, error: "REPLACEMENT_NOT_VERIFIED" };
  for (const uuid of [...new Set(input.oldUuids)]) {
    if (uuid === input.replacementUuid || uuid === input.currentUuid) continue;
    try {
      await dependencies.revoke(uuid);
      await dependencies.deleteUser(uuid);
      if (await dependencies.getUser(uuid)) throw new Error(`Legacy user ${uuid} still exists after delete`);
    } catch (error) {
      await dependencies.writeJournal("subscription.cutover.failed");
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  await dependencies.writeJournal("subscription.cutover.legacy_cleaned");
  return { ok: true };
}

/** Operational resume boundary. It is injectable so no CLI test can touch Remnawave. */
export async function resumeReplacementCutovers(items: ReplacementInput[], dependencies: {
  findReplacement: (input: ReplacementInput) => Promise<{ uuid: string; username: string; shortUuid: string; subscriptionUrl: string } | null>;
  createUser: (payload: ReturnType<typeof buildReplacementPayload>) => Promise<{ uuid: string; username: string; shortUuid: string; subscriptionUrl: string }>;
  getUser: (uuid: string) => Promise<Record<string, unknown>>;
  writeJournal: (kind: string, payload?: Record<string, unknown>) => Promise<void>;
  switchLocal: (input: ReplacementInput, replacement: { uuid: string; username: string; shortUuid: string }) => Promise<void>;
}) {
  const results: Array<{ subscriptionId: string; ok: boolean; error?: string }> = [];
  for (const item of items) {
    const existing = await dependencies.findReplacement(item);
    const result = await runReplacementCutover(item, {
      createUser: async (payload) => existing ?? dependencies.createUser(payload),
      getUser: dependencies.getUser, writeJournal: (kind, payload) => dependencies.writeJournal(kind, { ...(payload ?? {}), subscriptionId: item.subscriptionId }),
      switchLocal: (replacement) => dependencies.switchLocal(item, replacement),
    });
    results.push({ subscriptionId: item.subscriptionId, ...result });
  }
  return results;
}

export function parseCutoverArgs(args: string[]): CutoverArgs {
  const subscriptionIndex = args.indexOf("--subscription");
  const apply = args.includes("--apply");
  return {
    apply, dryRun: !apply || args.includes("--dry-run"), resume: args.includes("--resume"),
    cleanupLegacy: args.includes("--cleanup-legacy"), subscriptionId: subscriptionIndex >= 0 ? args[subscriptionIndex + 1] ?? null : null,
  };
}

export async function buildCutoverInventory(rows: any[], _getCanonicalUser: (uuid: string) => Promise<unknown>): Promise<CutoverInventory[]> {
  return rows.map((row) => {
    const tombstone = row.deletionRequestedAt != null;
    const expireAt = row.expireAt ? new Date(row.expireAt) : null;
    const policy = cutoverPolicy(row);
    const blockers = tombstone
      ? ["CLEANUP_ONLY_TOMBSTONE"]
      : [!expireAt && "MISSING_EXPIRE_AT", !policy && "MISSING_TARIFF"].filter(Boolean) as string[];
    return {
      subscriptionId: row.id, ownerId: row.ownerId, active: Boolean(expireAt && expireAt.getTime() > Date.now()),
      createdAt: new Date(row.createdAt).toISOString(), expireAt: expireAt?.toISOString() ?? null,
      tariffId: row.tariffId ?? null, targetSquads: policy?.internalSquadUuids ?? [],
      trafficLimitMode: policy?.trafficLimitMode === "LOCAL_SQUAD" ? "LOCAL_SQUAD" : "REMNAWAVE",
      oldUuids: row.remnawaveUuid ? [row.remnawaveUuid] : [], canonicalUuid: row.remnawaveUuid ?? null, blockers,
    };
  });
}

export async function runCutoverInventory(args: CutoverArgs, dependencies: {
  listSubscriptions: () => Promise<any[]>;
  getCanonicalUser: (uuid: string) => Promise<unknown>;
  writeJournal: (kind: string, item: CutoverInventory) => Promise<void>;
}) {
  const rows = await dependencies.listSubscriptions();
  const selected = args.subscriptionId ? rows.filter((row) => row.id === args.subscriptionId) : rows;
  // Dry-run never reaches Remnawave or the audit writer.
  const inventory = await buildCutoverInventory(selected, dependencies.getCanonicalUser);
  if (!args.apply || args.dryRun) return { mutated: false, inventory };
  const blocked = inventory.filter((item) => item.blockers.some((blocker) => blocker !== "CLEANUP_ONLY_TOMBSTONE"));
  if (blocked.length > 0) throw new Error(`Cutover blocked: ${blocked.map((item) => `${item.subscriptionId}:${item.blockers.join(",")}`).join(";")}`);
  for (const item of inventory) await dependencies.writeJournal("subscription.cutover.snapshot", item);
  return { mutated: true, inventory };
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const duplicateArgs = parseDuplicateCleanupArgs(rawArgs);
  if (duplicateArgs.cleanupDuplicates) {
    const result = await runDuplicateCleanup(duplicateArgs, {
      listSubscriptions: () => prisma.subscription.findMany({
        orderBy: [{ ownerId: "asc" }, { subscriptionIndex: "asc" }, { id: "asc" }],
        select: {
          id: true, ownerId: true, subscriptionIndex: true, remnawaveUuid: true, remnawaveUsername: true, remnawaveShortUuid: true,
          expireAt: true, deletionRequestedAt: true, syncStatus: true, tariffId: true, tariff: { select: { id: true, name: true } },
          owner: { select: { telegramUsername: true } },
        },
      }),
      deleteSubscription: (subscriptionId) => deleteSingleSubscription(subscriptionId),
      writeJournal: (kind, payload) => logAdminEvent(kind, null, null, { type: "subscription", id: typeof payload.subscriptionId === "string" ? payload.subscriptionId : null }, payload),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const args = parseCutoverArgs(rawArgs);
  const result = await runCutoverInventory(args, {
    listSubscriptions: () => prisma.subscription.findMany({
      where: args.subscriptionId ? { id: args.subscriptionId } : {},
      select: { id: true, ownerId: true, createdAt: true, expireAt: true, tariffId: true, trialId: true, remnawaveUuid: true, deletionRequestedAt: true, tariff: { select: { internalSquadUuids: true, trafficLimitMode: true } }, trial: { select: { squadUuids: true, trafficLimitMode: true, tariff: { select: { internalSquadUuids: true, trafficLimitMode: true } } } } },
    }),
    getCanonicalUser: async () => null,
    writeJournal: (kind, item) => logAdminEvent(kind, null, null, { type: "subscription", id: item.subscriptionId }, item),
  });
  if (args.apply && args.resume) {
    const rows = await prisma.subscription.findMany({
      where: { deletionRequestedAt: null, expireAt: { not: null }, ...(args.subscriptionId ? { id: args.subscriptionId } : {}) },
      select: { id: true, ownerId: true, subscriptionIndex: true, tariffId: true, trialId: true, createdAt: true, expireAt: true, owner: { select: { telegramId: true, telegramUsername: true, email: true } }, tariff: { select: { internalSquadUuids: true, meteredSquadUuid: true, trafficLimitMode: true, trafficLimitBytes: true, deviceLimit: true } }, trial: { select: { squadUuids: true, trafficLimitMode: true, trafficLimitBytes: true, meteredSquadUuid: true, deviceLimit: true, tariff: { select: { id: true, internalSquadUuids: true, meteredSquadUuid: true, trafficLimitMode: true, trafficLimitBytes: true, deviceLimit: true } } } } },
    });
    await resumeReplacementCutovers(rows.flatMap((row) => {
      const policy = cutoverPolicy(row);
      if (!row.expireAt || !policy) return [];
      return [{
        subscriptionId: row.id, ownerId: row.ownerId, subscriptionIndex: row.subscriptionIndex, telegramId: row.owner.telegramId, telegramUsername: row.owner.telegramUsername, email: row.owner.email, tariffId: row.tariffId ?? row.trial?.tariff?.id ?? null, meteredSquadUuid: policy.meteredSquadUuid, createdAt: row.createdAt.toISOString(), expireAt: row.expireAt.toISOString(), squads: policy.internalSquadUuids,
        deviceLimit: policy.deviceLimit ?? 1, trafficLimitMode: policy.trafficLimitMode, trafficLimitBytes: policy.trafficLimitBytes ?? 0n,
      }];
    }), {
      findReplacement: async (input) => {
        const event = await prisma.adminEvent.findFirst({ where: { kind: "subscription.cutover.replacement_created", targetId: input.subscriptionId }, orderBy: { createdAt: "desc" } });
        const payload = event?.payload as Record<string, unknown> | null;
        return payload && payload.username === replacementUsername(input) && typeof payload.uuid === "string" && typeof payload.username === "string" && typeof payload.shortUuid === "string" && typeof payload.subscriptionUrl === "string"
          ? payload as { uuid: string; username: string; shortUuid: string; subscriptionUrl: string } : null;
      },
      createUser: async (payload) => {
        const created = await remnaCreateUser(payload);
        if (created.error || !created.data) throw new Error(created.error ?? "Replacement create failed");
        const uuid = extractRemnaUuid(created.data); const subscriptionUrl = extractRemnaSubscriptionUrl(created.data);
        const response = (created.data as { response?: Record<string, unknown> }).response ?? {};
        if (!uuid || !subscriptionUrl || typeof response.shortUuid !== "string") throw new Error("Replacement response missing identity/direct URL");
        return { uuid, username: payload.username, shortUuid: response.shortUuid, subscriptionUrl };
      },
      getUser: async (uuid) => { const user = await remnaGetUser(uuid); if (user.error || !user.data) throw new Error(user.error ?? "Replacement get failed"); return ((user.data as { response?: Record<string, unknown> }).response ?? user.data) as Record<string, unknown>; },
      writeJournal: (kind, payload = {}) => logAdminEvent(kind, null, null, { type: "subscription", id: typeof payload.subscriptionId === "string" ? payload.subscriptionId : null }, payload),
      switchLocal: async (input, replacement) => prisma.$transaction(async (tx) => {
        await tx.subscription.update({ where: { id: input.subscriptionId }, data: { remnawaveUuid: replacement.uuid, remnawaveUsername: replacement.username, remnawaveShortUuid: replacement.shortUuid } });
        await tx.trafficUsageCheckpoint.deleteMany({ where: { subscriptionId: input.subscriptionId } });
        if (input.trafficLimitMode === "LOCAL_SQUAD") {
          const periodStartedAt = new Date();
          const baseLimitBytes = localSquadQuotaLimit(input.trafficLimitBytes);
          await tx.trafficQuotaGrant.updateMany({ where: { quota: { subscriptionId: input.subscriptionId }, status: "ACTIVE", scope: "CURRENT_PERIOD" }, data: { status: "EXPIRED" } });
          const quota = await tx.squadTrafficQuota.upsert({ where: { subscriptionId: input.subscriptionId }, create: { subscriptionId: input.subscriptionId, tariffIdAtPeriodStart: input.tariffId ?? null, meteredSquadUuid: input.meteredSquadUuid ?? "", baseLimitBytes, usedBytes: 0n, periodStartedAt, periodEndsAt: nextMonthlyBoundary(periodStartedAt), notifiedPercents: [], status: "ACTIVE" }, update: { tariffIdAtPeriodStart: input.tariffId ?? null, meteredSquadUuid: input.meteredSquadUuid ?? "", baseLimitBytes, usedBytes: 0n, periodStartedAt, periodEndsAt: nextMonthlyBoundary(periodStartedAt), notifiedPercents: [], status: "ACTIVE", exhaustedAt: null, lastAccountedAt: null } });
          await tx.trafficQuotaEvent.create({ data: { quotaId: quota.id, kind: "CUTOVER_RESET", usedBytes: 0n, limitBytes: quota.baseLimitBytes } });
        }
      }),
    });
  }
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) void main();
