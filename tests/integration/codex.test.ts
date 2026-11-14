import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { homedir, userInfo } from "node:os";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { CodexAppServerClient, neutralWorkspaceBases } from "@/server/providers/codex/client";
import { CODEX_INSTRUCTIONS, CodexProvider, codexSession, instructionsFingerprint, savedCodexSession } from "@/server/providers/codex";
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
    expect(await client.models()).toEqual([{ id: "m1", model: "fixture-model", displayName: "Fixture", isDefault: true, efforts: ["low", "medium", "high"], defaultEffort: "medium" }]);
    expect(await client.login()).toMatchObject({ type: "chatgpt", loginId: "login1" });
    expect(await client.login(true)).toMatchObject({ type: "chatgptDeviceCode", userCode: "ABCD-1234" });
    await client.logout();
  });
  it("uses independent threads, resumes, and reconstructs missing threads from DB context", async () => {
    const provider = new CodexProvider(client);
    expect(resolveProvider("codex")).toBeInstanceOf(CodexProvider);
    const chunks: string[] = [];
    const events: string[] = [];
    const main = await provider.generate(request, (e) => { if (e.type === "text_delta") chunks.push(e.text); else events.push(e.activity.kind); });
    const side = await provider.generate({ ...request, ownerType: "side_note", ownerId: "note", messages: [{ role: "user", content: "SIDE_SNAPSHOT" }] }, () => {});
    expect(main.text).toBe("Resource explained");
    expect(chunks.join("")).toBe(main.text);
    expect(events).toEqual(["thinking"]);
    expect(side.providerSessionId).not.toBe(main.providerSessionId);
    const resumed = await provider.generate({ ...request, providerSessionId: main.providerSessionId, userText: "follow up only" }, () => {});
    expect(resumed.providerSessionId).toBe(main.providerSessionId);
    let inspect = await client.request<{ lastInput: { input: { text: string }[]; sandboxPolicy: { type: string }; approvalPolicy: string }; lastOptions: { cwd: string; config: Record<string, unknown> } }>("test/inspect");
    expect(inspect.lastInput.input[0].text).toBe("follow up only");
    // A session for these instructions whose thread Codex no longer has.
    const missing = savedCodexSession("missing", false, instructionsFingerprint(CODEX_INSTRUCTIONS, CODEX_INSTRUCTIONS));
    const recovered = await provider.generate({ ...request, providerSessionId: missing }, () => {});
    expect((await client.request<{ resumed: string[] }>("test/inspect")).resumed).toContain("missing");
    expect(recovered.providerSessionId).not.toBe(missing);
    inspect = await client.request("test/inspect");
    expect(inspect.lastInput.input[0].text).toContain("SQLITE_CONTEXT");
    expect(inspect.lastInput.sandboxPolicy.type).toBe("readOnly");
    expect(inspect.lastInput.approvalPolicy).toBe("never");
    expect(inspect.lastOptions.cwd).toBe(client.workspace);
    expect(inspect.lastOptions.config["features.shell_tool"]).toBe(false);
    expect(inspect.lastOptions.config.mcp_servers).toEqual({ inherited_server: { enabled: false } });
  });
  it("passes the chosen effort on every turn, falling back to the model's default", async () => {
    const provider = new CodexProvider(client);
    const effort = async (value?: string | null) => {
      await provider.generate({ ...request, effort: value }, () => {});
      return (await client.request<{ lastInput: { effort?: string } }>("test/inspect")).lastInput.effort;
    };
    expect(await effort("high")).toBe("high");
    expect(await effort("ultra")).toBe("medium");
    expect(await effort(null)).toBe("medium");
    expect(await effort(undefined)).toBe("medium");
    expect(await provider.generate({ ...request, model: "unlisted-model", effort: "high" }, () => {})).toMatchObject({ text: "Resource explained" });
    expect((await client.request<{ lastInput: Record<string, unknown> }>("test/inspect")).lastInput).not.toHaveProperty("effort");
  });
  it("passes the chosen effort as it is when Codex cannot list models", async () => {
    await client.request("test/failModels");
    await new CodexProvider(client).generate({ ...request, effort: "high" }, () => {});
    expect((await client.request<{ lastInput: { effort?: string } }>("test/inspect")).lastInput.effort).toBe("high");
  });
  it("does not resume threads saved before the home folder path was kept out", async () => {
    const provider = new CodexProvider(client);
    // A bare thread id is how sessions were saved before; those threads hold the old paths in their context.
    const continued = await provider.generate({ ...request, providerSessionId: "thread-from-0.2", userText: "follow up" }, () => {});
    const inspect = await client.request<{ resumed: string[]; lastInput: { input: { text: string }[] } }>("test/inspect");
    expect(inspect.resumed).not.toContain("thread-from-0.2");
    expect(continued.providerSessionId).toMatch(/^fussenn2:[0-9a-f]{16}:thread-/);
    expect(inspect.lastInput.input[0].text).toContain("SQLITE_CONTEXT");
  });
  it("starts a new thread when the instructions have changed, as after an app update", async () => {
    const provider = new CodexProvider(client);
    const note = (instructions: string, providerSessionId?: string) => provider.generate({ ...request, ownerType: "side_note", ownerId: "note", messages: [{ role: "system", content: instructions }, { role: "user", content: "SIDE_SNAPSHOT" }], providerSessionId, userText: "follow up" }, () => {});
    const first = await note("Old note instructions.");
    expect(await note("Old note instructions.", first.providerSessionId!)).toMatchObject({ providerSessionId: first.providerSessionId });
    const updated = await note("New note instructions.", first.providerSessionId!);
    const inspect = await client.request<{ resumed: string[]; lastInput: { input: { text: string }[] }; lastOptions: { developerInstructions: string } }>("test/inspect");
    expect(inspect.resumed).toHaveLength(1);
    expect(updated.providerSessionId).not.toBe(first.providerSessionId);
    expect(inspect.lastOptions.developerInstructions).toBe("New note instructions.");
    expect(inspect.lastInput.input[0].text).toContain("SIDE_SNAPSHOT");
    // Reference data that may have changed goes with a question in a resumed thread, before the question.
    const resumed = await provider.generate({ ...request, ownerType: "side_note", ownerId: "note", messages: [{ role: "system", content: "New note instructions." }, { role: "user", content: "SIDE_SNAPSHOT" }], providerSessionId: updated.providerSessionId, userText: "follow up", resumeContext: "CURRENT_SURROUNDINGS" }, () => {});
    expect(resumed.providerSessionId).toBe(updated.providerSessionId);
    expect((await client.request<{ lastInput: { input: { text: string }[] } }>("test/inspect")).lastInput.input[0].text).toBe("CURRENT_SURROUNDINGS\n\nfollow up");
    // Sessions saved without a fingerprint, earlier in 0.3.0's development, start over as well.
    const thread = codexSession(first.providerSessionId)!.threadId;
    await note("Old note instructions.", `fussenn2:${thread}`);
    expect((await client.request<{ resumed: string[] }>("test/inspect")).resumed).toHaveLength(2);
  });
  it("allows web search only in threads started for it, and reports search progress", async () => {
    const provider = new CodexProvider(client);
    const plain = await provider.generate(request, () => {});
    let inspect = await client.request<{ lastOptions: { config: Record<string, unknown>; baseInstructions: string } }>("test/inspect");
    expect(inspect.lastOptions.config.web_search).toBe("disabled");
    expect(inspect.lastOptions.baseInstructions).toContain("Do not use tools");
    await client.request("test/behavior", { behavior: "web" });
    const activity: unknown[] = [];
    const searched = await provider.generate({ ...request, providerSessionId: plain.providerSessionId, webSearch: true }, (e) => { if (e.type === "activity") activity.push(e.activity); });
    // Switching on web search starts a new thread from the saved conversation.
    expect(searched.providerSessionId).toMatch(/^fussenn2-web:[0-9a-f]{16}:thread-/);
    expect(searched.text).toBe("Searched answer");
    inspect = await client.request("test/inspect");
    expect(inspect.lastOptions.config.web_search).toBe("live");
    expect(inspect.lastOptions.config["features.shell_tool"]).toBe(false);
    expect(inspect.lastOptions.baseInstructions).toContain("Web search is the only tool");
    expect((await client.request<{ lastInput: { input: { text: string }[] } }>("test/inspect")).lastInput.input[0].text).toContain("SQLITE_CONTEXT");
    expect(activity).toEqual([
      { kind: "thinking" },
      { kind: "thinking", detail: "最新の情報を確認します。" },
      { kind: "searching" },
      { kind: "searching", detail: "fixture release notes" },
      { kind: "reading", detail: "docs.example.test" },
      { kind: "thinking" },
    ]);
    const resumed = await provider.generate({ ...request, providerSessionId: searched.providerSessionId, webSearch: true, userText: "follow up" }, () => {});
    expect(resumed.providerSessionId).toBe(searched.providerSessionId);
    expect((await client.request<{ lastInput: { input: { text: string }[] } }>("test/inspect")).lastInput.input[0].text).toBe("follow up");
    const off = await provider.generate({ ...request, providerSessionId: searched.providerSessionId, webSearch: false }, () => {});
    expect(off.providerSessionId).toMatch(/^fussenn2:[0-9a-f]{16}:thread-/);
    expect(off.providerSessionId).not.toBe(plain.providerSessionId);
    inspect = await client.request("test/inspect");
    expect(inspect.lastOptions.config.web_search).toBe("disabled");
  });
  it("names the thread a stopped question used, after Codex has ended the turn", async () => {
    const provider = new CodexProvider(client);
    const first = await provider.generate(request, () => {});
    await client.request("test/behavior", { behavior: "hang" });
    const abort = new AbortController();
    const texts: string[] = [];
    const pending = provider.generate({ ...request, providerSessionId: first.providerSessionId, webSearch: true, signal: abort.signal }, (e) => { if (e.type === "text_delta") texts.push(e.text); });
    await expect.poll(() => texts.length).toBeGreaterThan(0);
    abort.abort();
    const error = await pending.then(() => ({ name: "completed" }), (e: unknown) => e as { name: string; providerSessionId?: string }) as { name: string; providerSessionId?: string };
    expect(error.name).toBe("AbortError");
    // Web search started a new thread for this question; that one is kept, not the earlier one.
    expect(error.providerSessionId).toMatch(/^fussenn2-web:[0-9a-f]{16}:thread-/);
    expect(error.providerSessionId).not.toBe(first.providerSessionId);
  });
  it("ignores late notices from an earlier turn of the same thread", async () => {
    const provider = new CodexProvider(client);
    const first = await provider.generate(request, () => {});
    await client.request("test/behavior", { behavior: "stale" });
    const next = await provider.generate({ ...request, providerSessionId: first.providerSessionId, userText: "follow up" }, () => {});
    expect(next.text).toBe("Resource explained");
  });
  it("does not keep a stopped thread whose turn Codex has not confirmed as ended", async () => {
    const provider = new CodexProvider(client);
    const first = await provider.generate(request, () => {});
    await client.request("test/behavior", { behavior: "hang" });
    await client.request("test/ignoreInterrupt");
    const abort = new AbortController();
    const texts: string[] = [];
    const pending = provider.generate({ ...request, providerSessionId: first.providerSessionId, signal: abort.signal }, (e) => { if (e.type === "text_delta") texts.push(e.text); });
    await expect.poll(() => texts.length).toBeGreaterThan(0);
    abort.abort();
    const error = await pending.then(() => ({ name: "completed" }), (e: unknown) => e as { name: string; providerSessionId?: string }) as { name: string; providerSessionId?: string };
    expect(error.name).toBe("AbortError");
    expect(error.providerSessionId).toBeUndefined();
  }, 10_000);
  it("starts a new thread when neither a model list nor an effort is available", async () => {
    const provider = new CodexProvider(client);
    const first = await provider.generate(request, () => {});
    const fresh = new CodexAppServerClient({ command: process.execPath, args: [resolve("tests/fixtures/codex-app-server.mjs")], workspace: client.workspace });
    try {
      await fresh.request("test/failModels");
      const next = await new CodexProvider(fresh).generate({ ...request, providerSessionId: first.providerSessionId, userText: "follow up" }, () => {});
      // Not resumed: the new thread receives the whole saved conversation.
      const inspect = await fresh.request<{ resumed: string[]; lastInput: { input: { text: string }[] } }>("test/inspect");
      expect(inspect.resumed).toEqual([]);
      expect(inspect.lastInput.input[0].text).toContain("SQLITE_CONTEXT");
      expect(next.providerSessionId).toMatch(/^fussenn2:[0-9a-f]{16}:thread-/);
    } finally { fresh.dispose(); }
  });
  it("declines approval requests and restarts after an unexpected process exit", async () => {
    await client.request("test/approvals");
    const inspect = await client.request<{ approvalResults: { result?: { decision?: string }; error?: { code: number } }[] }>("test/inspect");
    expect(inspect.approvalResults.map((r) => r.result?.decision ?? r.error?.code)).toEqual(["decline", "decline", -32601]);
    await expect(client.request("test/crash")).rejects.toThrow("接続が切れ");
    expect((await client.status()).signedIn).toBe(true);
  });
  it("works in a new random folder, which Codex shows the model, outside the home folder and without the account name", () => {
    const bases = [...neutralWorkspaceBases("darwin", {}), ...neutralWorkspaceBases("win32", { ProgramData: "C:\\ProgramData", PUBLIC: "C:\\Users\\Public" })];
    expect(bases.length).toBeGreaterThanOrEqual(3);
    for (const path of bases) {
      expect(path.toLowerCase().startsWith(homedir().toLowerCase())).toBe(false);
      expect(path.toLowerCase().split(/[\\/]+/)).not.toContain(userInfo().username.toLowerCase());
    }
    expect(neutralWorkspaceBases("win32", { ProgramData: "C:\\ProgramData" })[0]).toContain("Fussenn");
    expect(neutralWorkspaceBases("win32", { ProgramData: homedir() + "\\data" })).toEqual([]);
    const first = new CodexAppServerClient(), second = new CodexAppServerClient();
    try {
      expect(dirname(first.workspace)).toBe(neutralWorkspaceBases()[0]);
      expect(first.workspace).toMatch(/fussenn-codex-[A-Za-z0-9]{6}$/);
      expect(second.workspace).not.toBe(first.workspace);
      expect(first.workspace).not.toMatch(new RegExp(`${process.getuid?.() ?? "no-uid"}$`));
    } finally { first.dispose(); second.dispose(); }
    expect(existsSync(first.workspace)).toBe(false);
  });
  it("reports a missing CLI using a user-facing error", async () => {
    const missing = new CodexAppServerClient({ command: "fussenn-nonexistent-cli-binary", workspace: client.workspace });
    try { await expect(missing.status()).rejects.toThrow("Codex CLIが見つかりません"); }
    finally { missing.dispose(); }
  });
});
