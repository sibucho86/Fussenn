import type Database from "better-sqlite3";
import { getDatabaseHandle } from "./db";
import { AppError } from "./errors";

export const REVISION_HEADER = "X-Fussenn-Revision";
export function workspaceRevision(sqlite: Database.Database = getDatabaseHandle().sqlite): string {
  return (sqlite.prepare("SELECT revision FROM workspace_metadata WHERE id = 1").get() as { revision: string }).revision;
}
export function guardWorkspaceWrite(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  if (request.headers.get(REVISION_HEADER) !== workspaceRevision()) throw new AppError("データが復元されたか、画面が古くなっています。再読み込みしてから操作してください。", 409);
}
