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

test("worker finalization cannot overwrite a stale terminal job", () => {
  const finalization = workerSource.split("// Финализируем", 2)[1].split("// Удаляем attachment", 2)[0];
  assert.match(finalization, /prisma\.broadcastHistory\.updateMany/);
  assert.match(finalization, /where:\s*\{\s*id:\s*job\.id,\s*status:\s*\"running\"\s*\}/);
});

test("stale pending and running broadcasts are moved to error", async () => {
  const originalFindMany = history.findMany;
  const originalUpdateMany = history.updateMany;
  const now = new Date("2026-08-23T00:30:00.000Z");
  let findManyArgs: unknown;
  let updateManyArgs: unknown;

  try {
    history.findMany = async (args) => {
      findManyArgs = args;
      return [
        { id: "pending-1", status: "pending", startedAt: new Date("2026-08-23T00:00:00.000Z") },
        { id: "running-1", status: "running", startedAt: new Date("2026-08-23T00:00:00.000Z") },
      ];
    };
    history.updateMany = async (args) => {
      updateManyArgs = args;
      return { count: 2 };
    };

    assert.equal(await sweepStaleBroadcastJobs(now), 2);
    assert.deepEqual((findManyArgs as { where: { status: unknown } }).where.status, { in: ["pending", "running"] });
    const update = updateManyArgs as { data: { status: string; finishedAt: Date; error: string } };
    assert.equal(update.data.status, "error");
    assert.equal(update.data.finishedAt, now);
    assert.match(update.data.error, /broadcast-worker/);
  } finally {
    history.findMany = originalFindMany;
    history.updateMany = originalUpdateMany;
  }
});
