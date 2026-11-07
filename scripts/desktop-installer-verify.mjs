import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { _electron as electron, expect } from "@playwright/test";
import { build, Platform, Arch } from "electron-builder";
import { getPath7za } from "app-builder-lib/out/toolsets/7zip.js";
import { verifyDesktopLicenses } from "./desktop-licenses.mjs";
import { verifyWindowsBranding } from "./desktop-branding.mjs";
import { windowsInstallerOptions } from "./desktop-installer-options.mjs";

const { values } = parseArgs({ options: { previous: { type: "string" }, current: { type: "string" }, help: { type: "boolean" } } });
if (values.help) {
  console.log("Windows only: npm run test:desktop:installer -- --previous <old.exe> --current <new.exe>\nRebuilds isolated test installers from their app payloads. Never installs the original EXEs.\nUses temporary synthetic data, a unique app ID, EXE name, registry GUID and shortcuts.\nThe test labels 0.0.1 / 0.0.2 are not historical Fussenn versions. Results: test-results/installer/");
  process.exit(0);
}
if (process.platform !== "win32" || process.arch !== "x64") throw new Error("This lifecycle check currently requires Windows x64.");
if (!values.previous || !values.current) throw new Error("Specify --previous and --current installer paths. Use --help for details.");
const inputs = [realpathSync.native(resolve(values.previous)), realpathSync.native(resolve(values.current))];
if (inputs[0] === inputs[1]) throw new Error("Use two distinct installer builds to verify replacement of the app payload.");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const icons = join(root, "desktop", "icons");
verifyWindowsBranding(inputs[1], join(icons, "fussenn.ico"), pkg, "installer");
const parent = realpathSync.native(tmpdir());
const scratch = realpathSync.native(mkdtempSync(join(parent, "fussenn-installer-test-")));
const id = randomUUID().replaceAll("-", "").slice(0, 12);
const productName = `Fussenn-Test-${id}`;
const packageName = `fussenn-installer-test-${id}`;
const guid = randomUUID();
const installed = join(scratch, "日本語の保存先", "Fussenn Test App");
const data = join(scratch, "検証データ");
const executable = join(installed, `${productName}.exe`);
const results = join(root, "test-results", "installer", id);
mkdirSync(results, { recursive: true });
// A build from before the rename reads the SIDENOTE_ names. Set both, so an older
// installer given by mistake still uses the synthetic data and never everyday data.
const env = { ...process.env, FUSSENN_DATA_DIR: data, SIDENOTE_DATA_DIR: data, ENABLE_MOCK_PROVIDER: "true", FUSSENN_DISABLE_AUTOMATIC_BACKUP: "true", SIDENOTE_DISABLE_AUTOMATIC_BACKUP: "true", CODEX_BIN: join(scratch, "unavailable-codex.exe") };
for (const key of ["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS", "NODE_PATH", "NODE_USE_ENV_PROXY", "OPENAI_API_KEY", "OPENAI_COMPAT_API_KEY"]) delete env[key];
const report = { scope: "isolated NSIS wrappers; original application payloads; synthetic installer versions", id, scratch, guid, productName, inputs: inputs.map((file) => ({ file, sha256: hash(file) })), steps: [], status: "running" };
let app;
let page;
let initial;
let cache;
let baseline;

function hash(file) { return createHash("sha256").update(readFileSync(file)).digest("hex"); }
function checkpoint(name) {
  report.steps.push({ name, status: "passed" });
  writeFileSync(join(results, "result.json"), JSON.stringify(report, null, 2));
  console.log(`PASS: ${name}`);
}
function inside(path, directory) {
  const part = relative(realpathSync.native(directory), realpathSync.native(path));
  assert(part && !isAbsolute(part) && part !== ".." && !part.startsWith(`..\\`), "Unsafe test path");
}
function inspect() {
  return JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(root, "scripts", "windows", "Inspect-InstallerTest.ps1"), "-ProductName", productName, "-TestGuid", guid], { encoding: "utf8", windowsHide: true, timeout: 30_000 }));
}
function productionUnchanged(state) { assert.deepEqual(state.production, initial.production, "Everyday Fussenn installation or shortcuts changed"); }
function assertAbsent(state) {
  for (const field of ["currentUser", "installInfo", "allUsers", "allUsers32", "desktopShortcut", "startMenuShortcut"]) assert.equal(state[field], null, `Unexpected test registration: ${field}`);
}
async function runInstaller(file, args) {
  inside(file, scratch);
  console.log(`Running ${basename(file)} ${args.join(" ")}`);
  await new Promise((resolveRun, reject) => {
    // NSIS /D= and _?= consume the final unquoted remainder, including spaces.
    const child = spawn(file, args, { env, cwd: scratch, windowsHide: true, windowsVerbatimArguments: true, stdio: "ignore" });
    const timeout = setTimeout(() => { child.kill(); reject(new Error("Installer timed out; test files retained for inspection")); }, 300_000);
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", (code) => { clearTimeout(timeout); if (code === 0) resolveRun(); else reject(new Error(`Installer exited with ${code}`)); });
  });
}
async function extract(file, index) {
  const archive = readFileSync(file), signature = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);
  const tool = await getPath7za();
  for (let offset = archive.indexOf(signature); offset >= 0; offset = archive.indexOf(signature, offset + 1)) {
    if (offset + 32 > archive.length) continue;
    const size = 32n + archive.readBigUInt64LE(offset + 12) + archive.readBigUInt64LE(offset + 20);
    if (size <= 32n || size > BigInt(archive.length - offset)) continue;
    const payload = join(scratch, `payload-${index}.7z`);
    writeFileSync(payload, archive.subarray(offset, offset + Number(size)));
    let listing;
    try { listing = execFileSync(tool, ["l", "-slt", payload], { encoding: "utf8", windowsHide: true }); }
    catch { continue; }
    const entries = listing.split("----------").slice(1).join("----------").split(/\r?\n/).filter((line) => line.startsWith("Path = ")).map((line) => line.slice(7));
    if (!entries.includes("resources\\app.asar") && !entries.includes("resources/app.asar")) continue;
    for (const entry of entries) assert(!isAbsolute(entry) && !entry.includes(":") && !entry.split(/[\\/]/).includes(".."), "Unsafe archive entry");
    const output = join(scratch, `payload-${index}`);
    mkdirSync(output);
    execFileSync(tool, ["x", "-y", `-o${output}`, payload], { stdio: "pipe", windowsHide: true });
    verifyDesktopLicenses(join(output, "resources"));
    // An installer from before the rename contains "SideNote AI.exe".
    const executable = ["Fussenn.exe", "SideNote AI.exe"].map((name) => join(output, name)).find((path) => existsSync(path));
    if (!executable) throw new Error(`No application executable in payload: ${basename(file)}`);
    if (index === 1) verifyWindowsBranding(executable, join(icons, "fussenn.ico"), pkg);
    const asarHash = hash(join(output, "resources", "app.asar"));
    // A dependency or runtime update leaves app.asar unchanged, so the bundled Node.js and the
    // server build (its BUILD_ID changes on every build) also identify the payload.
    const runtimeHash = hash(join(output, "resources", "runtime", "node.exe")), buildIdHash = hash(join(output, "resources", "server", ".next-desktop", "BUILD_ID"));
    // Preserve all application bytes. Only the filename changes so NSIS cannot
    // detect/terminate the user's Fussenn process when checking running apps.
    renameSync(executable, join(output, `${productName}.exe`));
    const executableHash = hash(join(output, `${productName}.exe`));
    return { directory: output, asarHash, runtimeHash, buildIdHash, executableHash, fingerprint: [asarHash, runtimeHash, buildIdHash, executableHash].join(":") };
  }
  throw new Error(`No application payload found: ${basename(file)}`);
}
async function wrap(payload, version) {
  const project = join(scratch, `project-${version}`), output = join(scratch, `build-${version}`);
  mkdirSync(project);
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: packageName, version, productName, author: pkg.author, description: "Temporary Fussenn installer lifecycle check", main: "unused.cjs" }));
  writeFileSync(join(project, "unused.cjs"), "");
  await build({ projectDir: project, prepackaged: payload.directory, targets: Platform.WINDOWS.createTarget(["nsis"], Arch.x64), publish: "never", config: {
    appId: `app.fussenn.installer-test.${id}`, productName, electronVersion: JSON.parse(readFileSync(join(payload.directory, "resources", "build-info.json"), "utf8")).electron, directories: { output },
    artifactName: `installer-${version}.exe`, win: { signExecutable: false, icon: join(icons, "fussenn.ico") },
    nsis: { ...windowsInstallerOptions(icons), guid, shortcutName: productName },
  } });
  return join(output, `installer-${version}.exe`);
}
function checkInstalled(version, payload) {
  const state = inspect();
  productionUnchanged(state);
  assert.equal(state.currentUser?.DisplayName, `${productName} ${version}`);
  assert.equal(state.currentUser.DisplayVersion, version);
  assert.equal(resolve(state.installInfo.InstallLocation).toLowerCase(), installed.toLowerCase());
  assert.equal(state.allUsers, null); assert.equal(state.allUsers32, null);
  for (const shortcut of [state.desktopShortcut, state.startMenuShortcut]) {
    assert(shortcut, "Shortcut missing");
    assert.equal(resolve(shortcut.target).toLowerCase(), executable.toLowerCase());
    assert.equal(shortcut.arguments, "");
    assert(shortcut.icon.toLowerCase().startsWith(executable.toLowerCase()), "Shortcut icon does not reference the installed EXE");
  }
  assert.equal(hash(executable), payload.executableHash);
  assert.equal(hash(join(installed, "resources", "app.asar")), payload.asarHash);
  assert.equal(hash(join(installed, "resources", "runtime", "node.exe")), payload.runtimeHash);
  assert.equal(hash(join(installed, "resources", "server", ".next-desktop", "BUILD_ID")), payload.buildIdHash);
  verifyDesktopLicenses(join(installed, "resources"));
  return state;
}
async function launch() {
  inside(executable, scratch);
  app = await electron.launch({ executablePath: executable, args: [], env, cwd: scratch, timeout: 60_000 });
  page = await app.firstWindow();
  await page.waitForURL("fussenn://app/");
  await expect(page.getByRole("button", { name: /^資料を開く/ })).toBeVisible({ timeout: 30_000 });
  assert.equal(await app.evaluate(({ app }) => app.getPath("userData")), join(data, "desktop"));
}
async function api(path, method = "GET", body) {
  return page.evaluate(async ({ path, method, body }) => {
    const revision = (await fetch("/api/workspace")).headers.get("x-fussenn-revision");
    const response = await fetch(`/api/${path}`, { method, headers: { "content-type": "application/json", "x-fussenn-revision": revision }, body: body === undefined ? undefined : JSON.stringify(body) });
    const value = response.headers.get("content-type")?.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(value)}`);
    return value;
  }, { path, method, body });
}
async function closeNormally() {
  const pid = (await api("health")).processId;
  const closed = app.waitForEvent("close", { timeout: 30_000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed;
  app = undefined;
  await expect.poll(() => { try { process.kill(pid, 0); return true; } catch { return false; } }).toBe(false);
}
async function seed() {
  await api("settings", "PATCH", { defaultProvider: "mock", openaiModel: "installer-test-model" });
  const folder = await api("folders", "POST", { name: "更新後も残す本の資料" });
  const chat = await api("conversations", "POST", { providerKind: "mock", model: "mock-demo" });
  await api("chat/main", "POST", { ownerId: chat.id, text: "テスト用の会話を保存します。" });
  await api(`conversations/${chat.id}`, "PATCH", { title: "更新テストの会話", folderId: folder.id });
  const document = await api("documents", "POST", { fileName: "検証資料.md", content: "# 検証資料\n\n保存した本文と付箋のつながり。" });
  await api(`conversations/${document.id}`, "PATCH", { folderId: folder.id });
  const note = await api("notes", "POST", { conversationId: document.id, parentMessageId: document.document.messageId, selectedText: "検証資料", anchorStart: 0, anchorEnd: 4, anchorPrefix: "", anchorSuffix: "保存した本文", anchorVersion: 1, x: 700, y: 150 });
  await api(`notes/${note.id}`, "PATCH", { memo: "更新後も付箋の内容と色を保つ", color: "blue" });
  const manuscript = await api("manuscripts", "POST", { title: "引き継ぐ第一章", file: { fileName: "第一章.md", content: "初稿の書き出し。\n\n章の続き。" } });
  const draftNote = await api(`manuscripts/${manuscript.id}/notes`, "POST", { expected: 1, from: 0, to: 8, x: 700, y: 200 });
  const drafted = await api(`manuscripts/notes/${draftNote.id}/draft`, "POST", { draft: "推敲した書き出し。", expected: draftNote.manuscript.draftRevision });
  await api(`manuscripts/notes/${draftNote.id}/apply`, "POST", { expected: 1, expectedDraft: drafted.manuscript.draftRevision, mode: "replace" });
  const history = await api(`manuscripts/${manuscript.id}/history`);
  assert(history.length >= 2, "Revision history was not created");
  await page.evaluate(() => localStorage.setItem("installer-lifecycle-check", "保持する表示設定"));
  await page.goto(`fussenn://app/?chat=${manuscript.id}`);
  await expect(page.getByRole("textbox", { name: "原稿本文", exact: true })).toContainText("推敲した書き出し。");
  await page.screenshot({ path: join(results, "before-update.png") });
  return { data: (await api("backups/export")).data, manuscriptId: manuscript.id, history };
}
async function verifyData(label) {
  assert.deepEqual((await api("backups/export")).data, baseline.data, `${label}: saved content changed`);
  assert.deepEqual(await api(`manuscripts/${baseline.manuscriptId}/history`), baseline.history);
  assert.equal(await page.evaluate(() => localStorage.getItem("installer-lifecycle-check")), "保持する表示設定");
  await page.goto(`fussenn://app/?chat=${baseline.manuscriptId}`);
  await expect(page.getByRole("textbox", { name: "原稿本文", exact: true })).toContainText("推敲した書き出し。");
  await page.screenshot({ path: join(results, `${label}.png`) });
}
async function uninstall() {
  const file = join(installed, `Uninstall ${productName}.exe`);
  inside(installed, scratch);
  await runInstaller(file, ["/S", "/currentuser", `_?=${installed}`]);
  assert(!existsSync(executable), "Application was not removed");
  const state = inspect(); assertAbsent(state); productionUnchanged(state);
}

try {
  initial = inspect(); assertAbsent(initial);
  cache = join(initial.localAppData, `${packageName}-updater`);
  assert(!existsSync(cache), "Test installer cache already exists");
  const previous = await extract(inputs[0], 0), current = await extract(inputs[1], 1);
  assert.notEqual(previous.fingerprint, current.fingerprint, "The two application payloads are identical");
  const oldInstaller = await wrap(previous, "0.0.1"), newInstaller = await wrap(current, "0.0.2");
  checkpoint("built two isolated installers from distinct original app payloads");

  await runInstaller(oldInstaller, ["/S", "/currentuser", `/D=${installed}`]);
  checkInstalled("0.0.1", previous);
  await launch(); baseline = await seed(); await closeNormally();
  let dbHash = hash(join(data, "fussenn.db"));
  checkpoint("fresh install: current-user registry, both shortcuts, startup and synthetic data");

  // No /D= on update: the installer must recover the existing custom location.
  await runInstaller(newInstaller, ["/S", "/currentuser"]);
  assert.equal(hash(join(data, "fussenn.db")), dbHash);
  checkInstalled("0.0.2", current);
  verifyWindowsBranding(executable, join(icons, "fussenn.ico"), pkg);
  await launch(); await verifyData("after-update"); await closeNormally();
  checkpoint("update: replaced app bytes, kept custom location and all saved data/history/settings");

  dbHash = hash(join(data, "fussenn.db"));
  await runInstaller(newInstaller, ["/S", "/currentuser"]);
  assert.equal(hash(join(data, "fussenn.db")), dbHash);
  checkInstalled("0.0.2", current);
  await launch(); await verifyData("same-version-reinstall"); await closeNormally();
  checkpoint("same-version reinstall: correct shortcuts and unchanged saved data");

  dbHash = hash(join(data, "fussenn.db"));
  await uninstall();
  assert.equal(hash(join(data, "fussenn.db")), dbHash);
  checkpoint("uninstall: app/registry/shortcuts removed; database retained byte for byte");

  await runInstaller(newInstaller, ["/S", "/currentuser", `/D=${installed}`]);
  checkInstalled("0.0.2", current);
  await launch(); await verifyData("after-uninstall-reinstall"); await closeNormally();
  checkpoint("reinstall after uninstall: conversations, notes, manuscript history and settings restored");
  await uninstall();
  productionUnchanged(inspect());
  if (existsSync(cache)) {
    inside(cache, initial.localAppData);
    assert.equal(basename(cache), `${packageName}-updater`);
    rmSync(cache, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
  assert.equal(dirname(realpathSync.native(scratch)), parent);
  assert(basename(scratch).startsWith("fussenn-installer-test-"));
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  checkpoint("cleanup: temporary install/data/cache removed; everyday installation unchanged");
  report.status = "passed";
} catch (error) {
  report.status = "failed"; report.error = error.stack;
  await app?.close().catch(() => {});
  console.error(`Test stopped. Isolated files retained at ${scratch}`);
  throw error;
} finally {
  writeFileSync(join(results, "result.json"), JSON.stringify(report, null, 2));
  console.log(`Installer lifecycle result: ${join(results, "result.json")}`);
}
