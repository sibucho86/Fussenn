import { dataDirectory, getDatabaseHandle } from "./db";
import { generations } from "./services/generation";
import { Backups } from "./services/backups";
import { ScheduledBackups } from "./services/scheduled-backups";

const shared = globalThis as typeof globalThis & { fussennBackupTimer?: ReturnType<typeof setInterval>; fussennBackupService?: ScheduledBackups };
export function getBackupSchedule() {
  if (!shared.fussennBackupService) {
    const { sqlite } = getDatabaseHandle();
    shared.fussennBackupService = new ScheduledBackups(sqlite, new Backups(sqlite, dataDirectory(), () => generations.size > 0));
  }
  return shared.fussennBackupService;
}
export function startBackupScheduler() {
  if (shared.fussennBackupTimer || process.env.FUSSENN_DISABLE_AUTOMATIC_BACKUP === "true") return;
  const tick = () => {
    try { getBackupSchedule().tick(); }
    catch { console.error("Fussenn: 自動バックアップの状態を確認できません。設定画面と保存先を確認してください。"); }
  };
  shared.fussennBackupTimer = setInterval(tick, 60_000);
  shared.fussennBackupTimer.unref();
  setTimeout(tick, 5_000).unref();
}
