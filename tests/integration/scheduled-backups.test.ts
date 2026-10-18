import { afterEach, beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "@/server/db";
import { Store } from "@/server/services/store";
import { Backups } from "@/server/services/backups";
import { BACKUP_INTERVAL, BACKUP_KEEP, BACKUP_RETRY, ScheduledBackups } from "@/server/services/scheduled-backups";
import { decodeBackup, digest } from "@/server/services/backup-format";
import { workspaceRevision } from "@/server/workspace-revision";

let db: ReturnType<typeof openDatabase>, directory: string, store: Store, backups: Backups, schedule: ScheduledBackups, now: number;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "fussenn-scheduled-")); db = openDatabase(join(directory, "fussenn.db"));
  store = new Store(db.db); store.createConversation("mock", "mock-demo");
  backups = new Backups(db.sqlite, directory); now = Date.now(); schedule = new ScheduledBackups(db.sqlite, backups, () => now);
});
afterEach(() => db.sqlite.close());

it("saves when first opened, waits a day and catches up after the next restart", () => {
  const first = schedule.tick()!;
  expect(first.kind).toBe("scheduled");
  expect(decodeBackup(backups.read(first.name)).data.conversations).toHaveLength(1);
  expect(schedule.status()).toMatchObject({ enabled: true, lastSuccessAt: now, nextDueAt: now + BACKUP_INTERVAL, keep: 30 });
  now += BACKUP_INTERVAL - 1; expect(schedule.tick()).toBeNull();
  db.sqlite.close(); db = openDatabase(join(directory, "fussenn.db"));
  backups = new Backups(db.sqlite, directory); schedule = new ScheduledBackups(db.sqlite, backups, () => now);
  expect(schedule.tick()).toBeNull();
  now += BACKUP_INTERVAL * 3; expect(schedule.tick()).not.toBeNull();
  expect(backups.list()).toHaveLength(2);
});

it("keeps the on/off preference when restoring a content backup and persists it across a restart", () => {
  const bytes = backups.export(); schedule.configure(false);
  expect(schedule.tick()).toBeNull();
  backups.restore(bytes, digest(bytes), workspaceRevision(db.sqlite));
  expect(schedule.status().enabled).toBe(false);
  db.sqlite.close(); db = openDatabase(join(directory, "fussenn.db"));
  schedule = new ScheduledBackups(db.sqlite, new Backups(db.sqlite, directory), () => now);
  expect(schedule.status().enabled).toBe(false);
  schedule.configure(true); expect(schedule.tick()?.kind).toBe("scheduled");
});

it("defers an active answer and retries immediately after it finishes", () => {
  const conversation = store.listConversations()[0]; const pair = store.beginMain(conversation.id, "question");
  expect(schedule.tick()).toBeNull();
  expect(schedule.status()).toMatchObject({ lastSuccessAt: null, lastError: null });
  expect(backups.list()).toEqual([]);
  store.finishMain(conversation.id, pair.assistantMessage.id, "complete", "complete");
  expect(schedule.tick()).not.toBeNull();
});

it("records a write failure, limits retries and recovers without losing existing data", () => {
  const before = backups.export(); const rows = decodeBackup(before).data;
  writeFileSync(backups.directory, "file blocks the directory");
  expect(schedule.tick()).toBeNull();
  expect(schedule.status()).toMatchObject({ lastSuccessAt: null, lastError: expect.stringContaining("保存できません") });
  unlinkSync(backups.directory);
  now += BACKUP_RETRY - 1; expect(schedule.tick()).toBeNull();
  now += 1; expect(schedule.tick()).not.toBeNull();
  expect(schedule.status().lastError).toBeNull();
  expect(decodeBackup(backups.export()).data).toEqual(rows);
});

it("retains thirty periodic copies and preserves restoration copies, partial files and unrelated files", () => {
  const bytes = backups.export();
  const safety = backups.restore(bytes, digest(bytes), workspaceRevision(db.sqlite)).automaticBackup;
  const unknown = join(backups.directory, "personal.json"), partial = join(backups.directory, "scheduled-incomplete.sidenote.json.partial");
  const currentPartial = join(backups.directory, "scheduled-incomplete.fussenn.json.partial");
  writeFileSync(unknown, "keep me"); writeFileSync(partial, "partial"); writeFileSync(currentPartial, "partial");
  for (let day = 0; day < BACKUP_KEEP + 4; day++) { now += BACKUP_INTERVAL; expect(schedule.tick()).not.toBeNull(); }
  const all = backups.list(Infinity);
  expect(all.filter((file) => file.kind === "scheduled")).toHaveLength(BACKUP_KEEP);
  expect(all.filter((file) => file.kind === "before-restore")).toEqual([expect.objectContaining({ name: safety.name, bytes: safety.bytes, kind: safety.kind })]);
  expect(decodeBackup(backups.read(safety.name)).data).toEqual(decodeBackup(bytes).data);
  expect(readdirSync(backups.directory)).toEqual(expect.arrayContaining(["personal.json", "scheduled-incomplete.sidenote.json.partial", "scheduled-incomplete.fussenn.json.partial"]));
  const last = (db.sqlite.prepare("SELECT last_file FROM backup_schedule WHERE id = 1").get() as { last_file: string }).last_file;
  expect(decodeBackup(backups.read(last)).data.conversations).toHaveLength(1);
  expect(() => backups.pruneScheduled(0)).toThrow();
});

it("keeps automatic backups made before the rename in the history and in the retention count", () => {
  const file = JSON.parse(backups.export().toString("utf8"));
  const body = { format: "sidenote-backup", version: file.version, createdAt: file.createdAt, data: file.data };
  const previous = `scheduled-2026-01-01T00-00-00-000Z-${randomUUID()}.sidenote.json`, path = join(backups.directory, previous);
  mkdirSync(backups.directory, { recursive: true });
  writeFileSync(path, JSON.stringify({ ...body, checksum: digest(JSON.stringify(body)) }));
  utimesSync(path, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
  expect(backups.list(Infinity).map((entry) => entry.name)).toContain(previous);
  expect(decodeBackup(backups.read(previous)).data.conversations).toHaveLength(1);
  for (let day = 0; day < BACKUP_KEEP; day++) { now += BACKUP_INTERVAL; expect(schedule.tick()).not.toBeNull(); }
  const scheduled = backups.list(Infinity).filter((entry) => entry.kind === "scheduled");
  expect(scheduled).toHaveLength(BACKUP_KEEP);
  expect(scheduled.map((entry) => entry.name)).not.toContain(previous);
  expect(scheduled.every((entry) => entry.name.endsWith(".fussenn.json"))).toBe(true);
});
