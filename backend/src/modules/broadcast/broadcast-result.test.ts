import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/stealthnet_test";
process.env.JWT_SECRET ??= "test-secret-that-is-long-enough-for-validation";

const { prisma } = await import("../../db.js");
const broadcast = await import("./broadcast.service.js");
const { sweepStaleBroadcastJobs } = await import("./broadcast-stale.scheduler.js");
const workerSource = await readFile(new URL("../../worker/broadcast-worker.ts", import.meta.url), "utf8");

const history = prisma.broadcastHistory as unknown as {
  findUnique: (args: unknown) => Promise<unknown>;
  findMany: (args: unknown) => Promise<unknown>;
  updateMany: (args: unknown) => Promise<unknown>;
};

test("routes SVG and non-raster image MIME types through Telegram documents", () => {
  assert.equal(broadcast.isTelegramPhoto("image/png"), true);
  assert.equal(broadcast.isTelegramPhoto("image/jpeg"), true);
  assert.equal(broadcast.isTelegramPhoto("image/webp"), true);
  assert.equal(broadcast.isTelegramPhoto("image/gif"), true);
  assert.equal(broadcast.isTelegramPhoto("image/svg+xml; charset=utf-8"), false);
  assert.equal(broadcast.isTelegramPhoto("image/heic"), false);
  assert.equal(broadcast.isTelegramPhoto("image/tiff"), false);
  assert.equal(broadcast.isTelegramPhoto("image/x-icon"), false);
});

test("terminal broadcast jobs expose partial failures as unsuccessful results", async () => {
  const originalFindUnique = history.findUnique;
  const row = {
    id: "job-1",
    status: "completed",
    startedAt: new Date("2026-08-23T00:00:00.000Z"),
    finishedAt: new Date("2026-08-23T00:01:00.000Z"),
    error: "worker error",
    totalTelegram: 3,
    totalEmail: 2,
    sentTelegram: 2,
    sentEmail: 1,
    failedTelegram: 1,
    failedEmail: 1,
    errors: ["one failed recipient"],
    cancelRequested: false,
  };

  try {
    history.findUnique = async () => row;
    const completed = await broadcast.getBroadcastJob(row.id);
    assert.deepEqual(completed?.result, {
      ok: false,
      sentTelegram: 2,
      sentEmail: 1,
      failedTelegram: 1,
      failedEmail: 1,
      errors: ["one failed recipient"],
    });

    history.findUnique = async () => ({ ...row, status: "cancelled" });
    const cancelled = await broadcast.getBroadcastJob(row.id);
    assert.deepEqual(cancelled?.result, {
      ok: false,
      sentTelegram: 2,
      sentEmail: 1,
      failedTelegram: 1,
      failedEmail: 1,
      errors: ["one failed recipient"],
      cancelled: true,
    });
  } finally {
    history.findUnique = originalFindUnique;
  }
});

test("worker finalization cannot overwrite a resumed job with an old run token", () => {
  const finalization = workerSource.split("// Финализируем", 2)[1].split("// Удаляем attachment", 2)[0];
  assert.match(finalization, /prisma\.broadcastHistory\.updateMany/);
  assert.match(finalization, /runToken:\s*job\.run_token/);
});

test("worker exception finalization preserves persisted progress and clean completion clears errors", () => {
  const finalization = workerSource.split("// Финализируем", 2)[1].split("// Удаляем attachment", 2)[0];
  assert.match(finalization, /const finalData = lastResult\s*\?/);
  assert.match(finalization, /sentTelegram: lastResult\.sentTelegram/);
  assert.match(finalization, /failedTelegram: finalStatus === "pending" \? 0 : lastResult\.failedTelegram/);
  assert.match(finalization, /failedEmail: finalStatus === "pending" \? 0 : lastResult\.failedEmail/);
  assert.match(finalization, /errors: finalStatus === "pending" \? \[\] : lastResult\.errors\.slice/);
  assert.match(finalization, /: \{[\s\S]*error: finalError/);
  assert.doesNotMatch(finalization, /sentTelegram: lastResult\?\.sentTelegram \?\? 0/);
});

test("pending broadcasts are never swept stale and a healthy lease is retained", async () => {
  const originalFindMany = history.findMany;
  const originalUpdateMany = history.updateMany;
  const now = new Date("2026-08-23T00:30:00.000Z");
  let findManyArgs: unknown;
  let updateManyArgs: unknown;

  try {
    history.findMany = async (args) => {
      findManyArgs = args;
      return [{ id: "running-1", status: "running", runToken: "run-1", leaseExpiresAt: new Date("2026-08-23T00:31:00.000Z") }];
    };
    history.updateMany = async (args) => {
      updateManyArgs = args;
      return { count: 2 };
    };

    assert.equal(await sweepStaleBroadcastJobs(now), 0);
    assert.equal((findManyArgs as { where: { status: unknown } }).where.status, "running");
    assert.equal(updateManyArgs, undefined);
  } finally {
    history.findMany = originalFindMany;
    history.updateMany = originalUpdateMany;
  }
});

test("resume clears broadcast failure state while preserving sent progress", async () => {
  const source = await readFile(new URL("./broadcast.service.ts", import.meta.url), "utf8");
  const resumeStart = source.indexOf("broadcastHistory.update({");
  const resumeEnd = source.indexOf("});", resumeStart);
  const update = source.slice(resumeStart, resumeEnd);
  assert.match(update, /failedTelegram:\s*0/);
  assert.match(update, /failedEmail:\s*0/);
  assert.match(update, /errors:\s*\[\]/);
  assert.match(update, /error:\s*null/);
  assert.doesNotMatch(update, /sentTelegram:\s*0/);
});

test("stale running broadcasts are guarded by token and durable lease", async () => {
  const source = await readFile(new URL("./broadcast-stale.scheduler.ts", import.meta.url), "utf8");
  assert.match(source, /status:\s*"running"/);
  assert.match(source, /leaseExpiresAt/);
  assert.match(source, /runToken/);
  assert.match(source, /updateMany/);
  assert.match(source, /errors:\s*\[/);
});
