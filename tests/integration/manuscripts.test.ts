import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "@/server/db";
import { Store } from "@/server/services/store";
import { Manuscripts } from "@/server/services/manuscripts";
import { Backups } from "@/server/services/backups";
import { decodeBackup, digest, encodeBackup } from "@/server/services/backup-format";
import { workspaceRevision } from "@/server/workspace-revision";
import { noteStream } from "@/server/services/generation";
import { MockProvider } from "@/server/providers/mock";
import { manuscriptEdits, moveAttachment } from "@/lib/manuscript";

let db: ReturnType<typeof openDatabase>, store: Store, service: Manuscripts, dir: string;
beforeEach(() => { db = openDatabase(":memory:"); store = new Store(db.db); store.updateSettings({ defaultProvider: "openai", openaiModel: "test-model" }); service = new Manuscripts(store); dir = mkdtempSync(join(tmpdir(), "fussenn-manuscript-test-")); });
afterEach(() => { db.sqlite.close(); rmSync(dir, { recursive: true, force: true }); });
function seed(content = "冒頭。猫は眠る。末尾。") { const row = service.create("第一章"); return service.save(row.id, content, 1); }
const addNote = (id: string, revision = 2, from = 3, to = 8) => service.createNote(id, revision, from, to, 520, 100);

it("imports files directly as editable manuscripts with original history, note context and portable backup", () => {
  for (const fileName of ["第一章.md", "第一章.markdown", "第一章.txt"]) {
    const file = { fileName, content: "猫は眠る。\r\n\r\n窓の外は雨だった。" };
    const row = service.create("書きかけの章", undefined, file);
    const original = file.content.replaceAll("\r\n", "\n");
    expect(row.document).toMatchObject({ editable: true, fileName, format: "markdown", revision: 1 });
    expect(row.messages).toHaveLength(1); expect(row.messages[0].content).toBe(original);
    const note = addNote(row.id, 1, 0, 5);
    expect(note.contextSnapshot.messages[0].content).toBe(original);
    service.draft(note.id, "猫は目を覚ます。", 0);
    service.apply(note.id, 1, 1, "replace");
    const initial = service.history(row.id).find((v) => v.revision === 1)!;
    expect(initial.label).toBe("ファイルから取り込み");
    expect(service.restore(row.id, initial.id, 2).messages[0].content).toBe(original);
    expect(file.content).toContain("\r\n");
  }
  expect(store.listConversations()).toHaveLength(3);
  const backups = new Backups(db.sqlite, dir), bytes = backups.export(), data = decodeBackup(bytes).data;
  backups.restore(bytes, digest(bytes), workspaceRevision(db.sqlite));
  expect(decodeBackup(backups.export()).data).toEqual(data);
});

it("rejects invalid manuscript files before creating any document or history", () => {
  for (const file of [{ fileName: "draft.pdf", content: "本文" }, { fileName: "../draft.md", content: "本文" }, { fileName: "empty.txt", content: " \n" }, { fileName: "binary.md", content: "\u0000data" }, { fileName: "long.txt", content: "a".repeat(100001) }]) {
    expect(() => service.create("取り込み", undefined, file)).toThrow();
  }
  expect(() => service.create("重複", "source", { fileName: "draft.md", content: "本文" })).toThrow("一つ");
  expect(store.listConversations()).toHaveLength(0);
  expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM manuscript_revisions").get()).toEqual({ count: 0 });
});

it("copies imported material and AI answers into separate manuscripts and preserves the original source", () => {
  const original = store.importDocument("原資料.md", "# はじめに\r\n\r\n原文。");
  const manuscript = service.create("編集する章", original.messages[0].id);
  expect(manuscript.messages[0].content).toBe("# はじめに\n\n原文。");
  service.save(manuscript.id, "推敲した原稿。", 1);
  expect(store.detail(original.id)).toEqual(original);
  expect(manuscript.document).toMatchObject({ editable: true, revision: 1 });
  const chat = store.createConversation("mock", "mock-demo"), pair = store.beginMain(chat.id, "本文を生成");
  store.finishMain(chat.id, pair.assistantMessage.id, "生成した本文", "complete");
  expect(service.create("AIからの原稿", pair.assistantMessage.id).messages[0].content).toBe("生成した本文");
});

it("new notes receive the revised full text; existing notes keep their context until explicit refresh", async () => {
  const row = seed(), old = addNote(row.id);
  await noteStream(store, old.id, "OLD_PRIVATE_QUESTION", new MockProvider(0)).text();
  const changed = service.save(row.id, "新しい導入。" + row.messages[0].content, 2);
  const newest = addNote(row.id, 3, 9, 14);
  expect(newest.contextSnapshot.messages[0].content).toBe(changed.messages[0].content);
  expect(newest.contextSnapshot.source?.manuscriptRevision).toBe(3);
  expect(store.note(old.id).contextSnapshot).toEqual(old.contextSnapshot);
  const refreshed = service.refreshContext(old.id, 3);
  expect(refreshed.messages).toHaveLength(2);
  expect(refreshed.manuscript!.contextHistory[0].snapshot).toEqual(old.contextSnapshot);
  expect(refreshed.providerSessionId).toBeNull();
  const answer = await noteStream(store, old.id, "[context]", new MockProvider(0)).text();
  expect(answer).toContain("新しい導入"); expect(answer).not.toContain("OLD_PRIVATE_QUESTION");
});

it("applies a candidate exactly once, saves surrounding anchors and restores a previous version without deleting discussion", () => {
  const row = seed(), note = addNote(row.id), untouched = addNote(row.id, 2, 8, 11);
  service.draft(note.id, "猫は窓辺で眠っている。", 0);
  const applied = service.apply(note.id, 2, 1, "replace");
  expect(applied.messages[0].content).toBe("冒頭。猫は窓辺で眠っている。末尾。");
  expect(applied.notes[0].manuscript?.appliedRevision).toBe(3);
  expect(applied.notes[0].layout.minimized).toBe(false);
  expect(() => service.draft(note.id, "後から上書き", 1)).toThrow("続けて推敲する");
  expect(store.note(untouched.id).manuscript?.from).toBe(14);
  expect(() => service.apply(note.id, 3, 1, "replace")).toThrow("状態が変わりました");
  const previous = service.history(row.id).find((v) => v.revision === 2)!;
  const restored = service.restore(row.id, previous.id, 3);
  expect(restored.messages[0].content).toBe(row.messages[0].content);
  expect(restored.notes[0].manuscript).toMatchObject({ from: 3, to: 8, appliedRevision: null, draft: "猫は窓辺で眠っている。" });
  const postApply = service.history(row.id).find((v) => v.revision === 3)!;
  expect(service.restore(row.id, postApply.id, 4).messages[0].content).toBe(applied.messages[0].content);
});

it("inserts before, after and at an empty cursor without dropping source text", () => {
  for (const mode of ["before", "after", "replace"] as const) {
    const row = seed("abc"), note = addNote(row.id, 2, 1, mode === "replace" ? 1 : 2);
    service.draft(note.id, "\r\n追加", 0);
    expect(service.apply(note.id, 2, 1, mode).messages[0].content).toBe(mode === "after" ? "ab\n追加c" : "a\n追加bc");
  }
  const empty = service.create("空から始める"), point = addNote(empty.id, 1, 0, 0);
  service.draft(point.id, "第一文。", 0);
  expect(service.apply(point.id, 1, 1, "replace").messages[0].content).toBe("第一文。");
});

it("invalidates intersecting notes, retains unaffected repeated passages and rejects stale writes and candidates", () => {
  const row = seed("猫は眠る。猫は眠る。"), first = addNote(row.id, 2, 0, 5), second = addNote(row.id, 2, 5, 10);
  service.draft(first.id, "猫は走る。", 0);
  service.save(row.id, "猫は起きる。猫は眠る。", 2);
  expect(store.note(first.id).manuscript?.from).toBeNull();
  expect(store.note(second.id).manuscript?.from).toBe(6);
  expect(() => service.apply(first.id, 3, 1, "replace")).toThrow("対象の文章");
  expect(() => service.save(row.id, "古い画面", 2)).toThrow("別の画面");
  expect(() => service.createNote(row.id, 2, 0, 2, 0, 0)).toThrow("別の画面");
  expect(() => service.draft(first.id, "古い案", 0)).toThrow("別の画面");
  expect(service.history(row.id)).toHaveLength(3);
});

it("rolls back text, attachments and revision together when recording history fails", () => {
  const row = seed(), note = addNote(row.id); service.draft(note.id, "変更案", 0);
  const before = store.detail(row.id);
  db.sqlite.exec("CREATE TRIGGER fail_history BEFORE INSERT ON manuscript_revisions BEGIN SELECT RAISE(ABORT, 'disk failure'); END");
  expect(() => service.apply(note.id, 2, 1, "replace")).toThrow("disk failure");
  expect(store.detail(row.id)).toEqual(before);
});

it("includes manuscripts, candidates, historical contexts and versions in portable backups and accepts old v1 backups", () => {
  const row = seed(), note = addNote(row.id); service.draft(note.id, "新しい猫。", 0);
  service.apply(note.id, 2, 1, "replace"); service.refreshContext(note.id, 3);
  const backups = new Backups(db.sqlite, dir), bytes = backups.export(), data = decodeBackup(bytes).data;
  expect(data.manuscript_revisions).toHaveLength(3);
  store.deleteConversation(row.id);
  backups.restore(bytes, digest(bytes), workspaceRevision(db.sqlite));
  expect(decodeBackup(backups.export()).data).toEqual(data);
  const broken = structuredClone(data); broken.manuscript_notes[0].start_offset = 99_999;
  expect(() => decodeBackup(encodeBackup(broken))).toThrow("読み込めません");
  store.deleteConversation(row.id);
  const legacy = JSON.parse(backups.export().toString()); legacy.version = 1;
  delete legacy.data.manuscript_notes; delete legacy.data.manuscript_revisions;
  for (const source of legacy.data.document_sources) { delete source.editable; delete source.revision; }
  delete legacy.checksum; legacy.checksum = digest(JSON.stringify(legacy));
  expect(decodeBackup(Buffer.from(JSON.stringify(legacy))).data.manuscript_revisions).toEqual([]);
});

it("tracks multiple disjoint edits and UTF-16 emoji offsets conservatively", () => {
  const before = "AA📝 KEEP BB", after = "新AA📝 KEEP BB終";
  const start = before.indexOf("KEEP");
  expect(moveAttachment({ from: start, to: start + 4 }, manuscriptEdits(before, after))).toEqual({ from: start + 1, to: start + 5 });
});

it("revises the same note repeatedly against its applied passage, refreshes AI context and preserves versions and backups", async () => {
  for (const mode of ["replace", "before", "after"] as const) {
    const row = seed(), note = addNote(row.id);
    await noteStream(store, note.id, "OLD_PRIVATE_QUESTION", new MockProvider(0)).text();
    service.draft(note.id, "猫は窓辺で眠る。", 0);
    const applied = service.apply(note.id, 2, 1, mode);
    const resumed = service.revise(note.id, 3, 1);
    expect(resumed.manuscript).toMatchObject({ draft: "猫は窓辺で眠る。", originalText: "猫は窓辺で眠る。", draftRevision: 2, baseRevision: 3, contextRevision: 3, appliedRevision: null, historyFrom: 2 });
    expect(resumed.selectedText).toBe("猫は窓辺で眠る。");
    expect(resumed.contextSnapshot.messages[0].content).toBe(applied.messages[0].content);
    expect(resumed.manuscript!.contextHistory[0].snapshot).toEqual(note.contextSnapshot);
    expect(resumed.messages).toHaveLength(2);
    expect(resumed.providerSessionId).toBeNull();
    const answer = await noteStream(store, note.id, "[context]", new MockProvider(0)).text();
    expect(answer).toContain("猫は窓辺で眠る。"); expect(answer).not.toContain("OLD_PRIVATE_QUESTION");
    expect(() => service.draft(note.id, "古い画面の案", 1)).toThrow("別の画面");
    service.draft(note.id, "猫は窓辺で目を覚ます。", 2);
    const twice = service.apply(note.id, 3, 3, "replace");
    expect(twice.messages[0].content).toBe(applied.messages[0].content.replace("猫は窓辺で眠る。", "猫は窓辺で目を覚ます。"));
    expect(twice.notes).toHaveLength(1);
    expect(() => service.apply(note.id, 4, 3, "replace")).toThrow("状態が変わりました");
    service.revise(note.id, 4, 3);
    service.draft(note.id, "猫は外へ歩き出す。", 4);
    service.apply(note.id, 4, 5, "replace");
    const previous = service.history(row.id).find((v) => v.revision === 3)!;
    expect(service.restore(row.id, previous.id, 5).messages[0].content).toBe(applied.messages[0].content);
    expect(service.revise(note.id, 6, 5).manuscript?.draft).toBe("猫は窓辺で眠る。");
  }
  const backups = new Backups(db.sqlite, dir), bytes = backups.export();
  const data = decodeBackup(bytes).data;
  backups.restore(bytes, digest(bytes), workspaceRevision(db.sqlite));
  expect(decodeBackup(backups.export()).data).toEqual(data);
});

it("rejects stale, duplicate, streaming or orphaned revision restarts without changing the saved note", () => {
  const row = seed(), note = addNote(row.id);
  expect(() => service.revise(note.id, 2, 0)).toThrow("状態が変わりました");
  service.draft(note.id, "猫は起きる。", 0); service.apply(note.id, 2, 1, "replace");
  const before = store.note(note.id);
  expect(() => service.revise(note.id, 2, 1)).toThrow("別の画面");
  expect(() => service.revise(note.id, 3, 0)).toThrow("状態が変わりました");
  expect(store.note(note.id)).toEqual(before);
  const pair = store.beginNote(note.id, "生成中");
  const streaming = store.note(note.id);
  expect(() => service.revise(note.id, 3, 1)).toThrow("回答が終わってから");
  expect(store.note(note.id)).toEqual(streaming);
  store.finishNote(note.id, pair.assistantMessage.id, "完了", "complete", "old-provider-session");
  service.revise(note.id, 3, 1);
  expect(store.note(note.id).providerSessionId).toBeNull();
  expect(() => service.revise(note.id, 3, 1)).toThrow("状態が変わりました");
  service.draft(note.id, "猫は歩く。", 2); service.apply(note.id, 3, 3, "replace");
  service.save(row.id, "本文を全面的に変更。", 4);
  const orphan = store.note(note.id);
  expect(() => service.revise(note.id, 5, 3)).toThrow("対象の文章がありません");
  expect(store.note(note.id)).toEqual(orphan);
});
