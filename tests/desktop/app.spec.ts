import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { isolateDesktopSettings, testDataEnvironment } from "../fixtures/desktop";
import { docsImage } from "../fixtures/docs-image";
import { makePdf } from "../fixtures/pdf";

let app: ElectronApplication;
let page: Page;
let data: string;
let launchedAt = 0;
const source = "# アプリで読む資料\n\n疲労限度と安全率について考えます。\n\n専用ウィンドウでも本文と付箋のつながりを保ちます。";
async function launch() {
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), ...testDataEnvironment(data), ENABLE_MOCK_PROVIDER: "true" };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ ...(process.env.FUSSENN_DESKTOP_EXE ? { executablePath: process.env.FUSSENN_DESKTOP_EXE, args: [] } : { args: [resolve(".desktop/app")] }), env, timeout: 60_000 });
  page = await app.firstWindow();
  await page.waitForURL("fussenn://app/");
  await expect(page.getByRole("button", { name: /^資料を開く/ })).toBeVisible();
}
async function api(path: string, method = "GET", body?: unknown) {
  return page.evaluate(async ({ path, method, body }) => {
    const bootstrap = await fetch("/api/workspace");
    const revision = bootstrap.headers.get("x-fussenn-revision")!;
    const response = await fetch(`/api/${path}`, { method, headers: { "content-type": "application/json", "x-fussenn-revision": revision }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }, { path, method, body });
}
async function closeNormally() {
  const processId = (await api("health")).body.processId;
  const closed = app.waitForEvent("close");
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed;
  await expect.poll(() => { try { process.kill(processId, 0); return true; } catch { return false; } }).toBe(false);
}

test.beforeEach(async () => { data = await mkdtemp(join(tmpdir(), "fussenn-desktop-")); await isolateDesktopSettings(data); launchedAt = Date.now(); await launch(); });
test.afterEach(async () => {
  await app?.close().catch(() => {});
  // Electron/Node descendants can take a moment to release Windows file handles.
  await rm(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
});

test("opens the bundled licenses from Help without using the network", async () => {
  const result = await app.evaluate(async ({ Menu, shell, app }) => {
    const help = Menu.getApplicationMenu()?.items.find((item) => item.label === "ヘルプ");
    const item = help?.submenu?.items.find((item) => item.label === "ライセンスを開く");
    const about = help?.submenu?.items.find((item) => item.label === "Fussennについて");
    if (!item || !about) throw new Error("License and About menu items are missing");
    let opened = "";
    const original = shell.openPath;
    shell.openPath = async (path: string) => { opened = path; return ""; };
    try { await item.click(undefined, undefined, undefined); }
    finally { shell.openPath = original; }
    return { opened, version: app.getVersion() };
  });
  expect(result.version).toBeTruthy();
  expect(result.opened.replaceAll("\\", "/")).toMatch(/\/licenses\/index\.html$/);
  const html = await readFile(result.opened, "utf8");
  expect(html).toContain("Fussenn — ライセンス");
  expect(html).toContain("@codemirror/view@");
  expect(html).toContain("LICENSE_FOXIT");
  expect(html).toContain("runtimes/LICENSES.chromium.html");
});

test("imports, annotates, streams AI, exports, saves on close and resumes in the desktop window", async () => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  expect(await page.evaluate(() => ({ require: typeof (window as unknown as { require?: unknown }).require, bridge: !!window.fussennDesktop }))).toEqual({ require: "undefined", bridge: true });
  await page.getByRole("button", { name: /^資料を開く/ }).click();
  const panel = page.getByRole("dialog", { name: "資料を開く", exact: true });
  await panel.getByLabel("取り込む資料ファイル").setInputFiles({ name: "MacとWindows.md", mimeType: "text/plain", buffer: Buffer.from(source) });
  await panel.getByRole("button", { name: "資料を取り込む", exact: true }).click();
  await expect(page.getByTestId("document-body")).toContainText("疲労限度");
  await page.getByTestId("document-body").evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text; const offset = node.data.indexOf("疲労限度");
      if (offset < 0) continue;
      const range = document.createRange(); range.setStart(node, offset); range.setEnd(node, offset + 4);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      root.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })); return;
    }
    throw new Error("No selection");
  });
  await page.getByRole("button", { name: "付箋", exact: true }).click();
  const note = page.getByTestId("floating-note");
  await note.getByLabel("付箋のメモ", { exact: true }).fill("デスクトップでも学びを残す");
  await note.getByRole("button", { name: "AIに聞く", exact: true }).click();
  await expect(note.getByTestId("note-message-assistant")).toContainText("疲労限度");
  await expect.poll(async () => (await api("health")).body.activeGenerations).toBe(0);
  await note.getByRole("button", { name: "メモへ", exact: true }).click();
  const conversation = (await api("conversations")).body[0];
  expect((await api(`conversations/${conversation.id}`)).body.notes).toHaveLength(1);
  const backup = await page.evaluate(async () => { const response = await fetch("/api/backups/export"); return { ok: response.ok, body: await response.json() }; });
  expect(backup.ok).toBe(true);
  expect(JSON.stringify(backup.body)).toContain("MacとWindows.md");
  // Native save dialog is replaced only in the test; actual DownloadItem writes.
  const exportPath = join(data, "linked-markdown.zip");
  await app.evaluate(({ session }, path) => {
    const state = globalThis as unknown as { fussennTestDownloadState: string };
    state.fussennTestDownloadState = "waiting";
    session.defaultSession.once("will-download", (_event, item) => {
      item.setSavePath(path);
      item.once("done", (_event, result) => { state.fussennTestDownloadState = result; });
    });
  }, exportPath);
  await page.getByRole("button", { name: "Obsidian用Markdownを書き出す", exact: true }).click();
  // A file can already have bytes while Electron is still finalizing the
  // download. Wait for its completion before asking the application to quit.
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { fussennTestDownloadState: string }).fussennTestDownloadState)).toBe("completed");
  await expect.poll(async () => (await readFile(exportPath).catch(() => Buffer.alloc(0))).length).toBeGreaterThan(100);
  await page.evaluate(() => localStorage.setItem("desktop-test", "kept"));
  await note.getByLabel("付箋のメモ", { exact: true }).fill("閉じる直前の編集も保存する");
  await closeNormally();
  await launch();
  expect(await page.evaluate(() => localStorage.getItem("desktop-test"))).toBe("kept");
  expect((await api(`conversations/${conversation.id}`)).body.notes[0].memo).toBe("閉じる直前の編集も保存する");
  await page.locator(".conversation-link").filter({ hasText: "MacとWindows" }).click();
  await expect(page.getByTestId("floating-note").getByLabel("付箋のメモ", { exact: true })).toHaveValue("閉じる直前の編集も保存する");
  expect(errors).toEqual([]);
  await page.screenshot({ path: docsImage("desktop-app.png") });
  await closeNormally();
});

test("refuses to close during generation and reuses a running instance", async () => {
  await app.evaluate(({ dialog }) => {
    (globalThis as unknown as { notices: string[] }).notices = [];
    dialog.showMessageBox = async (...args: unknown[]) => {
      const options = args.at(-1) as { message: string };
      (globalThis as unknown as { notices: string[] }).notices.push(options.message);
      return { response: 0, checkboxChecked: false };
    };
  });
  const conversation = (await api("conversations", "POST", { providerKind: "mock", model: "mock-demo" })).body;
  await page.evaluate(async (id) => {
    const revision = (await fetch("/api/workspace")).headers.get("x-fussenn-revision")!;
    void fetch("/api/chat/main", { method: "POST", headers: { "content-type": "application/json", "x-fussenn-revision": revision }, body: JSON.stringify({ ownerId: id, text: "終了の確認 ".repeat(500) }) }).then((response) => response.text());
  }, conversation.id);
  await expect.poll(async () => (await api("health")).body.activeGenerations).toBe(1);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { notices: string[] }).notices.length)).toBe(1);
  expect(app.windows()).toHaveLength(1);
  const duplicateEnv: NodeJS.ProcessEnv = { ...process.env, ...testDataEnvironment(data) };
  delete duplicateEnv.ELECTRON_RUN_AS_NODE;
  // Playwright's process() is cmd.exe on Windows, not the Electron executable.
  const duplicate = spawn(await app.evaluate(() => process.execPath), process.env.FUSSENN_DESKTOP_EXE ? [] : [resolve(".desktop/app")], {
    windowsHide: true, stdio: "ignore", env: duplicateEnv,
  });
  await new Promise<void>((resolve, reject) => { duplicate.once("error", reject); duplicate.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Duplicate exited with ${code}`))); });
  expect(app.windows()).toHaveLength(1);
  await expect.poll(async () => (await api("health")).body.activeGenerations, { timeout: 20_000 }).toBe(0);
  expect((await api(`conversations/${conversation.id}`)).body.messages.at(-1).status).toBe("complete");
  await closeNormally();
});

test("keeps one window, blocks unsafe navigation and opens OAuth only in the external browser", async () => {
  await app.evaluate(({ shell, dialog }) => {
    (globalThis as unknown as { opened: string[] }).opened = [];
    shell.openExternal = async (url) => { (globalThis as unknown as { opened: string[] }).opened.push(url); };
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
  });
  await page.evaluate(async () => { await window.fussennDesktop!.openLogin("https://auth.openai.com/oauth/authorize?state=fixture"); });
  expect(await app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened)).toHaveLength(1);
  expect(await page.evaluate(async () => { try { await window.fussennDesktop!.openLogin("file:///tmp/untrusted"); return false; } catch { return true; } })).toBe(true);
  await page.evaluate(() => window.open("file:///tmp/untrusted"));
  await page.evaluate(() => window.open("https://example.com"));
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened.length)).toBe(2);
  expect(app.windows()).toHaveLength(1);
  expect(page.url()).toBe("fussenn://app/");
  await closeNormally();
});

test("keeps unsaved notes open after a save failure and retries before exit", async () => {
  const document = (await api("documents", "POST", { fileName: "保存エラー.txt", content: "調査の結果を残します。" })).body;
  const note = (await api("notes", "POST", {
    conversationId: document.id, parentMessageId: document.document.messageId,
    selectedText: "調査", anchorStart: 0, anchorEnd: 2, anchorPrefix: "", anchorSuffix: "の結果を残します。", anchorVersion: 1, x: 750, y: 120,
  })).body;
  await page.reload();
  await page.locator(".conversation-link").filter({ hasText: "保存エラー" }).click();
  await page.evaluate((id) => {
    const original = window.fetch;
    (window as unknown as { failSaves: boolean }).failSaves = true;
    window.fetch = (input, options) => {
      if ((window as unknown as { failSaves: boolean }).failSaves && String(input).endsWith(`/notes/${id}`) && options?.method === "PATCH") return Promise.resolve(new Response('{"error":"Test save failure"}', { status: 500 }));
      return original(input, options);
    };
  }, note.id);
  await app.evaluate(({ dialog }) => {
    (globalThis as unknown as { notices: string[] }).notices = [];
    dialog.showMessageBox = async (...args: unknown[]) => {
      (globalThis as unknown as { notices: string[] }).notices.push((args.at(-1) as { message: string }).message);
      return { response: 0, checkboxChecked: false };
    };
  });
  await page.getByLabel("付箋のメモ", { exact: true }).fill("保存の再試行で守るメモ");
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { notices: string[] }).notices)).toContain("保存を確認できませんでした。");
  await expect(page.getByLabel("付箋のメモ", { exact: true })).toHaveValue("保存の再試行で守るメモ");
  await page.evaluate(() => { (window as unknown as { failSaves: boolean }).failSaves = false; });
  await closeNormally();
  await launch();
  expect((await api(`conversations/${document.id}`)).body.notes[0].memo).toBe("保存の再試行で守るメモ");
  await closeNormally();
});

test("imports a manuscript, revises it, and keeps its history after deleting the source file and restarting", async () => {
  await api("settings", "PATCH", { defaultProvider: "mock" });
  const sourcePath = join(data, "アプリで書く第一章.md"), sourceContent = "本の書き出し。\r\n\r\n章の続き。";
  await writeFile(sourcePath, sourceContent);
  await page.getByRole("button", { name: "原稿を書く", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "新しい原稿", exact: true });
  await panel.getByRole("button", { name: "ファイルから取り込む", exact: true }).click();
  await panel.getByLabel("取り込む原稿ファイル").setInputFiles(sourcePath);
  await panel.getByRole("button", { name: "原稿として取り込む", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "原稿本文", exact: true });
  await expect(editor).toContainText("本の書き出し。");
  const manuscript = (await api("conversations")).body[0];
  await editor.click();
  await page.keyboard.press("ControlOrMeta+Home"); await page.keyboard.press("Shift+End");
  await page.getByRole("button", { name: "選択箇所・カーソルに付箋" }).click();
  await page.getByRole("button", { name: "付箋", exact: true }).click();
  const sticky = page.getByTestId("floating-note");
  await sticky.getByRole("button", { name: "原稿案", exact: true }).click();
  await sticky.getByLabel("本文に反映する原稿案").fill("保存してから反映する案。");
  await sticky.getByRole("button", { name: "本文へ反映…" }).click();
  await page.getByRole("dialog", { name: "本文への反映を確認" }).getByRole("button", { name: "本文に反映する" }).click();
  await expect(editor).toContainText("保存してから反映する案。");
  await sticky.getByRole("button", { name: "続けて推敲する", exact: true }).click();
  await sticky.getByRole("button", { name: "原稿案", exact: true }).click();
  await expect(sticky.getByLabel("本文に反映する原稿案")).toHaveValue("保存してから反映する案。");
  await sticky.getByLabel("本文に反映する原稿案").fill("さらに推敲した書き出し。");
  await sticky.getByRole("button", { name: "本文へ反映…" }).click();
  await page.getByRole("dialog", { name: "本文への反映を確認" }).getByRole("button", { name: "本文に反映する" }).click();
  await expect(editor).toContainText("さらに推敲した書き出し。");
  expect(await readFile(sourcePath, "utf8")).toBe(sourceContent);
  await rm(sourcePath);
  await editor.click(); await page.keyboard.press("ControlOrMeta+End"); await page.keyboard.insertText("終了直前の日本語。");
  await closeNormally();
  await launch();
  const restored = (await api(`conversations/${manuscript.id}`)).body;
  expect(restored.messages[0].content).toContain("終了直前の日本語。");
  expect(restored.notes[0].manuscript.draft).toBe("さらに推敲した書き出し。");
  expect(restored.notes[0].manuscript.contextHistory).toHaveLength(1);
  expect((await api(`manuscripts/${manuscript.id}/history`)).body.length).toBeGreaterThanOrEqual(4);
  const backup = await api("backups/export");
  expect(backup.status).toBe(200);
  expect(backup.body.data.manuscript_notes).toHaveLength(1);
  await closeNormally();
});

test("previews Markdown, keeps pending edits when switching views, and remembers the view after restart", async () => {
  const text = "# 原稿のプレビュー\n\n**大切な文章**を読み直す[^注釈]。\n\n## 次の見出し\n\n次の段落。\n\n[^注釈]: 脚注の説明。";
  const result = await api("manuscripts", "POST", { title: "プレビューを使う原稿", file: { fileName: "原稿.md", content: text } });
  expect(result.status).toBe(201);
  await page.goto(`fussenn://app/?chat=${result.body.id}`);
  const modes = page.getByRole("group", { name: "原稿の表示方法" });
  const editor = page.getByRole("textbox", { name: "原稿本文", exact: true });
  await modes.getByRole("button", { name: "並べて表示", exact: true }).click();
  await expect(page.getByTestId("manuscript-reading").locator("strong")).toHaveText("大切な文章");
  await page.getByTestId("manuscript-reading").locator("a[data-footnote-ref]").click();
  await page.getByTestId("manuscript-reading").locator("a[data-footnote-backref]").click();
  await expect(page).toHaveURL(`fussenn://app/?chat=${result.body.id}`);
  await editor.click(); await page.keyboard.press("ControlOrMeta+End"); await page.keyboard.insertText("\n\n**終了直前の追記**");
  await modes.getByRole("button", { name: "プレビュー", exact: true }).click();
  await expect(page.getByTestId("manuscript-reading").locator("strong").last()).toHaveText("終了直前の追記");
  await closeNormally(); await launch();
  await page.goto(`fussenn://app/?chat=${result.body.id}`);
  await expect(page.getByRole("group", { name: "原稿の表示方法" }).getByRole("button", { name: "プレビュー", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("manuscript-reading")).toContainText("終了直前の追記");
  expect((await api(`conversations/${result.body.id}`)).body.messages[0].content).toBe(text + "\n\n**終了直前の追記**");
  await closeNormally();
});

test("extracts Japanese PDF text using bundled resources and retains pages after restart", async () => {
  await page.getByRole("button", { name: /^資料を開く/ }).click();
  const panel = page.getByRole("dialog", { name: "資料を開く", exact: true });
  await panel.getByLabel("取り込む資料ファイル").setInputFiles({ name: "日本語資料.pdf", mimeType: "application/pdf", buffer: makePdf(["日本語の設計資料。", "疲労限度について考える。"], { cjkMap: true }) });
  await expect(panel.locator(".document-import-preview")).toContainText("疲労限度について考える。");
  await panel.getByRole("button", { name: "資料を取り込む", exact: true }).click();
  await expect(page.getByTestId("document-body")).toContainText("【PDF 2 / 2 ページ】");
  const doc = (await api("conversations")).body[0];
  await closeNormally(); await launch();
  await page.goto(`fussenn://app/?chat=${doc.id}`);
  await expect(page.getByTestId("document-body")).toContainText("疲労限度について考える。");
  const backup = await api("backups/export");
  expect(backup.body.version).toBe(3); expect(backup.body.data.document_sources[0].format).toBe("pdf");
  await closeNormally();
});

test("leaves the installed app files unchanged while it runs", async () => {
  // A signed Mac app must not change after installation, and on Windows deep cache paths next to
  // the app made the next update fail once they passed the 260-character limit.
  await page.goto("fussenn://app/settings");
  await expect(page.getByRole("region", { name: "バックアップと復元" })).toBeVisible();
  await page.goto("fussenn://app/");
  await expect(page.getByRole("button", { name: /^資料を開く/ })).toBeVisible();
  const resources = (await app.evaluate(({ app }) => app.isPackaged ? process.resourcesPath : "")) || resolve(".desktop");
  await closeNormally();
  const changed: string[] = [];
  for (const entry of await readdir(join(resources, "server"), { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    if (entry.isFile() && (await stat(path)).mtimeMs >= launchedAt) changed.push(path);
  }
  expect(changed).toEqual([]);
});

test("stops its private server when the desktop process crashes and can restart", async () => {
  const processId = (await api("health")).body.processId;
  const document = (await api("documents", "POST", { fileName: "復旧.txt", content: "異常終了前の保存済みデータ" })).body;
  // Kill the actual Electron main process, not Playwright's Windows cmd wrapper.
  const mainPid = await app.evaluate(() => process.pid);
  process.kill(mainPid, "SIGKILL");
  await expect.poll(() => { try { process.kill(processId, 0); return true; } catch { return false; } }, { timeout: 15_000 }).toBe(false);
  await launch();
  expect((await api(`conversations/${document.id}`)).body.document.fileName).toBe("復旧.txt");
  await closeNormally();
});
