import { expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "@/server/db";
import { Store } from "@/server/services/store";
import { mainStream, noteStream } from "@/server/services/generation";
import { CodexAppServerClient } from "@/server/providers/codex/client";
import { CodexProvider } from "@/server/providers/codex";
import { buildMainContext } from "@/lib/context/main";

// Opt-in only: npm run test:codex uses the signed-in account's Codex allowance.
it("uses real Codex auth, isolated threads, streaming, persistence and resume", async () => {
  const directory = mkdtempSync(join(tmpdir(), "fussenn-live-"));
  const stages: string[] = [];
  // The app's own working folder: a temporary folder can sit inside the home folder (as on Windows).
  const client = new CodexAppServerClient({ diagnostic: (stage) => stages.push(stage) });
  const database = openDatabase(join(directory, "fussenn.db"));
  const store = new Store(database.db);
  try {
    expect((await client.status()).signedIn, "Codex CLI must be signed in with ChatGPT").toBe(true);
    const models = await client.models();
    const model = models.find((m) => m.isDefault) ?? models[0];
    expect(model).toBeDefined();
    const configuration = await client.request<{ config: { mcp_servers?: Record<string, { enabled?: boolean }>; plugins?: Record<string, { enabled?: boolean }> } }>("config/read", { includeLayers: false });
    stages.push(`enabled MCP: ${Object.values(configuration.config.mcp_servers ?? {}).filter((s) => s.enabled !== false).length}; enabled plugins: ${Object.values(configuration.config.plugins ?? {}).filter((s) => s.enabled !== false).length}`);
    const conversation = store.createConversation("codex", model.model);
    const provider = new CodexProvider(client);
    const mainOutput = await mainStream(store, conversation.id, "次の一文だけをそのまま回答してください: Resource は参照できる情報です。", provider).text();
    expect(mainOutput, stages.join("\n")).toContain('"type":"completed"');
    const parent = store.mainMessages(conversation.id)[1];
    expect(parent.content).toContain("Resource");
    const start = parent.content.indexOf("Resource");
    const note = store.createNote(conversation.id, parent.id, { selectedText: "Resource", anchorStart: start, anchorEnd: start + 8, anchorPrefix: parent.content.slice(Math.max(0, start - 40), start), anchorSuffix: parent.content.slice(start + 8, start + 48), anchorVersion: 1 }, { x: 300, y: 50 });
    const sideOutput = await noteStream(store, note.id, "SIDE_ONLY_9B4E: 選択した言葉を20文字以内で説明してください。", provider).text();
    expect(sideOutput).toContain('"type":"completed"');
    const mainId = store.conversation(conversation.id).providerSessionId;
    const sideId = store.note(note.id).providerSessionId;
    expect(mainId).toBeTruthy(); expect(sideId).toBeTruthy(); expect(mainId).not.toBe(sideId);
    expect(JSON.stringify(buildMainContext(store.mainMessages(conversation.id), "続き"))).not.toContain("SIDE_ONLY_9B4E");
    const resumed = await mainStream(store, conversation.id, "今の説明を10文字以内に短くしてください。", provider).text();
    expect(resumed).toContain('"type":"completed"');
    expect(store.conversation(conversation.id).providerSessionId).toBe(mainId);
    expect(store.mainMessages(conversation.id)).toHaveLength(4);
    expect(store.noteMessages(note.id)).toHaveLength(2);
  } finally { client.dispose(); database.sqlite.close(); }
});
it("uses the chosen effort and web search with real Codex, reporting search progress", async () => {
  const directory = mkdtempSync(join(tmpdir(), "fussenn-live-"));
  const client = new CodexAppServerClient();
  const database = openDatabase(join(directory, "fussenn.db"));
  const store = new Store(database.db);
  try {
    expect((await client.status()).signedIn, "Codex CLI must be signed in with ChatGPT").toBe(true);
    const models = await client.models();
    const model = models.find((m) => m.isDefault) ?? models[0];
    expect(model.efforts.length, "the model list reports reasoning efforts").toBeGreaterThan(0);
    const effort = model.efforts.includes("low") ? "low" : model.efforts[0];
    const conversation = store.createConversation("codex", model.model);
    const provider = new CodexProvider(client);
    const output = await mainStream(store, conversation.id, "Web検索で Node.js の公式サイト（nodejs.org）を調べ、現在の LTS 版の番号だけを、出典のリンクを付けて答えてください。", provider, { effort, webSearch: true }).text();
    const events = output.trim().split("\n").map((line) => JSON.parse(line) as { type: string; activity?: { kind: string } });
    expect(events.at(-1)?.type, output.slice(-400)).toBe("completed");
    expect(events.some((event) => event.activity?.kind === "searching"), "a web search was reported").toBe(true);
    expect(store.conversation(conversation.id).providerSessionId).toMatch(/^fussenn2-web:/);
    expect(store.mainMessages(conversation.id)[1].content).toMatch(/https?:\/\//);
    // Turning web search off again continues in a new thread without the tool.
    const plain = await mainStream(store, conversation.id, "今の答えを一文で言い直してください。", provider, { effort, webSearch: false }).text();
    expect(plain).toContain('"type":"completed"');
    expect(store.conversation(conversation.id).providerSessionId).toMatch(/^fussenn2:/);
  } finally { client.dispose(); database.sqlite.close(); }
});
