import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Data created before the rename from SideNote AI is never moved: a folder or
// database with the previous name is used in place until a Fussenn one exists.
let defaultDirectory: string | undefined;
export function dataDirectory() {
  const configured = process.env.FUSSENN_DATA_DIR || process.env.SIDENOTE_DATA_DIR;
  if (configured) return configured;
  // Decide once per process, so a folder created later cannot switch the data mid-run.
  if (!defaultDirectory) {
    const current = join(homedir(), ".fussenn"), previous = join(homedir(), ".sidenote-ai");
    defaultDirectory = !existsSync(current) && existsSync(previous) ? previous : current;
  }
  return defaultDirectory;
}

export function databaseFile(directory: string) {
  const current = join(directory, "fussenn.db"), previous = join(directory, "sidenote.db");
  return !existsSync(current) && existsSync(previous) ? previous : current;
}
