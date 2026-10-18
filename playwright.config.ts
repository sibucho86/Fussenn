import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A stale build from before the rename reads the SIDENOTE_ names. Setting both keeps
// it on this temporary data as well, never on everyday data.
const data = mkdtempSync(join(tmpdir(), "fussenn-e2e-"));

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://127.0.0.1:3100", viewport: { width: 1440, height: 1000 }, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: "npm run start -- --port 3100",
    url: "http://127.0.0.1:3100/api/settings",
    timeout: 120_000,
    reuseExistingServer: false,
    env: { ENABLE_MOCK_PROVIDER: "true", FUSSENN_DATA_DIR: data, SIDENOTE_DATA_DIR: data, NEXT_TELEMETRY_DISABLED: "1", FUSSENN_DISABLE_AUTOMATIC_BACKUP: "true", SIDENOTE_DISABLE_AUTOMATIC_BACKUP: "true" },
  },
});
