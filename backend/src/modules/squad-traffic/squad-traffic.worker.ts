import cron from "node-cron";

import { prisma } from "../../db.js";
import { registerCron, wrapCronTick } from "../diagnostics/cron-registry.js";
import { accountTrafficBatch } from "./traffic-accounting.service.js";
import { brokerTrafficUsage } from "./traffic-usage.broker.js";
import { enforceExhaustedQuota } from "./traffic-enforcement.service.js";
import { notifyTrafficMilestones } from "./traffic-notification.service.js";
import { rolloverTrafficQuota } from "./traffic-entitlement.service.js";

const CRON_NAME = "squad-traffic-accounting";
const ENFORCEMENT_SETTING = "squad_traffic_enforcement_enabled";
let workerRunning = false;
let lastFullPassAt = 0;
let lastSquadDiagnostics: Array<{ squadUuid: string; nodeCount: number; error: string | null }> = [];

type BrokerResult = Awaited<ReturnType<typeof brokerTrafficUsage>>;
type AccountingResult = Awaited<ReturnType<typeof accountTrafficBatch>>;

export type SquadTrafficWorkerDependencies = {
  listActiveQuotas: () => Promise<Array<{ subscriptionId: string; meteredSquadUuid: string | null; remnawaveUsername: string | null }>>;
  rollover: (subscriptionId: string) => Promise<unknown>;
  broker: (quotas: Array<{ subscriptionId: string; meteredSquadUuid: string | null; remnawaveUsername: string | null }>, days: Parameters<typeof brokerTrafficUsage>[1]) => Promise<BrokerResult>;
  account: (samples: Parameters<typeof accountTrafficBatch>[0], now: Date) => Promise<AccountingResult>;
  notify: (subscriptionId: string, percents: number[]) => Promise<unknown>;
  enforce: (subscriptionId: string) => Promise<unknown>;
  isEnforcementEnabled: () => Promise<boolean>;
  saveState: (state: { startedAt: Date; finishedAt: Date; durationMs: number; processedCount: number; changedCount: number; apiRequestCount: number; error?: string; observeOnly: boolean }) => Promise<unknown>;
};

function utcDays(now: Date) {
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const yesterday = new Date(startOfDay.getTime() - 86_400_000);
  const tomorrow = new Date(startOfDay.getTime() + 86_400_000);
  const range = (start: Date, end: Date) => ({ start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) });
  return { today: range(startOfDay, tomorrow), yesterday: range(yesterday, startOfDay) };
}

const productionDependencies: SquadTrafficWorkerDependencies = {
  listActiveQuotas: () => prisma.squadTrafficQuota.findMany({
    where: { status: "ACTIVE" },
    select: { subscriptionId: true, meteredSquadUuid: true, subscription: { select: { remnawaveUsername: true } } },
  }).then((rows) => rows.map((row) => ({ ...row, remnawaveUsername: row.subscription.remnawaveUsername }))),
  rollover: (subscriptionId) => rolloverTrafficQuota(subscriptionId),
  broker: brokerTrafficUsage,
  account: accountTrafficBatch,
  notify: notifyTrafficMilestones,
  enforce: enforceExhaustedQuota,
  isEnforcementEnabled: async () => {
    const setting = await prisma.systemSetting.upsert({
      where: { key: ENFORCEMENT_SETTING },
      create: { key: ENFORCEMENT_SETTING, value: "false" },
      update: {},
    });
    return setting.value === "true";
  },
  saveState: async (state) => {
    await prisma.trafficAccountingWorkerState.upsert({
      where: { id: "singleton" },
      create: {
        id: "singleton", lastStartedAt: state.startedAt, lastSucceededAt: state.error ? null : state.finishedAt,
        durationMs: state.durationMs, processedCount: state.processedCount, changedCount: state.changedCount,
        apiRequestCount: state.apiRequestCount, lastError: state.error ?? null, observeOnly: state.observeOnly,
      },
      update: {
        lastStartedAt: state.startedAt, ...(state.error ? {} : { lastSucceededAt: state.finishedAt }),
        durationMs: state.durationMs, processedCount: state.processedCount, changedCount: state.changedCount,
        apiRequestCount: state.apiRequestCount, lastError: state.error ?? null, observeOnly: state.observeOnly,
      },
    });
  },
};

export async function runSquadTrafficAccounting(
  options: { observeOnly?: boolean } = {},
  dependencies: SquadTrafficWorkerDependencies = productionDependencies,
): Promise<{ ok: boolean; processed: number; changed: number; wouldEnforce: number; enforced: number; error?: string }> {
  if (workerRunning) return { ok: false, processed: 0, changed: 0, wouldEnforce: 0, enforced: 0, error: "WORKER_ALREADY_RUNNING" };
  workerRunning = true;
  const startedAt = new Date();
  let processed = 0;
  let changed = 0;
  let apiRequestCount = 0;
  let wouldEnforce = 0;
  let enforced = 0;
  const observeOnly = options.observeOnly ?? !(await dependencies.isEnforcementEnabled());
  try {
    const quotas = await dependencies.listActiveQuotas();
    for (const quota of quotas) await dependencies.rollover(quota.subscriptionId);
    const broker = await dependencies.broker(quotas, utcDays(startedAt));
    lastSquadDiagnostics = [...broker.squadDiagnostics.values()].map((item) => ({
      squadUuid: item.squadUuid,
      nodeCount: item.nodeUuids.length,
      error: item.error ?? null,
    }));
    apiRequestCount = [...broker.squadDiagnostics.values()].filter((item) => !item.error).length * 2;
    const samples = [...broker.usageBySubscription].flatMap(([subscriptionId, usage]) => [
      { subscriptionId, date: utcDays(startedAt).yesterday.start.slice(0, 10), observedBytes: usage.yesterdayBytes },
      { subscriptionId, date: utcDays(startedAt).today.start.slice(0, 10), observedBytes: usage.todayBytes },
    ]);
    const accounting = await dependencies.account(samples, startedAt);
    processed = samples.length;
    changed = accounting.changedCount;
    for (const [subscriptionId, percents] of accounting.crossedPercentsBySubscription) await dependencies.notify(subscriptionId, percents);
    for (const subscriptionId of accounting.exhaustedSubscriptionIds) {
      if (observeOnly) wouldEnforce++;
      else {
        await dependencies.enforce(subscriptionId);
        enforced++;
      }
    }
    const finishedAt = new Date();
    await dependencies.saveState({ startedAt, finishedAt, durationMs: finishedAt.getTime() - startedAt.getTime(), processedCount: processed, changedCount: changed, apiRequestCount, observeOnly });
    return { ok: true, processed, changed, wouldEnforce, enforced };
  } catch (error) {
    const finishedAt = new Date();
    const message = error instanceof Error ? error.message : String(error);
    await dependencies.saveState({ startedAt, finishedAt, durationMs: finishedAt.getTime() - startedAt.getTime(), processedCount: processed, changedCount: changed, apiRequestCount, error: message, observeOnly });
    return { ok: false, processed, changed, wouldEnforce, enforced, error: message };
  } finally {
    workerRunning = false;
  }
}

export function getSquadTrafficRuntimeDiagnostics() {
  return lastSquadDiagnostics.map((item) => ({ ...item }));
}

export function startSquadTrafficWorker() {
  const tick = async () => {
    const now = Date.now();
    if (now - lastFullPassAt < 5 * 60_000) return;
    lastFullPassAt = now;
    await runSquadTrafficAccounting();
  };
  registerCron({ name: CRON_NAME, cron: "* * * * *", description: "Usage accounting for metered traffic squads", trigger: tick });
  cron.schedule("* * * * *", wrapCronTick(CRON_NAME, tick));
}
