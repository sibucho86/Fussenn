import spawn from "cross-spawn";
import type { ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmdirSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { AppError } from "@/server/errors";
import { EFFORT_PATTERN } from "@/lib/chat-options";

type JsonRecord = Record<string, unknown>;
type Listener = (method: string, params: JsonRecord) => void;
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
/** `efforts` lists the reasoning efforts the model accepts; `defaultEffort` is the one it uses unless told otherwise. */
export type CodexModel = { id: string; model: string; displayName: string; isDefault: boolean; efforts: string[]; defaultEffort: string | null };
type ListedModel = { id: string; model: string; displayName: string; isDefault: boolean; supportedReasoningEfforts?: { reasoningEffort?: unknown }[] | null; defaultReasoningEffort?: unknown };
export type CodexStatus = { installed: boolean; signedIn: boolean; authType: string | null; plan: string | null; error?: string; loginError?: string };
export type LoginResult = { type: "chatgpt"; loginId: string; authUrl: string } | { type: "chatgptDeviceCode"; loginId: string; verificationUrl: string; userCode: string };

export const SAFE_CODEX_CONFIG = {
  "features.shell_tool": false,
  "features.shell_snapshot": false,
  "features.unified_exec": false,
  "features.apps": false,
  "features.multi_agent": false,
  "features.memories": false,
  "features.hooks": false,
  "features.remote_plugin": false,
  "features.plugins": false,
  "features.computer_use": false,
  "features.browser_use": false,
  "features.in_app_browser": false,
  "features.image_generation": false,
  // The skills section lists absolute folder paths (inside the home folder, so with the account name).
  "skills.include_instructions": false,
  // Never read instruction files (AGENTS.md) from the working folder or its parents.
  "project_doc_max_bytes": 0,
  "web_search": "disabled",
  "mcp_servers": {},
  "plugins": {},
  "analytics.enabled": false,
  "feedback.enabled": false,
};
/**
 * Codex tells the model which folder it works in. Fussenn gives it a new, empty folder with a random
 * name, inside a place whose path contains neither the home folder nor the account name.
 * These are the places, in order of preference.
 */
export function neutralWorkspaceBases(platform: NodeJS.Platform = process.platform, env: Record<string, string | undefined> = process.env) {
  const home = homedir().toLowerCase(), account = accountName();
  const clean = (path: string) => isNeutralPath(path, home, account);
  if (platform === "win32") return [env.ProgramData, env.PUBLIC].filter((base): base is string => !!base && clean(base)).map((base) => join(base, "Fussenn"));
  return [tmpdir(), "/tmp"].filter(clean);
}
function isNeutralPath(path: string, home = homedir().toLowerCase(), account = accountName()) {
  const lower = path.toLowerCase();
  return !lower.startsWith(home) && !(account && lower.split(/[\\/]+/).includes(account));
}
function accountName() {
  try { return userInfo().username.toLowerCase(); } catch { return ""; }
}
// A random name created fresh, so no one can prepare the folder in advance. The real path is checked too,
// since a temporary area can be a link into the home folder and Codex may report the resolved path.
function createWorkspace() {
  for (const base of neutralWorkspaceBases()) {
    try {
      mkdirSync(base, { recursive: true });
      if (process.platform === "win32") removeOldWorkspaces(base);
      const folder = mkdtempSync(join(base, "fussenn-codex-"));
      if (isNeutralPath(realpathSync(folder))) return folder;
      rmSync(folder, { recursive: true, force: true });
    } catch { /* Try the next place. */ }
  }
  return "";
}
// ProgramData is not cleared by the system. Empty folders from earlier runs that could not be removed at exit
// (a folder in use cannot be deleted on Windows) are removed once they are a day old; a folder in use stays.
function removeOldWorkspaces(base: string) {
  for (const name of readdirSync(base)) {
    if (!name.startsWith("fussenn-codex-")) continue;
    try { const path = join(base, name); if (Date.now() - statSync(path).mtimeMs > 86_400_000) rmdirSync(path); } catch { /* Not empty or in use. */ }
  }
}
/** Arguments for `codex app-server` with every setting above applied. */
export function appServerArgs() {
  return ["app-server", "--listen", "stdio://", ...Object.entries(SAFE_CODEX_CONFIG).flatMap(([key, value]) => ["-c", `${key}=${tomlValue(value)}`])];
}
export class CodexAppServerClient {
  private child: ChildProcess | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 0;
  private pending = new Map<number, Pending>();
  private listeners = new Set<Listener>();
  private loginError = "";
  private modelCache: { at: number; models: CodexModel[] } | null = null;
  private ownsWorkspace = false;
  threadConfig: Record<string, unknown> = { ...SAFE_CODEX_CONFIG };
  private workspacePath: string;
  /** The folder Codex works in; it can change when the old one has to be replaced. */
  get workspace() { return this.workspacePath; }
  constructor(private options: { command?: string; args?: string[]; workspace?: string; diagnostic?: (stage: string) => void } = {}) {
    this.workspacePath = options.workspace ?? createWorkspace();
    this.ownsWorkspace = !options.workspace && !!this.workspacePath;
  }
  subscribe(listener: Listener) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  async start() {
    if (this.ready) return this.ready;
    this.ready = this.initialize();
    try { await this.ready; } catch (error) { this.dispose(); throw error; }
  }
  /** Recreates the working folder, which the system may clear from its temporary area. */
  prepareWorkspace() {
    if (!this.workspacePath) throw new AppError("Codexの作業用フォルダを用意できませんでした。一時フォルダの空き容量と権限を確認してください。");
    mkdirSync(this.workspacePath, { recursive: true, mode: 0o700 });
    // After the system cleared the folder, something else may stand at its path; then use a new folder.
    if (this.ownsWorkspace && !isNeutralPath(realpathSync(this.workspacePath))) {
      this.workspacePath = createWorkspace();
      if (!this.workspacePath) throw new AppError("Codexの作業用フォルダを用意できませんでした。一時フォルダの空き容量と権限を確認してください。");
    }
  }
  private async initialize() {
    this.prepareWorkspace();
    const args = this.options.args ?? appServerArgs();
    const child = spawn(this.options.command ?? (process.env.CODEX_BIN || "codex"), args, {
      cwd: this.workspace, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
      env: process.env,
    });
    this.child = child;
    child.on("error", () => this.fail(child, new AppError("Codex CLIが見つかりません。Codex Providerを利用するにはCodex CLIをインストールしてください。")));
    child.on("exit", () => this.fail(child, new AppError("Codexとの接続が切れました。次の送信で再接続します。")));
    // Never print raw protocol or stderr: either may contain account information.
    child.stderr?.resume();
    if (this.options.diagnostic) child.stderr?.on("data", (chunk: Buffer) => {
      const categories = chunk.toString().match(/\b(?:ERROR|WARN|timeout|timed out|failed|mcp|sandbox|model|permission|config|database|locked|plugin|shell|snapshot|thread)\b/gi);
      if (categories?.length) this.options.diagnostic?.(`stderr categories: ${[...new Set(categories)].join(", ")}`);
    });
    child.stdin?.on("error", () => this.fail(child, new AppError("Codexとの通信に失敗しました。")));
    if (!child.stdout) throw new AppError("Codexを起動できませんでした。");
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => this.receive(line));
    child.on("exit", () => lines.close());
    await this.rawRequest("initialize", { clientInfo: { name: "fussenn", title: "Fussenn", version: "0.1.0" }, capabilities: { experimentalApi: false } });
    this.write({ method: "initialized", params: {} });
    // Config merges tables: an empty mcp_servers object does not disable inherited servers.
    // Read only names, then override every inherited server/plugin in this app's threads.
    const { config } = await this.rawRequest<{ config: { mcp_servers?: Record<string, unknown>; plugins?: Record<string, unknown> } }>("config/read", { includeLayers: false });
    this.threadConfig = {
      ...SAFE_CODEX_CONFIG,
      mcp_servers: Object.fromEntries(Object.keys(config.mcp_servers ?? {}).map((name) => [name, { enabled: false }])),
      plugins: Object.fromEntries(Object.keys(config.plugins ?? {}).map((name) => [name, { enabled: false }])),
    };
  }
  private fail(child: ChildProcess, error: Error) {
    if (this.child !== child) return;
    this.child = null; this.ready = null;
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
    this.pending.clear();
    for (const listener of this.listeners) listener("__closed", {});
  }
  private write(value: unknown) {
    if (!this.child?.stdin?.writable) throw new AppError("Codexとの接続がありません。");
    this.child.stdin.write(JSON.stringify(value) + "\n");
  }
  private receive(line: string) {
    let message: { id?: number | string; method?: string; params?: JsonRecord; result?: unknown; error?: unknown };
    try { message = JSON.parse(line); } catch { return; }
    if (message.id !== undefined && message.method) {
      // Never approve a command, file change, tool call, or permissions expansion.
      let result: unknown;
      if (message.method === "item/commandExecution/requestApproval" || message.method === "item/fileChange/requestApproval") result = { decision: "decline" };
      else if (message.method === "execCommandApproval" || message.method === "applyPatchApproval") result = { decision: "denied" };
      else if (message.method === "item/permissions/requestApproval") result = { permissions: {}, scope: "turn" };
      else if (message.method === "item/tool/requestUserInput") result = { answers: {} };
      else if (message.method === "item/tool/call") result = { contentItems: [{ type: "inputText", text: "Tools are disabled in Fussenn." }], success: false };
      if (result) this.write({ id: message.id, result });
      else this.write({ id: message.id, error: { code: -32601, message: "Unsupported request in Fussenn" } });
      return;
    }
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.options.diagnostic?.(`response ${message.id}${message.error ? " error" : " ok"}`);
      if (message.error && this.options.diagnostic) {
        const allowed = new Set(["invalid", "missing", "unknown", "field", "type", "networkAccess", "sandboxPolicy", "access", "readOnly", "permissions", "supported", "unsupported", "policy", "model", "modelProvider", "tool", "tools", "allowed", "forbidden", "not", "found", "turn", "input", "text_elements"]);
        this.options.diagnostic(`error fields: ${(JSON.stringify(message.error).match(/[A-Za-z_]+/g) ?? []).filter((word) => allowed.has(word)).join(" ")}`);
      }
      this.pending.delete(message.id); clearTimeout(pending.timer);
      if (message.error) pending.reject(new AppError("Codexのリクエストに失敗しました。認証状態・モデル・CLIのバージョンを確認してください。"));
      else pending.resolve(message.result);
      return;
    }
    if (message.method) {
      this.options.diagnostic?.(`notification ${message.method}`);
      if (message.method === "account/login/completed") this.loginError = message.params?.success ? "" : "ログインを完了できませんでした。もう一度お試しください。";
      for (const listener of this.listeners) listener(message.method, message.params ?? {});
    }
  }
  private rawRequest<T>(method: string, params: unknown): Promise<T> {
    const id = ++this.nextId;
    this.options.diagnostic?.(`request ${id} ${method}`);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new AppError("Codexからの応答がタイムアウトしました。")); }, method === "thread/start" || method === "thread/resume" ? 90_000 : 30_000);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      try { this.write({ id, method, params }); }
      catch (error) { this.pending.delete(id); clearTimeout(timer); reject(error); }
    });
  }
  async request<T>(method: string, params: unknown = {}): Promise<T> { await this.start(); return this.rawRequest<T>(method, params); }
  async status(): Promise<CodexStatus> {
    const result = await this.request<{ account: { type: string; planType?: string } | null }>("account/read", { refreshToken: false });
    return { installed: true, signedIn: result.account?.type === "chatgpt", authType: result.account?.type ?? null, plan: result.account?.planType ?? null, ...(this.loginError ? { loginError: this.loginError } : {}) };
  }
  async login(device = false) {
    this.loginError = ""; this.modelCache = null;
    return this.request<LoginResult>("account/login/start", device ? { type: "chatgptDeviceCode" } : { type: "chatgpt", useHostedLoginSuccessPage: true, appBrand: "chatgpt" });
  }
  async logout() { await this.request("account/logout"); this.loginError = ""; this.modelCache = null; }
  /** The last list received, however old, for when Codex cannot answer now. */
  lastModels() { return this.modelCache?.models ?? null; }
  /** Lists the account's models. `maxAge` (ms) allows reusing a recent list. */
  async models(maxAge = 0) {
    if (maxAge > 0 && this.modelCache && Date.now() - this.modelCache.at < maxAge) return this.modelCache.models;
    const models: CodexModel[] = [];
    let cursor: string | null = null;
    do {
      const page: { data: ListedModel[]; nextCursor: string | null } = await this.request("model/list", { cursor, limit: 100 });
      models.push(...page.data.map(listedModel));
      cursor = page.nextCursor;
    } while (cursor);
    this.modelCache = { at: Date.now(), models };
    return models;
  }
  dispose() {
    this.modelCache = null;
    const child = this.child;
    if (child) {
      this.fail(child, new AppError("Codexとの接続を終了しました。"));
      if (process.platform === "win32" && child.pid) spawn.sync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      else child.kill("SIGTERM");
    } else this.ready = null;
    // After the process is stopped: Windows cannot delete a folder a running process works in.
    if (this.ownsWorkspace) { try { rmSync(this.workspacePath, { recursive: true, force: true }); } catch { /* Removed later (see removeOldWorkspaces) or by the system. */ } }
  }
}
function tomlValue(value: unknown) { return value && typeof value === "object" ? "{}" : JSON.stringify(value); }
function listedModel({ id, model, displayName, isDefault, supportedReasoningEfforts, defaultReasoningEffort }: ListedModel): CodexModel {
  const efforts = (supportedReasoningEfforts ?? []).flatMap((option) => typeof option?.reasoningEffort === "string" && EFFORT_PATTERN.test(option.reasoningEffort) ? [option.reasoningEffort] : []);
  const defaultEffort = typeof defaultReasoningEffort === "string" && efforts.includes(defaultReasoningEffort) ? defaultReasoningEffort : null;
  return { id, model, displayName, isDefault, efforts, defaultEffort };
}
const shared = globalThis as typeof globalThis & { fussennCodex?: CodexAppServerClient };
export function getCodexClient() {
  if (!shared.fussennCodex) {
    const client = new CodexAppServerClient();
    shared.fussennCodex = client;
    process.once("exit", () => client.dispose());
  }
  return shared.fussennCodex;
}
