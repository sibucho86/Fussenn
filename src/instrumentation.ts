export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.FUSSENN_SERVER_RUNNING === "true") {
    const { lockRuntime } = await import("./server/runtime-lock");
    lockRuntime();
    const { startBackupScheduler } = await import("./server/backup-scheduler");
    startBackupScheduler();
  }
}
