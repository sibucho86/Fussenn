export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
export type BackupCounts = { conversations: number; documents: number; notes: number; messages: number; folders: number };
export type BackupPreview = { createdAt: string; counts: BackupCounts; currentCounts: BackupCounts; digest: string; bytes: number };
export type AutomaticBackup = { name: string; createdAt: string; bytes: number; kind: "before-restore" | "scheduled" };
export type BackupSchedule = { enabled: boolean; lastSuccessAt: number | null; nextDueAt: number | null; lastError: string | null; keep: number };
export type BackupStatus = { counts: BackupCounts; automaticBackups: AutomaticBackup[]; directory: string; schedule?: BackupSchedule };
export type RestoreResult = { counts: BackupCounts; automaticBackup: AutomaticBackup };
