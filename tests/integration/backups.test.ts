import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "@/server/db";
import { Store } from "@/server/services/store";
import { Backups, readBackupUpload } from "@/server/services/backups";
import { decodeBackup, digest, encodeBackup } from "@/server/services/backup-format";
import { workspaceRevision } from "@/server/workspace-revision";
import { MAX_BACKUP_BYTES } from "@/lib/backup";

let db: ReturnType<typeof openDatabase>, store: Store, backups: Backups, directory: string;
beforeEach(() => {
  db = openDatabase(":memory:"); store = new Store(db.db);
  directory = mkdtempSync(join(tmpdir(), "fussenn-backup-test-"));
  backups = new Backups(db.sqlite, directory);
});
afterEach(() => db.sqlite.close());
function seed() {
  store.updateSettings({ defaultProvider: "mock", codexDefaultModel: "saved-model", openaiModel: "api-model" });
  const folder = store.createFolder("資料と学び");
  const conversation = store.createConversation("mock", "mock-demo");
  const pair = store.beginMain(conversation.id, "質問");
  store.finishMain(conversation.id, pair.assistantMessage.id, "Resource は情報です。", "complete", "future-main-session");
  store.updateConversation(conversation.id, { title: "元の会話", folderId: folder.id });
  const anchor = { selectedText: "Resource", anchorStart: 0, anchorEnd: 8, anchorPrefix: "", anchorSuffix: " は情報です。", anchorVersion: 1 };
  const note = store.createNote(conversation.id, pair.assistantMessage.id, anchor, { x: 400, y: 100 });
  store.updateNote(note.id, { memo: "復元したいメモ", color: "blue" });
  store.updateLayout(note.id, { minimized: true, collapsed: true, width: 420, height: 260, connector: { source: { side: "top", ratio: 0.3, segment: 0 }, target: { side: "left", ratio: 0.4 }, bend: { x: 50, y: -25 } } });
  const side = store.beginNote(note.id, "詳しく説明");
  store.finishNote(note.id, side.assistantMessage.id, "付箋の回答", "error", "future-note-session");
  const document = store.importDocument("日本語の原文.md", "# 資料\n\n原文とメモ。\n");
  store.updateConversation(document.id, { folderId: folder.id });
  store.createNote(document.id, document.document!.messageId, { selectedText: "原文", anchorStart: 4, anchorEnd: 6, anchorPrefix: "資料\n", anchorSuffix: "とメモ。", anchorVersion: 1 }, { x: 100, y: 100 });
  return { conversation, document, note };
}
const data = () => decodeBackup(backups.export()).data;

it("round-trips all saved content, layouts, sources and settings, with a usable safety copy and new sessions", () => {
  const { conversation, document, note } = seed();
  const original = backups.export(), originalData = decodeBackup(original).data;
  expect(original.toString()).not.toContain("future-main-session");
  expect(original.toString()).not.toContain("future-note-session");
  expect(original.toString()).not.toContain("provider_session_id");
  const beforeRevision = workspaceRevision(db.sqlite);
  store.updateNote(note.id, { memo: "後から書いたメモ", color: "pink" });
  store.deleteConversation(document.id);
  store.createConversation("mock", "later-model");
  store.updateSettings({ openaiModel: "changed-model" });
  const later = data();
  const preview = backups.inspect(original);
  expect(preview.counts).toEqual({ conversations: 1, documents: 1, notes: 2, messages: 5, folders: 1 });
  expect(preview.currentCounts.documents).toBe(0);
  const restored = backups.restore(original, preview.digest, beforeRevision);
  expect(data()).toEqual(originalData);
  expect(workspaceRevision(db.sqlite)).not.toBe(beforeRevision);
  expect(store.conversation(conversation.id).providerSessionId).toBeNull();
  expect(store.note(note.id).providerSessionId).toBeNull();
  expect(store.note(note.id).layout).toMatchObject({ minimized: true, collapsed: true, width: 420, connector: { bend: { x: 50, y: -25 } } });
  expect(store.detail(document.id).document?.fileName).toBe("日本語の原文.md");
  expect(store.settings().openaiModel).toBe("api-model");
  const automatic = backups.read(restored.automaticBackup.name);
  expect(decodeBackup(automatic).data).toEqual(later);
  expect(backups.list()).toHaveLength(1);
  backups.restore(automatic, digest(automatic), workspaceRevision(db.sqlite));
  expect(data()).toEqual(later);
  expect(backups.list()).toHaveLength(2);
});

it("rejects corrupt, incompatible and inconsistent files before changing data or writing a safety copy", () => {
  seed();
  const valid = backups.export(), original = data(), revision = workspaceRevision(db.sqlite);
  const invalid = [Buffer.from("# markdown"), valid.subarray(0, valid.length - 8), Buffer.from(valid.toString().replace('"version":3', '"version":99')), Buffer.from(valid.toString().replace("復元したいメモ", "改ざん")), db.sqlite.serialize()];
  const duplicate = structuredClone(original); duplicate.conversations.push(duplicate.conversations[0]); invalid.push(encodeBackup(duplicate));
  const orphan = structuredClone(original); orphan.conversations = []; invalid.push(encodeBackup(orphan));
  const context = structuredClone(original); context.side_notes[0].context_snapshot_json = "{}"; invalid.push(encodeBackup(context));
  const badColor = JSON.parse(valid.toString()); badColor.data.side_notes[0].color = "invalid"; invalid.push(Buffer.from(JSON.stringify(badColor)));
  for (const file of invalid) {
    expect(() => backups.inspect(file)).toThrow("読み込めません");
    expect(() => backups.restore(file, digest(file), revision)).toThrow("読み込めません");
  }
  expect(data()).toEqual(original); expect(workspaceRevision(db.sqlite)).toBe(revision); expect(backups.list()).toEqual([]);
});

it("leaves the current database untouched when the automatic backup cannot be written", () => {
  seed(); const bytes = backups.export();
  store.createFolder("今の状態");
  const before = data(), revision = workspaceRevision(db.sqlite);
  writeFileSync(backups.directory, "a file blocks the backup directory");
  expect(() => backups.restore(bytes, digest(bytes), revision)).toThrow("自動退避できません");
  expect(data()).toEqual(before); expect(workspaceRevision(db.sqlite)).toBe(revision);
});

it("rolls back every row and the revision if insertion fails after the safety copy", () => {
  const { conversation } = seed();
  store.updateConversation(conversation.id, { title: "fail-insert" });
  const bytes = backups.export();
  store.updateConversation(conversation.id, { title: "現在の会話" });
  const before = data(), revision = workspaceRevision(db.sqlite);
  db.sqlite.exec("CREATE TEMP TRIGGER fail_restore BEFORE INSERT ON conversations WHEN NEW.title = 'fail-insert' BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  expect(() => backups.restore(bytes, digest(bytes), revision)).toThrow("元のデータを保持");
  expect(data()).toEqual(before); expect(workspaceRevision(db.sqlite)).toBe(revision);
  expect(backups.list()).toHaveLength(1);
  expect(decodeBackup(backups.read(backups.list()[0].name)).data).toEqual(before);
});

it("blocks active generation and stale restoration requests and validates automatic file names", () => {
  const { conversation } = seed();
  const bytes = backups.export(), revision = workspaceRevision(db.sqlite);
  const active = new Backups(db.sqlite, directory, () => true);
  expect(() => active.export()).toThrow("AIの回答");
  expect(() => active.restore(bytes, digest(bytes), revision)).toThrow("AIの回答");
  const pair = store.beginMain(conversation.id, "生成中");
  expect(() => backups.export()).toThrow("AIの回答");
  store.finishMain(conversation.id, pair.assistantMessage.id, "途中", "error");
  expect(() => backups.restore(bytes, "wrong-digest", revision)).toThrow("内容が変わっています");
  expect(() => backups.restore(bytes, digest(bytes), "old-revision")).toThrow("再読み込み");
  expect(backups.list()).toEqual([]);
  for (const name of ["../fussenn.db", "../sidenote.db", "..\\config.toml", "unrelated.json"]) expect(() => backups.read(name)).toThrow("見つかりません");
});

it("bounds streamed uploads without buffering oversized files", async () => {
  let cancelled = false;
  const chunk = new Uint8Array(1024 * 1024);
  const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(chunk); }, cancel() { cancelled = true; } });
  await expect(readBackupUpload(new Request("http://localhost/api/backups/inspect", { method: "POST", body, duplex: "half" } as RequestInit))).rejects.toThrow("64MB");
  expect(cancelled).toBe(true);
  await expect(readBackupUpload(new Request("http://localhost/api/backups/inspect", { method: "POST", headers: { "Content-Length": String(MAX_BACKUP_BYTES + 1) }, body: "x" }))).rejects.toThrow("64MB");
});

it("migrates a v6 database without changing its saved data and persists the restoration revision on reopening", () => {
  const path = join(directory, "migration.db");
  const old = openDatabase(path); const priorStore = new Store(old.db);
  const conversation = priorStore.createConversation("mock", "demo");
  old.sqlite.exec("DROP TABLE manuscript_notes; DROP TABLE manuscript_revisions; ALTER TABLE document_sources DROP COLUMN editable; ALTER TABLE document_sources DROP COLUMN revision; DROP TABLE backup_schedule; DROP TABLE workspace_metadata; PRAGMA user_version = 6;"); old.sqlite.close();
  const upgraded = openDatabase(path);
  try {
    expect(upgraded.sqlite.pragma("user_version", { simple: true })).toBe(10);
    expect(new Store(upgraded.db).detail(conversation.id)).toEqual(conversation);
    const service = new Backups(upgraded.sqlite, directory);
    const bytes = service.export(); service.restore(bytes, digest(bytes), workspaceRevision(upgraded.sqlite));
    const revision = workspaceRevision(upgraded.sqlite);
    upgraded.sqlite.close();
    const reopened = openDatabase(path);
    try { expect(workspaceRevision(reopened.sqlite)).toBe(revision); expect(new Store(reopened.db).detail(conversation.id)).toEqual(conversation); }
    finally { reopened.sqlite.close(); }
  } finally { if (upgraded.sqlite.open) upgraded.sqlite.close(); }
  expect(readFileSync(path).length).toBeGreaterThan(0);
});

// A backup file as SideNote AI wrote it before the rename.
function previousFormat(bytes: Uint8Array) {
  const file = JSON.parse(Buffer.from(bytes).toString("utf8"));
  const body = { format: "sidenote-backup", version: file.version, createdAt: file.createdAt, data: file.data };
  return Buffer.from(JSON.stringify({ ...body, checksum: digest(JSON.stringify(body)) }));
}

it("restores a backup file made before the rename from SideNote AI", () => {
  seed();
  const previous = previousFormat(backups.export()), saved = decodeBackup(previous).data;
  expect(decodeBackup(previous).format).toBe("sidenote-backup");
  store.createConversation("mock", "later-model");
  backups.restore(previous, digest(previous), workspaceRevision(db.sqlite));
  expect(data()).toEqual(saved);
  expect(JSON.parse(backups.export().toString()).format).toBe("fussenn-backup");
});
