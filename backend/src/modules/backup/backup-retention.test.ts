import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";

const backupRoot = await mkdtemp(path.join(tmpdir(), "lazeyka-backups-"));
process.env.BACKUPS_DIR = backupRoot;

const { deleteExpiredBackups } = await import("./backup.service.js");

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

test("deletes only expired SQL files beneath BACKUPS_DIR", async () => {
  const now = new Date("2026-08-23T00:00:00.000Z");
  const cutoff = new Date("2026-08-16T00:00:00.000Z");
  const oldFile = path.join(backupRoot, "2026", "08", "01", "old.sql");
  const boundaryFile = path.join(backupRoot, "2026", "08", "16", "boundary.sql");
  const newFile = path.join(backupRoot, "2026", "08", "22", "new.sql");
  const nonSqlFile = path.join(backupRoot, "2026", "08", "01", "notes.txt");
  const outsideRoot = await mkdtemp(path.join(tmpdir(), "lazeyka-outside-"));
  const outsideFile = path.join(outsideRoot, "outside.sql");
  const symlinkFile = path.join(backupRoot, "2026", "08", "01", "outside.sql");

  try {
    await Promise.all([
      mkdir(path.dirname(oldFile), { recursive: true }),
      mkdir(path.dirname(boundaryFile), { recursive: true }),
      mkdir(path.dirname(newFile), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(oldFile, "old"),
      writeFile(boundaryFile, "boundary"),
      writeFile(newFile, "new"),
      writeFile(nonSqlFile, "keep"),
      writeFile(outsideFile, "outside"),
    ]);
    await Promise.all([
      utimes(oldFile, now, new Date(cutoff.getTime() - 1)),
      utimes(boundaryFile, now, cutoff),
      utimes(newFile, now, now),
      utimes(nonSqlFile, now, new Date(cutoff.getTime() - 1)),
      utimes(outsideFile, now, new Date(cutoff.getTime() - 1)),
    ]);
    await symlink(outsideFile, symlinkFile);

    assert.equal(await deleteExpiredBackups(7, now), 1);
    assert.equal(await exists(oldFile), false);
    assert.equal(await exists(boundaryFile), true);
    assert.equal(await exists(newFile), true);
    assert.equal(await exists(nonSqlFile), true);
    assert.equal(await exists(outsideFile), true);
    assert.equal(await exists(symlinkFile), true);
  } finally {
    await Promise.all([
      rm(backupRoot, { recursive: true, force: true }),
      rm(outsideRoot, { recursive: true, force: true }),
    ]);
  }
});
