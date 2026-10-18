import { expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "@/server/db";
import { Store } from "@/server/services/store";

it("adds marker minimization to v3 without hiding existing notes and preserves their layout and content", () => {
  const filename = join(mkdtempSync(join(tmpdir(), "fussenn-minimize-")), "fussenn.db");
  const original = openDatabase(filename);
  let store = new Store(original.db);
  const conversation = store.createConversation("mock", "mock-demo");
  const pair = store.beginMain(conversation.id, "MCP");
  store.finishMain(conversation.id, pair.assistantMessage.id, "Resource", "complete");
  const note = store.createNote(conversation.id, pair.assistantMessage.id, { selectedText: "Resource", anchorStart: 0, anchorEnd: 8, anchorPrefix: "", anchorSuffix: "", anchorVersion: 1 }, { x: 420, y: 270 });
  store.updateNote(note.id, { memo: "しまっても残す", color: "pink" });
  store.updateLayout(note.id, { width: 400, height: 380, collapsed: true });
  const before = store.detail(conversation.id);
  original.sqlite.exec("DROP TABLE manuscript_notes; DROP TABLE manuscript_revisions; ALTER TABLE document_sources DROP COLUMN editable; ALTER TABLE document_sources DROP COLUMN revision; DROP TABLE backup_schedule; DROP TABLE workspace_metadata; DROP TABLE document_sources; ALTER TABLE side_note_layouts DROP COLUMN connector_json; ALTER TABLE side_note_layouts DROP COLUMN minimized; PRAGMA user_version = 3;");
  original.sqlite.close();
  const migrated = openDatabase(filename);
  try {
    store = new Store(migrated.db);
    expect(migrated.sqlite.pragma("user_version", { simple: true })).toBe(10);
    expect(store.detail(conversation.id)).toEqual(before);
    store.updateLayout(note.id, { minimized: true });
  } finally { migrated.sqlite.close(); }
  const reopened = openDatabase(filename);
  try {
    store = new Store(reopened.db);
    expect(store.note(note.id)).toMatchObject({ memo: "しまっても残す", color: "pink", contextSnapshot: note.contextSnapshot, layout: { minimized: true, collapsed: true, x: 420, y: 270, width: 400, height: 380 } });
    store.updateLayout(note.id, { minimized: false, collapsed: false });
    expect(store.note(note.id).layout).toMatchObject({ minimized: false, collapsed: false, x: 420, y: 270, width: 400, height: 380 });
  } finally { reopened.sqlite.close(); }
});
