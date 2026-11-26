import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, protocol, session, shell } from "electron";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { APP_URL, isAppUrl, isLoginUrl, isWebUrl, runtimePath, safeDownloadName } from "./policy.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const brand = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
const iconPath = join(here, "icons", "fussenn.png");
const resources = app.isPackaged ? process.resourcesPath : dirname(dirname(here));
const serverDirectory = join(resources, "server");
const runtime = join(resources, "runtime", process.platform === "win32" ? "node.exe" : "node");
// The server runs from its own working directory; an absolute path keeps both processes on the same data.
// Data created before the rename from SideNote AI is used in place until a Fussenn folder exists.
function defaultDataDirectory() {
  const current = join(homedir(), ".fussenn"), previous = join(homedir(), ".sidenote-ai");
  return !existsSync(current) && existsSync(previous) ? previous : current;
}
const dataDirectory = resolve(process.env.FUSSENN_DATA_DIR || process.env.SIDENOTE_DATA_DIR || defaultDataDirectory());
mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
// Separate test/data-directory instances, stable storage across ports and updates.
app.setPath("userData", join(dataDirectory, "desktop"));
app.setName("Fussenn");
app.setAppUserModelId("app.fussenn.desktop");
protocol.registerSchemesAsPrivileged([{ scheme: "fussenn", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

let window;
let child;
let baseUrl;
let quitting = false;
let checkingClose = false;
let downloads = 0;
const token = randomBytes(32).toString("hex");
const logFile = join(dataDirectory, "desktop", "server.log");
// The page keeps its theme in browser storage; the window frame, menus and dialogs follow it through this file.
const appearanceFile = join(dataDirectory, "desktop", "appearance.json");
const THEMES = new Set(["system", "light", "dark"]);
function savedTheme() {
  try { const { theme } = JSON.parse(readFileSync(appearanceFile, "utf8")); return THEMES.has(theme) ? theme : "system"; } catch { return "system"; }
}
// The page's paper color in each theme (--paper in globals.css), shown while the page loads or resizes.
const windowBackground = () => nativeTheme.shouldUseDarkColors ? "#181716" : "#faf9f6";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function log(text) {
  mkdirSync(dirname(logFile), { recursive: true, mode: 0o700 });
  try { if (existsSync(logFile) && statSync(logFile).size > 1_000_000) writeFileSync(logFile, ""); } catch { /* Best effort rotation. */ }
  appendFileSync(logFile, text, { mode: 0o600 });
}
async function health() {
  const response = await fetch(`${baseUrl}/api/health`, { headers: { "x-fussenn-desktop-token": token }, signal: AbortSignal.timeout(2000) });
  if (!response.ok) throw new Error("内部サーバーに接続できません。");
  return response.json();
}
async function freePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}
function serverEnvironment() {
  const configured = {};
  // Never ship .env files. User-owned desktop.env is optional; development can
  // reuse the existing source checkout's server settings.
  const files = [!app.isPackaged && join(here, "..", "..", "..", ".env.local"), join(dataDirectory, "desktop.env")].filter(Boolean);
  const allowed = new Set(["CODEX_BIN", "OPENAI_API_KEY", "OPENAI_COMPAT_API_KEY", "ENABLE_MOCK_PROVIDER"]);
  for (const file of files) {
    if (!existsSync(file)) continue;
    for (const [key, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) if (allowed.has(key)) configured[key] = value;
  }
  const env = { ...process.env, ...configured };
  const path = runtimePath(env, homedir(), dirname(runtime));
  for (const key of Object.keys(env)) if (key.toLowerCase() === "path") delete env[key];
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  return { ...env, PATH: path, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", FUSSENN_DATA_DIR: dataDirectory, FUSSENN_SERVER_RUNNING: "true", FUSSENN_DESKTOP_TOKEN: token, HOSTNAME: "127.0.0.1" };
}
async function startServer() {
  if (!existsSync(runtime) || !existsSync(join(serverDirectory, "server.js"))) throw new Error("アプリのファイルが不足しています。開発環境では npm run desktop:prepare を実行してください。");
  // Pre-desktop releases have no data-directory lock. Detect their default
  // browser server before opening the existing workspace.
  if (!process.env.FUSSENN_DATA_DIR && !process.env.SIDENOTE_DATA_DIR) {
    try {
      const response = await fetch("http://127.0.0.1:3000/api/health", { signal: AbortSignal.timeout(700) });
      const old = await response.json();
      // A browser server from before the rename reports its previous name.
      const stop = { fussenn: "Fussenn Browser - Stop", "sidenote-ai": "SideNote AI - Stop" }[old.app];
      if (stop && old.ready) throw new Error(`ブラウザ版が起動中です。「${stop}」で終了してから、アプリを起動してください。`);
    } catch (error) { if (error.message.startsWith("ブラウザ版")) throw error; }
  }
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  let failed = false;
  let locked = false;
  child = spawn(runtime, [join(resources, "runtime", "server-bootstrap.cjs"), serverDirectory], {
    cwd: serverDirectory, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: { ...serverEnvironment(), PORT: String(port) },
  });
  child.on("error", () => { failed = true; });
  for (const output of [child.stdout, child.stderr]) output.on("data", (bytes) => {
    const text = bytes.toString();
    if (text.includes("同じ保存先を使うFussenn")) locked = true;
    log(text);
  });
  child.on("exit", () => {
    failed = true;
    if (!quitting && window) {
      dialog.showErrorBox("Fussenn", "内部サーバーが停止しました。Fussennを終了して、もう一度起動してください。保存済みのデータは保持されています。");
    }
  });
  const identity = createHash("sha256").update(serverDirectory.toLowerCase()).digest("hex");
  for (let attempt = 0; attempt < 240; attempt++) {
    if (failed) throw new Error(locked ? "同じ保存先を使うFussennが起動中です。別のFussennを終了してから起動してください。" : `内部サーバーを起動できませんでした。ログ: ${logFile}`);
    try { const state = await health(); if (state.app === "fussenn" && state.workspaceId === identity && state.ready) return; } catch { /* Starting. */ }
    await sleep(250);
  }
  throw new Error(`起動がタイムアウトしました。ログ: ${logFile}`);
}
async function stopServer() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const processToStop = child;
  const exited = new Promise((resolve) => processToStop.once("exit", resolve));
  if (processToStop.connected) processToStop.send("shutdown");
  await Promise.race([exited, sleep(9000)]);
  if (processToStop.exitCode === null && processToStop.signalCode === null) {
    // Only the child created by this instance, never an unrelated port owner.
    processToStop.kill();
    await Promise.race([exited, sleep(2000)]);
  }
}
async function openExternal(url) {
  if (!isWebUrl(url)) return;
  if (!isLoginUrl(url)) {
    const result = await dialog.showMessageBox(window, { type: "question", message: "リンクをブラウザで開きますか？", detail: url, buttons: ["開く", "キャンセル"], defaultId: 1, cancelId: 1 });
    if (result.response !== 0) return;
  }
  await shell.openExternal(url);
}
function installProtocol() {
  protocol.handle("fussenn", async (request) => {
    if (!isAppUrl(request.url)) return new Response("Forbidden", { status: 403 });
    const url = new URL(request.url);
    const headers = new Headers(request.headers);
    headers.set("x-fussenn-desktop-token", token);
    headers.set("origin", baseUrl);
    headers.delete("host"); headers.delete("sec-fetch-site");
    // Fetch keeps streaming and cancellation intact for AI and backup uploads.
    try {
      const response = await fetch(`${baseUrl}${url.pathname}${url.search}`, {
        method: request.method, headers, body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
        duplex: "half", signal: request.signal, redirect: "manual",
      });
      const resultHeaders = new Headers(response.headers);
      resultHeaders.delete("content-encoding"); resultHeaders.delete("content-length");
      const location = resultHeaders.get("location");
      if (location) {
        const target = new URL(location, baseUrl);
        if (target.origin !== baseUrl) return new Response("Forbidden", { status: 403 });
        resultHeaders.set("location", `${APP_URL.slice(0, -1)}${target.pathname}${target.search}${target.hash}`);
      }
      resultHeaders.set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-src 'none'; frame-ancestors 'none'");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers: resultHeaders });
    } catch { return new Response("Fussennの内部サーバーに接続できません。", { status: 503 }); }
  });
}
async function saveBeforeClose() {
  const id = randomUUID();
  return new Promise((resolve) => {
    const done = (ok) => { clearTimeout(timer); ipcMain.removeListener("fussenn:saved", listener); resolve(ok); };
    const listener = (event, receivedId, ok) => { if (event.sender === window.webContents && isAppUrl(event.senderFrame?.url) && receivedId === id) done(ok === true); };
    const timer = setTimeout(() => done(false), 10_000);
    ipcMain.on("fussenn:saved", listener);
    window.webContents.send("fussenn:save", id);
  });
}
async function requestQuit() {
  if (checkingClose || quitting) return;
  checkingClose = true;
  try {
    if (child && child.exitCode === null && child.signalCode === null) {
      if (downloads || (await health()).activeGenerations > 0) {
        await dialog.showMessageBox(window, { type: "info", message: "回答の生成やファイルの保存が終わってから終了してください。" }); return;
      }
      if (window && !await saveBeforeClose()) {
        await dialog.showMessageBox(window, { type: "warning", message: "保存を確認できませんでした。", detail: "画面の保存状態を確認してから、もう一度終了してください。" }); return;
      }
    }
    quitting = true;
    await stopServer();
    app.quit();
  } catch { await dialog.showMessageBox(window, { type: "warning", message: "終了処理を完了できませんでした。", detail: "少し待ってから、もう一度終了してください。" }); }
  finally { checkingClose = false; }
}
function createWindow() {
  window = new BrowserWindow({
    icon: process.platform === "win32" ? join(here, "icons", "fussenn.ico") : iconPath,
    title: "Fussenn", width: 1440, height: 960, minWidth: 1024, minHeight: 700, backgroundColor: windowBackground(), show: false,
    webPreferences: { preload: join(here, "preload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, webviewTag: false },
  });
  window.once("ready-to-show", () => window.show());
  window.on("close", (event) => { if (!quitting) { event.preventDefault(); void requestQuit(); } });
  window.webContents.on("will-navigate", (event, url) => { if (!isAppUrl(url)) { event.preventDefault(); void openExternal(url); } });
  window.webContents.on("will-redirect", (event, url) => { if (!isAppUrl(url)) event.preventDefault(); });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => { void openExternal(url); return { action: "deny" }; });
  window.webContents.on("render-process-gone", () => { log("Renderer stopped.\n"); });
  void window.loadURL(APP_URL);
}
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.on("activate", () => { window?.show(); window?.focus(); });
  app.on("before-quit", (event) => { if (!quitting) { event.preventDefault(); void requestQuit(); } });
  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === "clipboard-sanitized-write" && isAppUrl(_contents.getURL())));
    session.defaultSession.setPermissionCheckHandler((contents, permission) => permission === "clipboard-sanitized-write" && isAppUrl(contents?.getURL()));
    session.defaultSession.on("will-download", (_event, item) => {
      downloads++;
      item.setSaveDialogOptions({ title: "Fussennから保存", defaultPath: join(app.getPath("downloads"), safeDownloadName(item.getFilename())) });
      item.once("done", (_event, state) => {
        downloads--;
        if (state === "interrupted") void dialog.showMessageBox(window, { type: "error", message: "ファイルを保存できませんでした。もう一度お試しください。" });
      });
    });
    ipcMain.handle("fussenn:theme", (event, theme) => {
      if (event.sender !== window?.webContents || !isAppUrl(event.senderFrame?.url) || !THEMES.has(theme)) throw new Error("配色を確認してください。");
      if (nativeTheme.themeSource !== theme) nativeTheme.themeSource = theme;
      window.setBackgroundColor(windowBackground());
      if (savedTheme() !== theme) { try { writeFileSync(appearanceFile, JSON.stringify({ theme }), { mode: 0o600 }); } catch { /* Applies until the app closes. */ } }
    });
    ipcMain.handle("fussenn:login", async (event, url) => {
      if (event.sender !== window?.webContents || !isAppUrl(event.senderFrame?.url) || typeof url !== "string" || !isLoginUrl(url)) throw new Error("認証ページのURLを確認してください。");
      await shell.openExternal(url);
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu", label: "Fussenn" }] : []),
      { label: "ファイル", submenu: [{ label: "終了", accelerator: "CmdOrCtrl+Q", click: () => void requestQuit() }] },
      { role: "editMenu", label: "編集" },
      { label: "表示", submenu: [{ role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }] },
      { role: "windowMenu", label: "ウィンドウ" },
      { label: "ヘルプ", submenu: [
        { label: "Fussennについて", click: () => app.showAboutPanel() },
        { label: "ライセンスを開く", click: async () => {
          const error = await shell.openPath(join(resources, "licenses", "index.html"));
          if (error) dialog.showErrorBox("ライセンスを開けませんでした", error);
        } },
      ] },
    ]));
    app.setAboutPanelOptions({ applicationName: brand.productName, applicationVersion: app.getVersion(), copyright: `Copyright © 2026 ${brand.author}`, iconPath, credits: "ライセンス・著作権表示は「ヘルプ → ライセンスを開く」で確認できます。" });
    if (process.platform === "darwin" && !app.isPackaged) app.dock?.setIcon(iconPath);
    nativeTheme.themeSource = savedTheme();
    // "Follow the system" also follows a change of the system theme while the app runs.
    nativeTheme.on("updated", () => { if (window && !window.isDestroyed()) window.setBackgroundColor(windowBackground()); });
    try { await startServer(); installProtocol(); createWindow(); }
    catch (error) { dialog.showErrorBox("Fussennを起動できません", error.message); quitting = true; await stopServer(); app.quit(); }
  });
}
