let revision: string | null = null;
let stale = false;
let bootstrap: Promise<void> | null = null;
const HEADER = "X-Fussenn-Revision";
const message = "データが復元されています。再読み込みしてから操作してください。";
export function markWorkspaceStale() {
  stale = true;
  if (typeof window !== "undefined") window.dispatchEvent(new Event("fussenn-workspace-changed"));
}
function receive(response: Response, acceptChange = false) {
  const current = response.headers.get(HEADER);
  if (!current) return;
  if (revision && current !== revision && !acceptChange) { markWorkspaceStale(); throw new Error(message); }
  revision = current;
}
export async function workspaceFetch(path: string, init?: RequestInit, acceptChange = false) {
  if (stale) throw new Error(message);
  if (!revision && init?.method && !["GET", "HEAD"].includes(init.method)) {
    bootstrap ??= fetch("/api/workspace", { cache: "no-store" }).then((response) => {
      if (!response.ok) throw new Error("保存データの状態を確認できませんでした。");
      receive(response);
    }).finally(() => { bootstrap = null; });
    await bootstrap;
  }
  if (stale) throw new Error(message);
  const headers = new Headers(init?.headers);
  if (revision) headers.set(HEADER, revision);
  const request = fetch(`/api/${path}`, { ...init, headers, cache: "no-store" });
  const response = await (init?.method && !["GET", "HEAD"].includes(init.method) ? trackWorkspaceWrite(request) : request);
  receive(response, acceptChange && response.ok);
  return response;
}
export function announceRestore() {
  if (typeof window !== "undefined") {
    try { localStorage.setItem("fussenn-restored", `${revision}:${Date.now()}`); } catch { /* Response headers still protect other clients. */ }
  }
}
import { trackWorkspaceWrite } from "./desktop";
