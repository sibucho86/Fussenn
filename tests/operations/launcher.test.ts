import { expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { windowsScript } from "./windows";

it.skipIf(process.platform !== "win32")("handles duplicate launch, active answers, stopping, reopening and stale process records", async () => {
  const directory = mkdtempSync(join(tmpdir(), "fussenn-launcher-")), port = 3270, base = `http://127.0.0.1:${port}/api/`;
  const path = resolve(`.tmp/desktop-server-${port}.json`), wrongPath = resolve(".tmp/desktop-server-3272.json");
  expect(existsSync(wrongPath)).toBe(false);
  try {
    const starts = await Promise.all([windowsScript("Launch-Fussenn", port, directory), windowsScript("Launch-Fussenn", port, directory)]);
    for (const result of starts) expect(result, result.output).toMatchObject({ code: 0 });
    const state = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
    expect((await windowsScript("Launch-Fussenn", port, directory)).code).toBe(0);
    expect(JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")).processId).toBe(state.processId);
    const revision = (await fetch(base + "workspace")).headers.get("X-Fussenn-Revision")!;
    const headers = { "Content-Type": "application/json", "X-Fussenn-Revision": revision };
    const chat = await (await fetch(base + "conversations", { method: "POST", headers, body: JSON.stringify({ providerKind: "mock", model: "mock-demo" }) })).json();
    const generation = await fetch(base + "chat/main", { method: "POST", headers, body: JSON.stringify({ ownerId: chat.id, text: "長い回答".repeat(3000) }) });
    const stop = await windowsScript("Stop-Fussenn", port, directory);
    expect(stop.code).toBe(1); expect(stop.output).toContain("still being generated");
    expect((await fetch(base + "health")).status).toBe(200);
    await generation.text();
    const before = await (await fetch(base + `conversations/${chat.id}`)).json();
    writeFileSync(wrongPath, JSON.stringify({ ...state, port: 3272 }));
    const refused = await windowsScript("Stop-Fussenn", 3272, directory);
    expect(refused.code).toBe(1); expect(refused.output).toContain("not this Fussenn");
    expect((await fetch(base + "health")).status).toBe(200);
    expect((await windowsScript("Stop-Fussenn", port, directory)).code).toBe(0);
    expect((await windowsScript("Stop-Fussenn", port, directory)).code).toBe(0);
    expect((await windowsScript("Launch-Fussenn", port, directory)).code).toBe(0);
    expect(await (await fetch(base + `conversations/${chat.id}`)).json()).toEqual(before);
  } finally {
    await windowsScript("Stop-Fussenn", port, directory);
    if (existsSync(wrongPath)) unlinkSync(wrongPath);
  }
});

it.skipIf(process.platform !== "win32")("refuses to reuse or stop a port occupied by an unrelated app", async () => {
  const server = createServer((_request, response) => { response.setHeader("Content-Type", "application/json"); response.end('{"app":"unrelated"}'); });
  await new Promise<void>((resolveReady) => server.listen(3271, "127.0.0.1", resolveReady));
  try {
    const result = await windowsScript("Launch-Fussenn", 3271, mkdtempSync(join(tmpdir(), "fussenn-port-")));
    expect(result.code).toBe(1); expect(result.output).toContain("another server");
    expect(await (await fetch("http://127.0.0.1:3271/api/health")).json()).toEqual({ app: "unrelated" });
  } finally { server.closeAllConnections(); await new Promise<void>((resolveClosed) => server.close(() => resolveClosed())); }
});
