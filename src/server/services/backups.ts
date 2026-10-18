import type Database from "better-sqlite3";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { MAX_BACKUP_BYTES, type AutomaticBackup, type BackupCounts, type BackupStatus, type RestoreResult } from "@/lib/backup";
import { AppError } from "../errors";
import { workspaceRevision } from "../workspace-revision";
import { backupCounts, backupRows, decodeBackup, digest, encodeBackup, type BackupData } from "./backup-format";

const tables = Object.keys(backupRows) as (keyof BackupData)[];
// Automatic backups made before the rename keep their .sidenote.json name and stay in the history.
const filePattern = /^(before-restore|scheduled)-[\dTZ-]+-[a-f0-9-]{36}\.(?:fussenn|sidenote)\.json$/;
export class Backups {
  readonly directory: string;
  constructor(private sqlite: Database.Database, directory: string, private generating: () => boolean = () => false) { this.directory = join(directory, "backups"); }
  private idle() {
    const active = this.sqlite.prepare("SELECT (SELECT COUNT(*) FROM messages WHERE status = 'streaming') + (SELECT COUNT(*) FROM side_note_messages WHERE status = 'streaming') AS count").get() as { count: number };
    if (this.generating() || active.count) throw new AppError("AIの回答が終わってから、バックアップ・復元を行ってください。", 409);
  }
  private data(): BackupData {
    return Object.fromEntries(tables.map((table) => {
      const columns = Object.keys(backupRows[table].shape);
      const condition = table === "app_settings" ? " WHERE key IN ('defaultProvider','codexDefaultModel','openaiModel','compatibleBaseUrl','compatibleModel')" : "";
      return [table, this.sqlite.prepare(`SELECT ${columns.join(",")} FROM ${table}${condition} ORDER BY ${columns[0]}`).all()];
    })) as BackupData;
  }
  export() { return this.sqlite.transaction(() => { this.idle(); return encodeBackup(this.data()); })(); }
  private counts(): BackupCounts {
    return this.sqlite.prepare(`SELECT
      (SELECT COUNT(*) FROM conversations) - (SELECT COUNT(*) FROM document_sources) AS conversations,
      (SELECT COUNT(*) FROM document_sources) AS documents,
      (SELECT COUNT(*) FROM side_notes) AS notes,
      (SELECT COUNT(*) FROM messages) + (SELECT COUNT(*) FROM side_note_messages) AS messages,
      (SELECT COUNT(*) FROM conversation_folders) AS folders`).get() as BackupCounts;
  }
  status(): BackupStatus {
    return { counts: this.counts(), automaticBackups: this.list(), directory: this.directory };
  }
  inspect(bytes: Uint8Array) {
    const backup = decodeBackup(bytes);
    return { createdAt: backup.createdAt, counts: backupCounts(backup.data), currentCounts: this.counts(), digest: digest(bytes), bytes: bytes.length };
  }
  scheduled() { return this.sqlite.transaction(() => { this.idle(); return this.automatic(encodeBackup(this.data()), "scheduled"); }).immediate(); }
  private automatic(bytes: Uint8Array, kind: AutomaticBackup["kind"] = "before-restore"): AutomaticBackup {
    const createdAt = new Date().toISOString();
    const name = `${kind}-${createdAt.replace(/[:.]/g, "-")}-${randomUUID()}.fussenn.json`;
    const path = join(this.directory, name);
    const partial = `${path}.partial`;
    let descriptor: number | undefined;
    let created = false;
    try {
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      descriptor = openSync(partial, "wx", 0o600); created = true;
      writeFileSync(descriptor, bytes); fsyncSync(descriptor);
      closeSync(descriptor); descriptor = undefined;
      renameSync(partial, path);
      return { name, createdAt, bytes: bytes.length, kind };
    } catch {
      if (descriptor !== undefined) { try { closeSync(descriptor); } catch { /* Preserve original failure. */ } }
      if (created) { try { unlinkSync(partial); } catch { /* Partial files are excluded from the history. */ } }
      if (kind === "scheduled") throw new AppError("定期バックアップを保存できませんでした。保存先の空き容量・アクセス権を確認してください。", 500);
      throw new AppError("現在のデータを自動退避できませんでした。保存先の空き容量・アクセス権を確認してください。復元は行っていません。", 500);
    }
  }
  restore(bytes: Uint8Array, expectedDigest: string, expectedRevision: string): RestoreResult {
    if (digest(bytes) !== expectedDigest) throw new AppError("確認したファイルと内容が変わっています。もう一度ファイルを選んでください。");
    const backup = decodeBackup(bytes);
    return this.sqlite.transaction(() => {
      if (workspaceRevision(this.sqlite) !== expectedRevision) throw new AppError("別の画面でデータが復元されました。再読み込みして内容を確認してください。", 409);
      this.idle();
      // The durable safety copy must succeed before any existing row is removed.
      const automaticBackup = this.automatic(encodeBackup(this.data()));
      try {
        for (const table of [...tables].reverse()) this.sqlite.exec(`DELETE FROM ${table}`);
        for (const table of tables) {
          const columns = Object.keys(backupRows[table].shape);
          const insert = this.sqlite.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map((c) => `@${c}`).join(",")})`);
          for (const original of backup.data[table]) {
            const row = { ...original };
            if ("status" in row && row.status === "streaming") row.status = "error";
            // Provider sessions are intentionally absent: resumed threads could contain later history.
            insert.run(row);
          }
        }
        this.sqlite.prepare("UPDATE workspace_metadata SET revision = ? WHERE id = 1").run(randomUUID());
        return { counts: backupCounts(backup.data), automaticBackup };
      } catch { throw new AppError("復元を完了できませんでした。変更を取り消し、元のデータを保持しています。自動退避ファイルも保存済みです。", 500); }
    }).immediate();
  }
  list(limit = 20): AutomaticBackup[] {
    if (!existsSync(this.directory)) return [];
    return readdirSync(this.directory).filter((name) => filePattern.test(name)).flatMap((name): AutomaticBackup[] => {
      try {
        const info = lstatSync(join(this.directory, name));
        return info.isFile() ? [{ name, createdAt: info.mtime.toISOString(), bytes: info.size, kind: name.startsWith("scheduled-") ? "scheduled" : "before-restore" }] : [];
      } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name)).slice(0, limit);
  }
  pruneScheduled(keep: number, newest?: string) {
    if (!Number.isInteger(keep) || keep < 1) throw new Error("At least one scheduled backup must be kept.");
    const scheduled = this.list(Infinity).filter((file) => file.kind === "scheduled");
    if (newest) scheduled.sort((a, b) => Number(b.name === newest) - Number(a.name === newest));
    for (const file of scheduled.slice(keep)) {
      // Only generated regular files inside this backup directory are eligible.
      unlinkSync(join(this.directory, file.name));
    }
  }
  read(name: string) {
    if (!filePattern.test(name)) throw new AppError("退避ファイルが見つかりません。", 404);
    const path = join(this.directory, name);
    if (!existsSync(path)) throw new AppError("退避ファイルが見つかりません。", 404);
    const info = lstatSync(path);
    if (!info.isFile() || info.size > MAX_BACKUP_BYTES) throw new AppError("この退避ファイルは読み込めません。");
    return readFileSync(path);
  }
}

export async function readBackupUpload(request: Request) {
  if (Number(request.headers.get("content-length")) > MAX_BACKUP_BYTES) throw new AppError("バックアップは64MBまでです。", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("バックアップファイルを選んでください。");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BACKUP_BYTES) { await reader.cancel(); throw new AppError("バックアップは64MBまでです。", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}
