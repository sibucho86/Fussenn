import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "@/server/db";
import { Store } from "@/server/services/store";
import { Manuscripts } from "@/server/services/manuscripts";
import { Backups } from "@/server/services/backups";
import { decodeBackup, digest } from "@/server/services/backup-format";
import { workspaceRevision } from "@/server/workspace-revision";
import { noteStream } from "@/server/services/generation";
import { MockProvider } from "@/server/providers/mock";

let dir: string, db: ReturnType<typeof openDatabase>, store: Store;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "fussenn-pdf-test-")); db = openDatabase(join(dir, "test.db")); store = new Store(db.db); });
afterEach(() => { db.sqlite.close(); rmSync(dir, { recursive: true, force: true }); });

it("migrates the v9 format constraint without changing existing documents, manuscripts, notes or versions", () => {
  const original = store.importDocument("資料.md", "元の資料。"), manuscripts = new Manuscripts(store);
  const manuscript = manuscripts.create("原稿", original.document!.messageId);
  const note = manuscripts.createNote(manuscript.id, 1, 0, 5, 100, 100);
  manuscripts.draft(note.id, "推敲案。", 0); manuscripts.apply(note.id, 1, 1, "replace");
  const before = store.detail(manuscript.id), history = manuscripts.history(manuscript.id);
  db.sqlite.exec(`CREATE TABLE document_sources_v9 (
    conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL, format TEXT NOT NULL CHECK(format IN ('markdown','text')),
    editable INTEGER NOT NULL DEFAULT 0 CHECK(editable IN (0,1)), revision INTEGER NOT NULL DEFAULT 0
  ); INSERT INTO document_sources_v9 SELECT * FROM document_sources;
  DROP TABLE document_sources; ALTER TABLE document_sources_v9 RENAME TO document_sources; PRAGMA user_version = 9;`);
  db.sqlite.close(); db = openDatabase(join(dir, "test.db")); store = new Store(db.db);
  expect(db.sqlite.pragma("user_version", { simple: true })).toBe(10);
  expect(store.detail(original.id)).toEqual(original); expect(store.detail(manuscript.id)).toEqual(before);
  expect(new Manuscripts(store).history(manuscript.id)).toEqual(history);
  expect(store.importDocument("新しい資料.pdf", "【PDF 1 / 1 ページ】\n抽出した本文。").document!.format).toBe("pdf");
  expect(db.sqlite.pragma("foreign_key_check")).toEqual([]);
});

it("preserves PDF pages and note context in v3 backups and accepts v2 backups", async () => {
  store.updateSettings({ defaultProvider: "openai", openaiModel: "test-model" });
  const old = store.importDocument("従来の資料.txt", "従来の本文。");
  const backups = new Backups(db.sqlite, dir);
  const legacy = JSON.parse(backups.export().toString()); legacy.version = 2; delete legacy.checksum; legacy.checksum = digest(JSON.stringify(legacy));
  const oldBytes = Buffer.from(JSON.stringify(legacy));
  expect(decodeBackup(oldBytes).version).toBe(2);
  const content = "【PDF 1 / 2 ページ】\n最初のページ。\n\n【PDF 2 / 2 ページ】\n疲労限度について。";
  const pdf = store.importDocument("設計資料.PDF", content);
  const start = content.indexOf("疲労限度");
  const note = store.createNote(pdf.id, pdf.document!.messageId, { selectedText: "疲労限度", anchorStart: start, anchorEnd: start + 4, anchorPrefix: "", anchorSuffix: "", anchorVersion: 1 }, { x: 10, y: 20 });
  const answer = await noteStream(store, note.id, "[context]", new MockProvider(0)).text();
  expect(answer).toContain("physical page numbers"); expect(answer).toContain("【PDF 2 / 2 ページ】");
  expect(store.note(note.id).contextSnapshot.source?.format).toBe("pdf");
  const bytes = backups.export(), file = decodeBackup(bytes); expect(file.version).toBe(3);
  store.deleteConversation(pdf.id);
  backups.restore(bytes, digest(bytes), workspaceRevision(db.sqlite));
  expect(decodeBackup(backups.export()).data).toEqual(file.data);
  backups.restore(oldBytes, digest(oldBytes), workspaceRevision(db.sqlite));
  expect(store.detail(old.id)).toEqual(old); expect(store.listConversations()).toHaveLength(1);
});
