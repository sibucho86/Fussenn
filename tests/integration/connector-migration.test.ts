import { expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "@/server/db";
import { Store } from "@/server/services/store";
import type { ConnectorAdjustment } from "@/lib/connector-types";

it("upgrades v4 without changing notes, persists curve adjustments and resets them independently of content", () => {
  const filename = join(mkdtempSync(join(tmpdir(), "fussenn-connector-")), "fussenn.db");
  const original = openDatabase(filename);
  let store = new Store(original.db);
  const conversation = store.createConversation("mock", "mock-demo");
  const pair = store.beginMain(conversation.id, "MCP");
  store.finishMain(conversation.id, pair.assistantMessage.id, "Resource", "complete");
  const note = store.createNote(conversation.id, pair.assistantMessage.id, { selectedText: "Resource", anchorStart: 0, anchorEnd: 8, anchorPrefix: "", anchorSuffix: "", anchorVersion: 1 }, { x: 700, y: 120 });
  store.updateNote(note.id, { memo: "接続点のメモ", color: "blue" });
  store.updateLayout(note.id, { width: 400, height: 350, collapsed: true });
  const before = store.detail(conversation.id);
  original.sqlite.exec("DROP TABLE manuscript_notes; DROP TABLE manuscript_revisions; ALTER TABLE document_sources DROP COLUMN editable; ALTER TABLE document_sources DROP COLUMN revision; DROP TABLE backup_schedule; DROP TABLE workspace_metadata; DROP TABLE document_sources; ALTER TABLE side_note_layouts DROP COLUMN connector_json; PRAGMA user_version = 4;");
  original.sqlite.close();
  const adjustment: ConnectorAdjustment = { source: { side: "top", ratio: 0.3, segment: 0 }, target: { side: "left", ratio: 0.7 }, bend: { x: 45, y: -80 } };
  const migrated = openDatabase(filename);
  try {
    store = new Store(migrated.db);
    expect(migrated.sqlite.pragma("user_version", { simple: true })).toBe(10);
    expect(store.detail(conversation.id)).toEqual(before);
    expect(store.note(note.id).layout.connector).toBeNull();
    store.updateLayout(note.id, { connector: adjustment });
    store.updateLayout(note.id, { x: 720 });
  } finally { migrated.sqlite.close(); }
  const reopened = openDatabase(filename);
  try {
    store = new Store(reopened.db);
    expect(store.note(note.id)).toMatchObject({ memo: "接続点のメモ", color: "blue", contextSnapshot: note.contextSnapshot, layout: { x: 720, y: 120, width: 400, height: 350, collapsed: true, connector: adjustment } });
    store.updateLayout(note.id, { connector: null, x: 700 });
    const restored = store.detail(conversation.id);
    expect(restored.messages).toEqual(before.messages);
    const withoutUpdateTime = (value: unknown) => JSON.parse(JSON.stringify(value, (key, field) => key === "updatedAt" ? undefined : field));
    expect(withoutUpdateTime(restored.notes[0])).toEqual(withoutUpdateTime(before.notes[0]));
  } finally { reopened.sqlite.close(); }
});
