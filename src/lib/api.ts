import { workspaceFetch } from "./workspace-request";
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await workspaceFetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "通信に失敗しました。");
  return body as T;
}
