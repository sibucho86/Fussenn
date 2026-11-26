import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Screenshots for the download page (site/images). They are taken from demo data in a new,
// empty data folder with the Mock provider, so no everyday data or real AI is involved.
// Run with npm run site:images, which builds the app first.
const data = mkdtempSync(join(tmpdir(), "fussenn-site-"));

export default defineConfig({
  testDir: "./tests/site",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:3200", viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, trace: "retain-on-failure" },
  webServer: {
    command: "npm run start -- --port 3200",
    url: "http://127.0.0.1:3200/api/settings",
    timeout: 120_000,
    reuseExistingServer: false,
    env: { ENABLE_MOCK_PROVIDER: "true", FUSSENN_DATA_DIR: data, SIDENOTE_DATA_DIR: data, NEXT_TELEMETRY_DISABLED: "1", FUSSENN_DISABLE_AUTOMATIC_BACKUP: "true", SIDENOTE_DISABLE_AUTOMATIC_BACKUP: "true" },
  },
});
