import { delimiter, join } from "node:path";
import { readdirSync } from "node:fs";

export const APP_URL = "fussenn://app/";
export function isAppUrl(value) {
  try { const url = new URL(value); return url.protocol === "fussenn:" && url.host === "app" && !url.username && !url.password; }
  catch { return false; }
}
export function isWebUrl(value) {
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
}
export function isLoginUrl(value) {
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "auth.openai.com" && !url.port && !url.username && !url.password; }
  catch { return false; }
}
export function runtimePath(env, home, nodeDirectory, platform = process.platform) {
  const separator = platform === "win32" ? ";" : ":";
  const existing = Object.entries(env).find(([key]) => key.toLowerCase() === "path")?.[1] ?? "";
  const extra = platform === "win32" ? [join(env.APPDATA || join(home, "AppData", "Roaming"), "npm")]
    : ["/opt/homebrew/bin", "/usr/local/bin", join(home, ".local", "bin"), join(home, ".volta", "bin"), join(home, ".npm-global", "bin")];
  if (platform !== "win32") {
    try {
      const versions = join(home, ".nvm", "versions", "node");
      extra.push(...readdirSync(versions).filter((v) => /^v\d+\.\d+\.\d+$/.test(v)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).map((v) => join(versions, v, "bin")));
    } catch { /* nvm is optional. */ }
  }
  return [...new Set([nodeDirectory, ...existing.split(separator).filter(Boolean), ...extra])].join(platform === process.platform ? delimiter : separator);
}
export function safeDownloadName(value) {
  return (value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/g, "").slice(0, 180) || "Fussenn-export");
}
