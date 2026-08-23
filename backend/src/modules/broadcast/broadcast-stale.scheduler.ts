import { prisma } from "../../db.js";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const STALE_AFTER_MS = 15 * 60 * 1000;
const HINT =
  "Рассылка зависла в очереди — похоже, не запущен сервис broadcast-worker " +
  "(проверьте `docker compose ps broadcast-worker` и `docker compose up -d`)";

let timer: NodeJS.Timeout | null = null;

export async function sweepStaleBroadcastJobs(now = new Date()): Promise<number> {
  const threshold = new Date(now.getTime() - STALE_AFTER_MS);
  const stuck = await prisma.broadcastHistory.findMany({
    where: {
      status: "running",
      OR: [
        { leaseExpiresAt: { lt: now } },
        { leaseExpiresAt: null, startedAt: { lt: threshold } },
      ],
    },
    select: { id: true, runToken: true, leaseExpiresAt: true },
  });
  let marked = 0;
  for (const job of stuck) {
    // Keep this guard in-process as well as in SQL: it makes a healthy
    // heartbeat harmless even if a mocked/replica read is briefly stale.
    if (job.leaseExpiresAt && job.leaseExpiresAt > now) continue;
    const result = await prisma.broadcastHistory.updateMany({
      where: { id: job.id, status: "running", runToken: job.runToken },
      data: {
        status: "error",
        finishedAt: now,
        errors: [HINT],
        error: HINT,
        runToken: null,
        heartbeatAt: null,
        leaseExpiresAt: null,
      },
    });
    marked += result.count;
  }
  if (marked > 0) console.error(`[broadcast-stale] marked ${marked} stale jobs as error`);
  return marked;
}

export function startBroadcastStaleScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    void sweepStaleBroadcastJobs().catch((error) => {
      console.error("[broadcast-stale] sweep failed:", error instanceof Error ? error.message : error);
    });
  }, CHECK_INTERVAL_MS);
  console.log("[broadcast-stale] Scheduler started: every 5 min, threshold 15 min");
}

export function stopBroadcastStaleScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
