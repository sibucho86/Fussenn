import { afterEach, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let home: string;
// The default folder is decided once per process, so each start loads the module afresh.
async function start() { vi.resetModules(); return import("@/server/db/location"); }
function newHome() {
  home = mkdtempSync(join(tmpdir(), "fussenn-home-"));
  vi.stubEnv("HOME", home); vi.stubEnv("USERPROFILE", home); vi.stubEnv("FUSSENN_DATA_DIR", ""); vi.stubEnv("SIDENOTE_DATA_DIR", "");
}
afterEach(() => { vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }); });

it("uses ~/.fussenn for a new installation", async () => {
  newHome();
  expect((await start()).dataDirectory()).toBe(join(home, ".fussenn"));
});

it("keeps using a folder from before the rename in place, and never switches while running", async () => {
  newHome(); mkdirSync(join(home, ".sidenote-ai"));
  const running = await start();
  expect(running.dataDirectory()).toBe(join(home, ".sidenote-ai"));
  mkdirSync(join(home, ".fussenn"));
  expect(running.dataDirectory()).toBe(join(home, ".sidenote-ai"));
  expect((await start()).dataDirectory()).toBe(join(home, ".fussenn"));
});

it("prefers FUSSENN_DATA_DIR and still accepts SIDENOTE_DATA_DIR", async () => {
  newHome();
  vi.stubEnv("SIDENOTE_DATA_DIR", join(home, "previous"));
  expect((await start()).dataDirectory()).toBe(join(home, "previous"));
  vi.stubEnv("FUSSENN_DATA_DIR", join(home, "current"));
  expect((await start()).dataDirectory()).toBe(join(home, "current"));
});

it("opens sidenote.db from before the rename until fussenn.db exists", async () => {
  newHome();
  const { databaseFile } = await start(), directory = join(home, "data");
  mkdirSync(directory);
  expect(databaseFile(directory)).toBe(join(directory, "fussenn.db"));
  writeFileSync(join(directory, "sidenote.db"), "");
  expect(databaseFile(directory)).toBe(join(directory, "sidenote.db"));
  writeFileSync(join(directory, "fussenn.db"), "");
  expect(databaseFile(directory)).toBe(join(directory, "fussenn.db"));
});
