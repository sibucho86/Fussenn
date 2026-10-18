import { writeFile } from "node:fs/promises";
import { join } from "node:path";

// desktop.env in the test data folder takes precedence over a developer's
// .env.local, so desktop tests use Mock responses and never start a real Codex CLI.
export async function isolateDesktopSettings(data: string) {
  await writeFile(join(data, "desktop.env"), `CODEX_BIN=${JSON.stringify(join(data, "unavailable-codex"))}\nENABLE_MOCK_PROVIDER=true\nOPENAI_API_KEY=\nOPENAI_COMPAT_API_KEY=\n`);
}

// A stale .desktop or an executable from before the rename reads the SIDENOTE_ names.
// Setting both keeps it on the test data as well, never on everyday data.
export function testDataEnvironment(data: string) {
  return { FUSSENN_DATA_DIR: data, SIDENOTE_DATA_DIR: data, FUSSENN_DISABLE_AUTOMATIC_BACKUP: "true", SIDENOTE_DISABLE_AUTOMATIC_BACKUP: "true" };
}
