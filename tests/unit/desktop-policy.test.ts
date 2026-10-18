import { describe, expect, it } from "vitest";
import { isAppUrl, isLoginUrl, isWebUrl, runtimePath, safeDownloadName } from "../../desktop/policy.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireRuntimeLock } from "@/server/runtime-lock";
import { guardLocalRequest } from "@/server/http";

describe("desktop boundaries", () => {
  it("only trusts the app origin and official HTTPS authentication", () => {
    expect(isAppUrl("fussenn://app/settings")).toBe(true);
    for (const value of ["file:///etc/passwd", "fussenn://evil/", "fussenn://app.evil/", "fussenn://user@app/", "https://app/", "javascript:alert(1)"]) expect(isAppUrl(value)).toBe(false);
    expect(isLoginUrl("https://auth.openai.com/oauth/authorize?state=test")).toBe(true);
    for (const value of ["http://auth.openai.com/", "https://auth.openai.com.evil/", "https://user@auth.openai.com/", "https://auth.openai.com:444/", "file:///tmp/x"]) expect(isLoginUrl(value)).toBe(false);
    expect(isWebUrl("https://example.com/path")).toBe(true);
    expect(isWebUrl("ms-settings:privacy")).toBe(false);
    expect(isWebUrl("https://user:pass@example.com")).toBe(false);
    expect(safeDownloadName("../../data:secret.zip")).toBe(".._.._data_secret.zip");
  });
  it("includes Finder/Homebrew and Windows npm paths without invoking a shell", () => {
    const mac = runtimePath({ PATH: "/usr/bin:/bin" }, "/Users/test", "/bundled", "darwin");
    expect(mac.startsWith("/bundled:")).toBe(true);
    expect(mac).toContain("/opt/homebrew/bin");
    expect(mac).toContain("/usr/local/bin");
    const win = runtimePath({ Path: "C:\\Windows;C:\\tools", APPDATA: "C:\\Users\\test\\AppData\\Roaming" }, "C:\\Users\\test", "C:\\bundled", "win32");
    expect(win).toContain("C:\\Windows;C:\\tools");
    expect(win).toContain("npm");
  });
  it("locks a data directory until its owning runtime releases it", () => {
    const directory = mkdtempSync(join(tmpdir(), "fussenn-lock-"));
    let release = acquireRuntimeLock(directory);
    try {
      expect(() => acquireRuntimeLock(directory)).toThrow("同じ保存先");
      release();
      release = acquireRuntimeLock(directory);
    } finally { release(); rmSync(directory, { recursive: true }); }
  });
  it("rejects direct loopback API access when running inside the desktop app", () => {
    const previous = process.env.FUSSENN_DESKTOP_TOKEN;
    process.env.FUSSENN_DESKTOP_TOKEN = "test-secret";
    try {
      expect(() => guardLocalRequest(new Request("http://127.0.0.1:4321/api/conversations"))).toThrow("アプリから");
      expect(() => guardLocalRequest(new Request("http://127.0.0.1:4321/api/conversations", { headers: { "x-fussenn-desktop-token": "test-secret", origin: "http://evil.test" } }))).toThrow("別のサイト");
      expect(() => guardLocalRequest(new Request("http://127.0.0.1:4321/api/conversations", { headers: { "x-fussenn-desktop-token": "test-secret", origin: "http://127.0.0.1:4321" } }))).not.toThrow();
    } finally { if (previous === undefined) delete process.env.FUSSENN_DESKTOP_TOKEN; else process.env.FUSSENN_DESKTOP_TOKEN = previous; }
  });
});
