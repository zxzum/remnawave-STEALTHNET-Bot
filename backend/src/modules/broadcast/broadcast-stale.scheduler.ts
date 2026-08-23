import { prisma } from "../../db.js";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const STALE_AFTER_MS = 15 * 60 * 1000;
const STALE_STATUSES = ["pending", "running"] as const;
const HINT =
  "Рассылка зависла в очереди — похоже, не запущен сервис broadcast-worker " +
  "(проверьте `docker compose ps broadcast-worker` и `docker compose up -d`)";

let timer: NodeJS.Timeout | null = null;

export async function sweepStaleBroadcastJobs(now = new Date()): Promise<number> {
  const threshold = new Date(now.getTime() - STALE_AFTER_MS);
  const stuck = await prisma.broadcastHistory.findMany({
    where: { status: { in: [...STALE_STATUSES] }, startedAt: { lt: threshold } },
    select: { id: true, status: true, startedAt: true },
  });
  if (stuck.length === 0) return 0;

  const result = await prisma.broadcastHistory.updateMany({
    where: { OR: stuck.map((job) => ({ id: job.id, status: job.status })) },
    data: { status: "error", finishedAt: now, error: HINT },
  });
  console.error(`[broadcast-stale] marked ${result.count} stale jobs as error`);
  return result.count;
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
