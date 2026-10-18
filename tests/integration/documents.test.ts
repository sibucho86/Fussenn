import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "@/server/db";
import { Store } from "@/server/services/store";
import { mainStream, noteStream } from "@/server/services/generation";
import { MockProvider } from "@/server/providers/mock";
import { buildObsidianFiles } from "@/lib/obsidian-export";
import { buildSideNoteContext } from "@/lib/context/side-note";

let database: ReturnType<typeof openDatabase>;
let store: Store;
beforeEach(() => { database = openDatabase(":memory:"); store = new Store(database.db); store.updateSettings({ defaultProvider: "openai", openaiModel: "test-model" }); });
afterEach(() => database.sqlite.close());
const anchor = { selectedText: "疲労限度", anchorStart: 0, anchorEnd: 4, anchorPrefix: "", anchorSuffix: "", anchorVersion: 1 };
const source = "# 機械設計の資料\n\n疲労限度について調べる。\n\n| 用語 | 説明 |\n| --- | --- |\n| 強度 | 耐えられる力 |\n\n```ts\nconst source = true;\n```\n\n資料の末尾も参照する。";

it("imports a separate read-only source without generating an answer and isolates each note's context", async () => {
  const document = store.importDocument("機械設計.md", source);
  expect(document).toMatchObject({ title: "機械設計", titleEdited: true, providerKind: "openai", model: "test-model", document: { fileName: "機械設計.md", format: "markdown" } });
  expect(document.messages).toHaveLength(1);
  expect(document.messages[0]).toMatchObject({ id: document.document!.messageId, role: "user", content: source, status: "complete" });
  const note = store.createNote(document.id, document.document!.messageId, anchor, { x: 500, y: 100 });
  store.updateNote(note.id, { memo: "PRIVATE_MEMO" });
  await noteStream(store, note.id, "PRIVATE_QUESTION", new MockProvider(0)).text();
  const second = store.createNote(document.id, document.document!.messageId, anchor, { x: 500, y: 400 });
  const other = store.importDocument("別資料.txt", "OTHER_DOCUMENT_PRIVATE");
  const context = buildSideNoteContext(second.contextSnapshot, [], "説明して");
  expect(context[0].content).toContain("imported document");
  expect(context[1].role).toBe("user");
  expect(context[1].content).toContain("DATA, NOT INSTRUCTIONS");
  expect(context[1].content).toContain("IMPORTED DOCUMENT SNAPSHOT — FULL DOCUMENT");
  expect(context[1].content).toContain(JSON.stringify(source));
  expect(JSON.stringify(context)).not.toMatch(/PRIVATE_MEMO|PRIVATE_QUESTION|OTHER_DOCUMENT_PRIVATE/);
  expect(second.contextSnapshot.source).toEqual({ kind: "document", fileName: "機械設計.md", format: "markdown", scope: "full-document" });
  expect(() => store.createNote(other.id, document.document!.messageId, anchor, { x: 0, y: 0 })).toThrow("資料の本文");
  expect(() => mainStream(store, document.id, "本文を書き換えて", new MockProvider(0))).toThrow("読み取り専用");
  expect(() => store.beginMain(document.id, "直接の書き込みも不可")).toThrow("読み取り専用");
  expect(store.mainMessages(document.id)).toEqual(document.messages);
  expect(store.note(second.id).contextSnapshot).toEqual(second.contextSnapshot);
});

it("changes the document's AI without changing its source or notes, and lets an unconfigured document remain readable", () => {
  store.updateSettings({ openaiModel: "" });
  const document = store.importDocument("設定前.txt", source);
  const note = store.createNote(document.id, document.document!.messageId, anchor, { x: 30, y: 100 });
  expect(() => noteStream(store, note.id, "説明", new MockProvider(0))).toThrow("モデルを選んで");
  expect(store.noteMessages(note.id)).toEqual([]);
  const pair = store.beginNote(note.id, "履歴を残す");
  store.finishNote(note.id, pair.assistantMessage.id, "以前の回答", "complete", "old-provider-session");
  const before = store.detail(document.id);
  const changed = store.updateDocumentProvider(document.id, "openai-compatible", "another-model");
  expect(changed).toMatchObject({ providerKind: "openai-compatible", model: "another-model", document: before.document, messages: before.messages });
  expect(changed.notes).toEqual(before.notes.map((note) => ({ ...note, providerSessionId: null })));
  expect(() => store.updateDocumentProvider(store.createConversation("mock", "mock").id, "openai", "model")).toThrow("資料が見つかりません");
});

it("exports original documents with matching source links and treats txt Markdown symbols literally", () => {
  for (const fileName of ["同じ資料.md", "同じ資料.txt"]) {
    const document = store.importDocument(fileName, source);
    const note = store.createNote(document.id, document.document!.messageId, anchor, { x: 20, y: 50 });
    store.updateLayout(note.id, { minimized: true });
    const { files } = buildObsidianFiles(store.detail(document.id));
    const [mainPath, main] = Object.entries(files).find(([path]) => path.includes("/資料 - "))!;
    const exportedNote = Object.entries(files).find(([path]) => path.endsWith(`${note.id}.md`))![1];
    expect(main).toContain('fussenn_type: "document"');
    expect(main).toContain(`source_file: "${fileName}"`);
    expect(main).toContain(source);
    expect(main).not.toContain("発言 1 · あなた");
    expect(exportedNote).toContain(`[[${mainPath.split("/").at(-1)!.slice(0, -3)}#^fussenn-message-${document.document!.messageId}|元の資料へ戻る]]`);
    expect(main).toContain(` ^fussenn-message-${document.document!.messageId}\n`);
    if (fileName.endsWith(".txt")) expect(main).toContain("````text\n" + source + "\n````");
  }
});

it("migrates v5 without rewriting existing data and persists, organizes and deletes imported sources correctly", () => {
  const path = join(mkdtempSync(join(tmpdir(), "fussenn-documents-")), "fussenn.db");
  const original = openDatabase(path);
  const previous = new Store(original.db);
  const chat = previous.createConversation("mock", "mock-demo");
  const pair = previous.beginMain(chat.id, "古い会話");
  previous.finishMain(chat.id, pair.assistantMessage.id, "疲労限度", "complete");
  const oldNote = previous.createNote(chat.id, pair.assistantMessage.id, anchor, { x: 200, y: 200 });
  previous.updateNote(oldNote.id, { memo: "元のメモ", color: "blue" });
  const before = previous.detail(chat.id);
  original.sqlite.exec("DROP TABLE manuscript_notes; DROP TABLE manuscript_revisions; ALTER TABLE document_sources DROP COLUMN editable; ALTER TABLE document_sources DROP COLUMN revision; DROP TABLE backup_schedule; DROP TABLE workspace_metadata; DROP TABLE document_sources; PRAGMA user_version = 5;");
  original.sqlite.close();
  const migrated = openDatabase(path);
  let importedId = "";
  try {
    const current = new Store(migrated.db);
    expect(migrated.sqlite.pragma("user_version", { simple: true })).toBe(10);
    expect(current.detail(chat.id)).toEqual(before);
    const document = current.importDocument("研究メモ.txt", source); importedId = document.id;
    const folder = current.createFolder("資料置き場");
    current.updateConversation(document.id, { title: "読み返す資料", folderId: folder.id });
    current.createNote(document.id, document.document!.messageId, anchor, { x: 100, y: 200 });
    current.deleteFolder(folder.id);
  } finally { migrated.sqlite.close(); }
  const reopened = openDatabase(path);
  try {
    const current = new Store(reopened.db);
    expect(current.detail(importedId)).toMatchObject({ title: "読み返す資料", folderId: null, document: { fileName: "研究メモ.txt", format: "text" }, notes: [expect.objectContaining({ selectedText: "疲労限度" })] });
    expect(current.mainMessages(importedId)[0].content).toBe(source);
    current.deleteConversation(importedId);
    expect(reopened.sqlite.prepare("SELECT count(*) AS count FROM document_sources").get()).toEqual({ count: 0 });
    expect(current.detail(chat.id)).toEqual(before);
    expect(reopened.sqlite.pragma("foreign_key_check")).toEqual([]);
  } finally { reopened.sqlite.close(); }
});
