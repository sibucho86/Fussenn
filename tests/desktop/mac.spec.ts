import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isolateDesktopSettings, testDataEnvironment } from "../fixtures/desktop";

test.skip(process.platform !== "darwin", "Mac keyboard shortcuts and application menu");

let app: ElectronApplication;
let page: Page;
let data: string;
const minimalPath = "/usr/bin:/bin:/usr/sbin:/sbin";
const original = "一行目の原稿。\n\n二行目の原稿。";

async function launch() {
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
    PATH: minimalPath,
    ...testDataEnvironment(data),
    ENABLE_MOCK_PROVIDER: "true",
    CODEX_BIN: join(data, "unavailable-codex"),
  };
  for (const key of ["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS", "NODE_PATH", "OPENAI_API_KEY", "OPENAI_COMPAT_API_KEY"]) delete env[key];
  app = await electron.launch({
    ...(process.env.FUSSENN_DESKTOP_EXE ? { executablePath: process.env.FUSSENN_DESKTOP_EXE, args: [] } : { args: [resolve(".desktop/app")] }),
    env, timeout: 60_000,
  });
  page = await app.firstWindow();
  await page.waitForURL("fussenn://app/");
  await expect(page.getByRole("button", { name: /^資料を開く/ })).toBeVisible();
  expect(await app.evaluate(() => process.env.PATH)).toBe(minimalPath);
  expect(await app.evaluate(({ app }) => app.getPath("userData"))).toBe(join(data, "desktop"));
}

async function api(path: string, method = "GET", body?: unknown) {
  return page.evaluate(async ({ path, method, body }) => {
    const revision = (await fetch("/api/workspace")).headers.get("x-fussenn-revision")!;
    const response = await fetch(`/api/${path}`, {
      method, headers: { "content-type": "application/json", "x-fussenn-revision": revision },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    return result;
  }, { path, method, body });
}

async function manuscript() {
  await api("settings", "PATCH", { defaultProvider: "mock" });
  const created = await api("manuscripts", "POST", { title: "Macで書く原稿", file: { fileName: "原稿.md", content: original } });
  await page.goto(`fussenn://app/?chat=${created.id}`);
  const editor = page.getByRole("textbox", { name: "原稿本文", exact: true });
  await expect(editor.locator(".cm-line")).toHaveText(original.split("\n"));
  return { id: created.id as string, editor };
}

// Holds only the editor's one-second autosave timer while typing, so the text is
// still unsaved when the app quits: the quit-time save is tested instead of racing autosave.
async function insertUnsaved(id: string, text: string, saved: string) {
  await expect(page.getByTestId("manuscript-save-state")).toHaveText("保存済み");
  await page.evaluate(() => {
    const original = window.setTimeout;
    let held = 0;
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      if (timeout === 1000) { held++; return 0; }
      return original(handler, timeout, ...args);
    }) as typeof window.setTimeout;
    Object.assign(window, { releaseAutosave: () => { window.setTimeout = original; return held; } });
  });
  await page.keyboard.insertText(text);
  await expect(page.getByTestId("manuscript-save-state")).toHaveText("編集中…");
  expect(await page.evaluate(() => (window as unknown as { releaseAutosave: () => number }).releaseAutosave())).toBe(1);
  expect((await api(`conversations/${id}`)).messages[0].content).toBe(saved);
}

async function quitAndCheckServer(processId: number, quit: () => Promise<unknown>) {
  const closed = app.waitForEvent("close", { timeout: 30_000 });
  await quit();
  await closed;
  await expect.poll(() => {
    try { process.kill(processId, 0); return true; } catch { return false; }
  }).toBe(false);
}

async function verifyAfterRestart(id: string, content: string) {
  await launch();
  expect((await api(`conversations/${id}`)).messages[0].content).toBe(content);
  await page.goto(`fussenn://app/?chat=${id}`);
  await expect(page.getByRole("textbox", { name: "原稿本文", exact: true }).locator(".cm-line")).toHaveText(content.split("\n"));
  const processId = (await api("health")).processId;
  await quitAndCheckServer(processId, () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()));
}

test.beforeEach(async () => {
  data = await mkdtemp(join(tmpdir(), "fussenn-mac-desktop-"));
  await isolateDesktopSettings(data);
  await launch();
});

test.afterEach(async () => {
  await app?.close().catch(() => {});
  await rm(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
});

test("uses Mac editing keys with a minimal PATH and saves pending manuscript edits when closing and restarting", async () => {
  const { id, editor } = await manuscript();
  await editor.click();
  await page.keyboard.press("Meta+ArrowUp");
  await page.keyboard.insertText("先頭：");
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.insertText("：末尾");
  const edited = `先頭：${original}：末尾`;
  await expect(editor.locator(".cm-line")).toHaveText(edited.split("\n"));
  await page.keyboard.press("Meta+z");
  await expect(editor.locator(".cm-line")).toHaveText(`先頭：${original}`.split("\n"));
  await page.keyboard.press("Meta+Shift+z");
  await expect(editor.locator(".cm-line")).toHaveText(edited.split("\n"));

  const processId = (await api("health")).processId;
  await page.keyboard.press("Meta+ArrowDown");
  await insertUnsaved(id, "終了直前の追記。", edited);
  // Renderer key injection does not exercise AppKit menu shortcuts. Cmd+Q
  // is checked separately with native keyboard input on the Mac.
  await quitAndCheckServer(processId, () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()));
  await verifyAfterRestart(id, `${edited}終了直前の追記。`);
});

test("saves pending manuscript edits through the Mac application menu's native Quit action", async () => {
  const { id, editor } = await manuscript();
  const processId = (await api("health")).processId;
  await editor.click();
  await page.keyboard.press("Meta+ArrowDown");
  await insertUnsaved(id, "アプリメニューから終了する直前の追記。", original);
  await quitAndCheckServer(processId, () => app.evaluate(({ Menu }) => {
    const appMenu = Menu.getApplicationMenu()?.items.find((item) => item.role?.toLowerCase() === "appmenu");
    const quit = appMenu?.submenu?.items.find((item) => item.role === "quit");
    if (!quit?.enabled || !quit.visible) throw new Error("The Mac application menu Quit item is unavailable");
    // Electron handles the Mac quit role through Cocoa's terminate: action;
    // calling MenuItem.click() does not execute native macOS roles.
    Menu.sendActionToFirstResponder("terminate:");
  }));
  await verifyAfterRestart(id, `${original}アプリメニューから終了する直前の追記。`);
});
