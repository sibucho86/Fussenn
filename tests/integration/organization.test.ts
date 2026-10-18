import { expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "@/server/db";
import { Store } from "@/server/services/store";

it("migrates v2, persists folder moves and titles, and keeps conversations and notes when deleting a folder", () => {
  const filename = join(mkdtempSync(join(tmpdir(), "fussenn-folders-")), "fussenn.db");
  const original = openDatabase(filename);
  let store = new Store(original.db);
  const conversation = store.createConversation("mock", "mock-demo");
  const pair = store.beginMain(conversation.id, "MCP");
  store.finishMain(conversation.id, pair.assistantMessage.id, "Resource は情報です。", "complete", "main-session");
  const note = store.createNote(conversation.id, pair.assistantMessage.id, { selectedText: "Resource", anchorStart: 0, anchorEnd: 8, anchorPrefix: "", anchorSuffix: " は情報です。", anchorVersion: 1 }, { x: 300, y: 90 });
  store.updateNote(note.id, { memo: "学習メモ", color: "lavender" });
  const notePair = store.beginNote(note.id, "例を教えて");
  store.finishNote(note.id, notePair.assistantMessage.id, "例です。", "complete", "note-session");
  const before = store.detail(conversation.id);
  original.sqlite.exec("DROP TABLE manuscript_notes; DROP TABLE manuscript_revisions; ALTER TABLE document_sources DROP COLUMN editable; ALTER TABLE document_sources DROP COLUMN revision; DROP TABLE backup_schedule; DROP TABLE workspace_metadata; DROP TABLE document_sources; ALTER TABLE side_note_layouts DROP COLUMN connector_json; ALTER TABLE side_note_layouts DROP COLUMN minimized; DROP INDEX conversations_folder; ALTER TABLE conversations DROP COLUMN folder_id; ALTER TABLE conversations DROP COLUMN title_edited; DROP TABLE conversation_folders; PRAGMA user_version = 2;");
  original.sqlite.close();

  const migrated = openDatabase(filename);
  let folderId: string;
  try {
    store = new Store(migrated.db);
    expect(migrated.sqlite.pragma("user_version", { simple: true })).toBe(10);
    expect(store.detail(conversation.id)).toEqual(before);
    const folder = store.createFolder("学習"); folderId = folder.id;
    const other = store.createFolder("仕事");
    store.updateConversation(conversation.id, { title: "MCPのノート", folderId: folder.id });
    store.updateConversation(conversation.id, { folderId: other.id });
    store.updateConversation(conversation.id, { folderId: null });
    store.updateConversation(conversation.id, { folderId: folder.id });
    expect(() => store.updateConversation(conversation.id, { title: "反映しない", folderId: "missing" })).toThrow("フォルダが見つかりません");
    store.renameFolder(folder.id, "技術学習");
    expect(store.detail(conversation.id)).toMatchObject({ title: "MCPのノート", titleEdited: true, folderId: folder.id, messages: before.messages, notes: before.notes, providerSessionId: before.providerSessionId });
  } finally { migrated.sqlite.close(); }

  const reopened = openDatabase(filename);
  try {
    store = new Store(reopened.db);
    expect(store.folder(folderId!).name).toBe("技術学習");
    expect(store.conversation(conversation.id)).toMatchObject({ title: "MCPのノート", folderId: folderId! });
    store.deleteFolder(folderId!);
    expect(store.detail(conversation.id)).toMatchObject({ title: "MCPのノート", folderId: null, messages: before.messages, notes: before.notes, providerSessionId: before.providerSessionId });
    expect(store.listFolders().map((f) => f.name)).toEqual(["仕事"]);
  } finally { reopened.sqlite.close(); }
});

it("keeps an explicitly edited title through the first and subsequent generations", () => {
  const database = openDatabase(":memory:");
  try {
    const store = new Store(database.db);
    const c = store.createConversation("mock", "mock-demo");
    store.updateConversation(c.id, { title: "新しい会話" });
    const first = store.beginMain(c.id, "自動タイトルにはしない");
    expect(store.conversation(c.id).title).toBe("新しい会話");
    store.updateConversation(c.id, { title: "私の学習ノート" });
    store.finishMain(c.id, first.assistantMessage.id, "回答", "complete");
    store.beginMain(c.id, "続きの質問");
    expect(store.conversation(c.id)).toMatchObject({ title: "私の学習ノート", titleEdited: true });
  } finally { database.sqlite.close(); }
});
