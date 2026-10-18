import spawn from "cross-spawn";
import type { ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { dataDirectory } from "@/server/db";
import { AppError } from "@/server/errors";

type JsonRecord = Record<string, unknown>;
type Listener = (method: string, params: JsonRecord) => void;
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
export type CodexModel = { id: string; model: string; displayName: string; isDefault: boolean };
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
  "web_search": "disabled",
  "mcp_servers": {},
  "plugins": {},
  "analytics.enabled": false,
  "feedback.enabled": false,
};
export class CodexAppServerClient {
  private child: ChildProcess | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 0;
  private pending = new Map<number, Pending>();
  private listeners = new Set<Listener>();
  private loginError = "";
  threadConfig: Record<string, unknown> = { ...SAFE_CODEX_CONFIG };
  readonly workspace: string;
  constructor(private options: { command?: string; args?: string[]; workspace?: string; diagnostic?: (stage: string) => void } = {}) {
    this.workspace = options.workspace ?? join(dataDirectory(), "codex-workspace");
  }
  subscribe(listener: Listener) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  async start() {
    if (this.ready) return this.ready;
    this.ready = this.initialize();
    try { await this.ready; } catch (error) { this.dispose(); throw error; }
  }
  private async initialize() {
    mkdirSync(this.workspace, { recursive: true, mode: 0o700 });
    const args = this.options.args ?? ["app-server", "--listen", "stdio://", ...Object.entries(SAFE_CODEX_CONFIG).flatMap(([key, value]) => ["-c", `${key}=${tomlValue(value)}`])];
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
    this.loginError = "";
    return this.request<LoginResult>("account/login/start", device ? { type: "chatgptDeviceCode" } : { type: "chatgpt", useHostedLoginSuccessPage: true, appBrand: "chatgpt" });
  }
  async logout() { await this.request("account/logout"); this.loginError = ""; }
  async models() {
    const models: CodexModel[] = [];
    let cursor: string | null = null;
    do {
      const page: { data: CodexModel[]; nextCursor: string | null } = await this.request("model/list", { cursor, limit: 100 });
      models.push(...page.data.map(({ id, model, displayName, isDefault }) => ({ id, model, displayName, isDefault })));
      cursor = page.nextCursor;
    } while (cursor);
    return models;
  }
  dispose() {
    const child = this.child;
    if (!child) { this.ready = null; return; }
    this.fail(child, new AppError("Codexとの接続を終了しました。"));
    if (process.platform === "win32" && child.pid) spawn.sync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else child.kill("SIGTERM");
  }
}
function tomlValue(value: unknown) { return value && typeof value === "object" ? "{}" : JSON.stringify(value); }
const shared = globalThis as typeof globalThis & { fussennCodex?: CodexAppServerClient };
export function getCodexClient() {
  if (!shared.fussennCodex) {
    const client = new CodexAppServerClient();
    shared.fussennCodex = client;
    process.once("exit", () => client.dispose());
  }
  return shared.fussennCodex;
}
