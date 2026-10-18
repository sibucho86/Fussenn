import { expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "@/server/db";
import { Store } from "@/server/services/store";

it("upgrades existing notes without changing content and retains their colors on subsequent opens", () => {
  const filename = join(mkdtempSync(join(tmpdir(), "fussenn-color-migration-")), "fussenn.db");
  const original = openDatabase(filename);
  let store = new Store(original.db);
  const conversation = store.createConversation("mock", "mock-demo");
  const pair = store.beginMain(conversation.id, "MCP");
  store.finishMain(conversation.id, pair.assistantMessage.id, "Resource は情報です。", "complete");
  const note = store.createNote(conversation.id, pair.assistantMessage.id, { selectedText: "Resource", anchorStart: 0, anchorEnd: 8, anchorPrefix: "", anchorSuffix: " は情報です。", anchorVersion: 1 }, { x: 300, y: 90 });
  store.updateNote(note.id, { memo: "残しておきたいメモ" });
  store.updateLayout(note.id, { width: 400, collapsed: true });
  const before = store.detail(conversation.id);
  // Recreate the on-disk v1 schema with an actual conversation, memo, snapshot and layout.
  original.sqlite.exec("DROP TABLE manuscript_notes; DROP TABLE manuscript_revisions; ALTER TABLE document_sources DROP COLUMN editable; ALTER TABLE document_sources DROP COLUMN revision; DROP TABLE backup_schedule; DROP TABLE workspace_metadata; DROP TABLE document_sources; ALTER TABLE side_note_layouts DROP COLUMN connector_json; ALTER TABLE side_note_layouts DROP COLUMN minimized; DROP INDEX conversations_folder; ALTER TABLE conversations DROP COLUMN folder_id; ALTER TABLE conversations DROP COLUMN title_edited; DROP TABLE conversation_folders; ALTER TABLE side_notes DROP COLUMN color; PRAGMA user_version = 1;");
  original.sqlite.close();

  const migrated = openDatabase(filename);
  try {
    store = new Store(migrated.db);
    expect(migrated.sqlite.pragma("user_version", { simple: true })).toBe(10);
    expect(store.detail(conversation.id)).toEqual(before);
    expect(store.note(note.id).color).toBe("yellow");
    store.updateNote(note.id, { color: "blue" });
    expect(store.note(note.id).contextSnapshot).toEqual(note.contextSnapshot);
  } finally { migrated.sqlite.close(); }

  const reopened = openDatabase(filename);
  try {
    const restored = new Store(reopened.db).note(note.id);
    expect(restored).toMatchObject({ color: "blue", memo: "残しておきたいメモ", layout: { x: 300, y: 90, width: 400, collapsed: true } });
  } finally { reopened.sqlite.close(); }
});
