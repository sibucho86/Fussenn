import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { CodexAppServerClient } from "@/server/providers/codex/client";
import { CodexProvider } from "@/server/providers/codex";
import { resolveProvider } from "@/server/providers";
import type { GenerationRequest } from "@/server/providers/provider";

describe("Codex JSONL protocol", () => {
  let client: CodexAppServerClient;
  beforeEach(() => { client = new CodexAppServerClient({ command: process.execPath, args: [resolve("tests/fixtures/codex-app-server.mjs")], workspace: mkdtempSync(join(tmpdir(), "fussenn-codex-test-")) }); });
  afterEach(() => client.dispose());
  const request: GenerationRequest = { ownerType: "conversation", ownerId: "main", model: "fixture-model", messages: [{ role: "user", content: "SQLITE_CONTEXT" }], userText: "current question" };
  it("handshakes, lists models and handles both auth methods without persisting identity", async () => {
    expect(await client.status()).toMatchObject({ signedIn: true, plan: "test" });
    expect(JSON.stringify(await client.status())).not.toContain("email");
    expect(await client.models()).toEqual([{ id: "m1", model: "fixture-model", displayName: "Fixture", isDefault: true }]);
    expect(await client.login()).toMatchObject({ type: "chatgpt", loginId: "login1" });
    expect(await client.login(true)).toMatchObject({ type: "chatgptDeviceCode", userCode: "ABCD-1234" });
    await client.logout();
  });
  it("uses independent threads, resumes, and reconstructs missing threads from DB context", async () => {
    const provider = new CodexProvider(client);
    expect(resolveProvider("codex")).toBeInstanceOf(CodexProvider);
    const chunks: string[] = [];
    const main = await provider.generate(request, (e) => chunks.push(e.text));
    const side = await provider.generate({ ...request, ownerType: "side_note", ownerId: "note", messages: [{ role: "user", content: "SIDE_SNAPSHOT" }] }, () => {});
    expect(main.text).toBe("Resource explained");
    expect(chunks.join("")).toBe(main.text);
    expect(side.providerSessionId).not.toBe(main.providerSessionId);
    const resumed = await provider.generate({ ...request, providerSessionId: main.providerSessionId, userText: "follow up only" }, () => {});
    expect(resumed.providerSessionId).toBe(main.providerSessionId);
    let inspect = await client.request<{ lastInput: { input: { text: string }[]; sandboxPolicy: { type: string }; approvalPolicy: string }; lastOptions: { cwd: string; config: Record<string, unknown> } }>("test/inspect");
    expect(inspect.lastInput.input[0].text).toBe("follow up only");
    const recovered = await provider.generate({ ...request, providerSessionId: "missing" }, () => {});
    expect(recovered.providerSessionId).not.toBe("missing");
    inspect = await client.request("test/inspect");
    expect(inspect.lastInput.input[0].text).toContain("SQLITE_CONTEXT");
    expect(inspect.lastInput.sandboxPolicy.type).toBe("readOnly");
    expect(inspect.lastInput.approvalPolicy).toBe("never");
    expect(inspect.lastOptions.cwd).toBe(client.workspace);
    expect(inspect.lastOptions.config["features.shell_tool"]).toBe(false);
    expect(inspect.lastOptions.config.mcp_servers).toEqual({ inherited_server: { enabled: false } });
  });
  it("declines approval requests and restarts after an unexpected process exit", async () => {
    await client.request("test/approvals");
    const inspect = await client.request<{ approvalResults: { result?: { decision?: string }; error?: { code: number } }[] }>("test/inspect");
    expect(inspect.approvalResults.map((r) => r.result?.decision ?? r.error?.code)).toEqual(["decline", "decline", -32601]);
    await expect(client.request("test/crash")).rejects.toThrow("接続が切れ");
    expect((await client.status()).signedIn).toBe(true);
  });
  it("reports a missing CLI using a user-facing error", async () => {
    const missing = new CodexAppServerClient({ command: "fussenn-nonexistent-cli-binary", workspace: client.workspace });
    try { await expect(missing.status()).rejects.toThrow("Codex CLIが見つかりません"); }
    finally { missing.dispose(); }
  });
});
