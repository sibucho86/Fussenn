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
  const client = new CodexAppServerClient({ workspace: join(directory, "codex-workspace"), diagnostic: (stage) => stages.push(stage) });
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
