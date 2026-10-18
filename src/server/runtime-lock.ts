import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { dataDirectory } from "./db";

// Hold an OS-backed SQLite lock in a separate, data-free file. A crash releases
// it immediately; no stale PID files or time-based lock stealing are needed.
export function acquireRuntimeLock(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = new Database(join(directory, ".runtime.db"), { timeout: 0 });
  try { lock.exec("BEGIN EXCLUSIVE"); }
  catch { lock.close(); throw new Error("同じ保存先を使うFussennが起動中です。ブラウザ版または別のFussennを終了してから起動してください。"); }
  return () => { if (lock.open) lock.close(); };
}
const shared = globalThis as typeof globalThis & { fussennRuntimeRelease?: () => void };
export function lockRuntime() {
  if (shared.fussennRuntimeRelease) return;
  shared.fussennRuntimeRelease = acquireRuntimeLock(dataDirectory());
  process.once("exit", shared.fussennRuntimeRelease);
}
