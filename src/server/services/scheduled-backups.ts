import type Database from "better-sqlite3";
import { AppError, safeError } from "../errors";
import { Backups } from "./backups";
import type { BackupSchedule } from "@/lib/backup";

export const BACKUP_INTERVAL = 24 * 60 * 60 * 1000;
export const BACKUP_RETRY = 5 * 60 * 1000;
export const BACKUP_KEEP = 30;
type State = { enabled: number; last_attempt_at: number | null; last_success_at: number | null; last_file: string | null; last_error: string | null };
export class ScheduledBackups {
  constructor(private sqlite: Database.Database, private backups: Backups, private now = Date.now) {}
  private state() { return this.sqlite.prepare("SELECT * FROM backup_schedule WHERE id = 1").get() as State; }
  status(): BackupSchedule {
    const state = this.state();
    return { enabled: !!state.enabled, lastSuccessAt: state.last_success_at, nextDueAt: state.enabled ? (state.last_success_at === null ? this.now() : state.last_success_at + BACKUP_INTERVAL) : null, lastError: state.last_error, keep: BACKUP_KEEP };
  }
  configure(enabled: boolean) {
    this.sqlite.prepare("UPDATE backup_schedule SET enabled = ?, last_attempt_at = NULL WHERE id = 1").run(Number(enabled));
    return this.status();
  }
  tick(force = false) {
    const now = this.now(), state = this.state();
    if (!force && (!state.enabled || (state.last_success_at !== null && now < state.last_success_at + BACKUP_INTERVAL) || (state.last_attempt_at !== null && now < state.last_attempt_at + BACKUP_RETRY))) return null;
    try {
      const file = this.backups.scheduled();
      this.sqlite.prepare("UPDATE backup_schedule SET last_attempt_at = ?, last_success_at = ?, last_file = ?, last_error = NULL WHERE id = 1").run(now, now, file.name);
      try { this.backups.pruneScheduled(BACKUP_KEEP, file.name); }
      catch { this.sqlite.prepare("UPDATE backup_schedule SET last_error = ? WHERE id = 1").run("バックアップは保存しましたが、古い定期ファイルを整理できませんでした。保存先のアクセス権を確認してください。"); }
      return file;
    } catch (error) {
      // An active answer is retried on the next minute, without recording a failure.
      if (!(error instanceof AppError && error.status === 409)) this.sqlite.prepare("UPDATE backup_schedule SET last_attempt_at = ?, last_error = ? WHERE id = 1").run(now, safeError(error));
      if (force) throw error;
      return null;
    }
  }
}
