import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { conversations, documentSources, manuscriptNotes, manuscriptRevisions, messages, sideNotes, sideNoteLayouts } from "@/server/db/schema";
import type { ContextSnapshot, ManuscriptRevision } from "@/lib/types";
import { manuscriptEdits, MAX_MANUSCRIPT_LENGTH, moveAttachment, proposalEdit, type ApplyMode, type Edit } from "@/lib/manuscript";
import { AppError } from "@/server/errors";
import { validateDocument } from "@/lib/document-import";
import type { Store } from "./store";

export class Manuscripts {
  constructor(private store: Store) {}
  private get db() { return this.store.db; }
  private current(id: string, expected?: number) {
    const detail = this.store.detail(id);
    if (!detail.document?.editable) throw new AppError("原稿が見つかりません。", 404);
    if (expected !== undefined && detail.document.revision !== expected) throw new AppError("原稿が別の画面で更新されています。編集内容をコピーして退避し、最新の原稿を読み込み直してください。", 409);
    return { detail, source: detail.document, content: detail.messages[0].content };
  }
  create(title: string, sourceMessageId?: string, file?: { fileName: string; content: string }) {
    return this.db.transaction(() => {
      if (sourceMessageId && file) throw new AppError("原稿の取り込み元は一つ選んでください。");
      if (file) {
        try { validateDocument(file.fileName, file.content); } catch (error) { throw new AppError((error as Error).message); }
      }
      let content = file?.content ?? "", sourceConversation;
      if (sourceMessageId) {
        const message = this.db.select().from(messages).where(eq(messages.id, sourceMessageId)).get();
        if (!message || message.status !== "complete") throw new AppError("保存が完了した本文を選んでください。");
        content = message.content; sourceConversation = this.store.conversation(message.conversationId);
      }
      content = content.replace(/\r\n?/g, "\n");
      this.validateContent(content);
      const row = this.store.createConversation(sourceConversation?.providerKind ?? this.store.settings().defaultProvider, sourceConversation?.model ?? this.defaultModel());
      const messageId = randomUUID(), now = Date.now();
      this.db.update(conversations).set({ title, titleEdited: true, folderId: sourceConversation?.folderId ?? null }).where(eq(conversations.id, row.id)).run();
      this.db.insert(messages).values({ id: messageId, conversationId: row.id, sequence: 1, role: "user", content, status: "complete", createdAt: now, updatedAt: now }).run();
      this.db.insert(documentSources).values({ conversationId: row.id, messageId, fileName: file?.fileName ?? "原稿.md", format: "markdown", editable: true, revision: 1 }).run();
      this.record(row.id, content, 1, file ? "ファイルから取り込み" : "作成", "create");
      return this.store.detail(row.id);
    });
  }
  private defaultModel() {
    const s = this.store.settings();
    return s.defaultProvider === "mock" ? "mock-demo" : s.defaultProvider === "codex" ? s.codexDefaultModel : s.defaultProvider === "openai" ? s.openaiModel : s.compatibleModel;
  }
  private validateContent(content: string) {
    if (content.length > MAX_MANUSCRIPT_LENGTH || /\u0000/.test(content)) throw new AppError("原稿は10万文字以内で入力してください。制御文字のNULは使えません。");
  }
  private attachments(id: string) {
    return Object.fromEntries(this.store.detail(id).notes.filter((n) => n.manuscript).map((n) => [n.id, { from: n.manuscript!.from, to: n.manuscript!.to, appliedRevision: n.manuscript!.appliedRevision }]));
  }
  private record(id: string, content: string, revision: number, label: string, kind: string) {
    this.db.insert(manuscriptRevisions).values({ id: randomUUID(), conversationId: id, revision, content, label, kind, anchors: this.attachments(id), createdAt: Date.now() }).run();
  }
  private captureCurrentAnchors(id: string, revision: number) {
    const row = this.db.select().from(manuscriptRevisions).where(and(eq(manuscriptRevisions.conversationId, id), eq(manuscriptRevisions.revision, revision))).get();
    if (row) {
      const anchors = this.attachments(id);
      for (const [noteId, anchor] of Object.entries(anchors)) {
        const previous = row.anchors[noteId];
        // Starting another draft must not erase the fact that this saved version was applied.
        if (previous && previous.from === anchor.from && previous.to === anchor.to && anchor.appliedRevision === null) anchor.appliedRevision = previous.appliedRevision;
      }
      this.db.update(manuscriptRevisions).set({ anchors }).where(eq(manuscriptRevisions.id, row.id)).run();
    }
  }
  save(id: string, content: string, expected: number, label = "自動保存", kind = "edit", explicitEdits?: Edit[], appliedNote?: string, restored?: ManuscriptRevision) {
    content = content.replace(/\r\n?/g, "\n");
    this.validateContent(content);
    return this.db.transaction(() => {
      const current = this.current(id, expected);
      if (current.content === content && kind === "edit") return current.detail;
      this.captureCurrentAnchors(id, expected);
      const revision = expected + 1;
      const edits = explicitEdits ?? manuscriptEdits(current.content, content);
      for (const note of current.detail.notes) {
        if (!note.manuscript) continue;
        const attachment = restored ? restored.anchors[note.id] ?? { from: null, to: null, appliedRevision: null } : moveAttachment(note.manuscript, edits);
        this.db.update(manuscriptNotes).set(attachment).where(eq(manuscriptNotes.sideNoteId, note.id)).run();
      }
      if (appliedNote && explicitEdits) {
        const edit = explicitEdits[0];
        this.db.update(manuscriptNotes).set({ from: edit.from, to: edit.from + edit.insert.length, appliedRevision: revision }).where(eq(manuscriptNotes.sideNoteId, appliedNote)).run();
        this.db.update(sideNoteLayouts).set({ minimized: false, updatedAt: Date.now() }).where(eq(sideNoteLayouts.sideNoteId, appliedNote)).run();
      }
      const now = Date.now();
      this.db.update(messages).set({ content, updatedAt: now }).where(eq(messages.id, current.source.messageId)).run();
      this.db.update(documentSources).set({ revision }).where(eq(documentSources.conversationId, id)).run();
      this.db.update(conversations).set({ updatedAt: now }).where(eq(conversations.id, id)).run();
      this.record(id, content, revision, label, kind);
      return this.store.detail(id);
    });
  }
  history(id: string) {
    this.current(id);
    return this.db.select({ id: manuscriptRevisions.id, revision: manuscriptRevisions.revision, label: manuscriptRevisions.label, kind: manuscriptRevisions.kind, createdAt: manuscriptRevisions.createdAt }).from(manuscriptRevisions).where(eq(manuscriptRevisions.conversationId, id)).orderBy(desc(manuscriptRevisions.revision)).all();
  }
  version(id: string, revisionId: string) {
    this.current(id);
    const row = this.db.select().from(manuscriptRevisions).where(eq(manuscriptRevisions.id, revisionId)).get();
    if (!row || row.conversationId !== id) throw new AppError("原稿の履歴が見つかりません。", 404);
    return row;
  }
  restore(id: string, revisionId: string, expected: number) {
    const row = this.version(id, revisionId);
    return this.save(id, row.content, expected, `版 ${row.revision} を復元`, "restore", undefined, undefined, row);
  }
  createNote(id: string, expected: number, from: number, to: number, x: number, y: number) {
    return this.db.transaction(() => {
      const { source, content } = this.current(id, expected);
      if (from > to || to > content.length || to - from > 20_000) throw new AppError("原稿の2万文字以内の範囲を選び直してください。");
      const originalText = content.slice(from, to), selectedText = originalText.trim() ? originalText.trim().slice(0, 500).replace(/[\uD800-\uDBFF]$/, "") : "挿入位置";
      const note = this.store.createNote(id, source.messageId, { selectedText, anchorStart: from, anchorEnd: from + selectedText.length, anchorPrefix: "", anchorSuffix: "", anchorVersion: 1 }, { x, y }, true);
      this.db.update(sideNotes).set({ contextSnapshot: this.snapshot(id, originalText, expected) }).where(eq(sideNotes.id, note.id)).run();
      this.db.insert(manuscriptNotes).values({ sideNoteId: note.id, from, to, originalText, baseRevision: expected, contextRevision: expected }).run();
      return this.store.note(note.id);
    });
  }
  private snapshot(id: string, selectedText: string, revision: number): ContextSnapshot {
    const { source, content } = this.current(id, revision);
    return { version: 1, conversationId: id, parentMessageId: source.messageId, selectedText: selectedText || "（カーソル位置への挿入）", messages: [{ role: "user", content }], source: { kind: "document", fileName: source.fileName, format: source.format, scope: "full-document", manuscriptRevision: revision } };
  }
  private editorial(noteId: string) {
    const note = this.store.note(noteId);
    if (!note.manuscript) throw new AppError("原稿の付箋が見つかりません。", 404);
    return { note, edit: note.manuscript };
  }
  draft(noteId: string, draft: string, expected: number) {
    draft = draft.replace(/\r\n?/g, "\n");
    return this.db.transaction(() => {
      const { edit } = this.editorial(noteId);
      if (edit.appliedRevision !== null) throw new AppError("「続けて推敲する」で反映後の本文から次の原稿案を編集できます。", 409);
      if (edit.draftRevision !== expected) throw new AppError("原稿案が別の画面で変更されています。入力した案をコピーしてから読み込み直してください。", 409);
      this.db.update(manuscriptNotes).set({ draft, draftRevision: expected + 1 }).where(eq(manuscriptNotes.sideNoteId, noteId)).run();
      return this.store.note(noteId);
    });
  }
  apply(noteId: string, expected: number, expectedDraft: number, mode: ApplyMode) {
    return this.db.transaction(() => {
      const { note, edit } = this.editorial(noteId);
      const { content } = this.current(note.conversationId, expected);
      if (edit.appliedRevision !== null || edit.draftRevision !== expectedDraft) throw new AppError("原稿案の状態が変わりました。もう一度プレビューしてください。", 409);
      if (edit.from === null || edit.to === null || content.slice(edit.from, edit.to) !== edit.originalText) throw new AppError("対象の文章が変更されています。本文を選び直して新しい付箋を作ってください。", 409);
      if (!edit.draft.trim()) throw new AppError("反映する原稿案を書いてください。");
      const change = proposalEdit(edit.from, edit.to, edit.draft, mode);
      return this.save(note.conversationId, content.slice(0, change.from) + change.insert + content.slice(change.to), expected, `付箋から${mode === "replace" ? "置換" : "挿入"}`, "apply", [change], noteId);
    });
  }
  revise(noteId: string, expected: number, expectedDraft: number) {
    return this.db.transaction(() => {
      const { note, edit } = this.editorial(noteId);
      const { content } = this.current(note.conversationId, expected);
      if (edit.appliedRevision === null || edit.draftRevision !== expectedDraft) throw new AppError("原稿案の状態が変わりました。最新の付箋を読み込み直してください。", 409);
      if (edit.from === null || edit.to === null) throw new AppError("対象の文章がありません。本文を選び直して付箋を作ってください。", 409);
      const originalText = content.slice(edit.from, edit.to);
      if (originalText.length > 20_000) throw new AppError("原稿の2万文字以内の範囲を選び直してください。");
      // Refresh also archives the previous AI reference and starts a fresh provider session.
      this.refreshContext(noteId, expected);
      this.db.update(manuscriptNotes).set({ originalText, baseRevision: expected, draft: originalText, draftRevision: expectedDraft + 1, appliedRevision: null }).where(eq(manuscriptNotes.sideNoteId, noteId)).run();
      const selectedText = originalText.trim() ? originalText.trim().slice(0, 500).replace(/[\uD800-\uDBFF]$/, "") : "挿入位置";
      this.db.update(sideNotes).set({ selectedText, anchorStart: edit.from, anchorEnd: edit.from + selectedText.length, updatedAt: Date.now() }).where(eq(sideNotes.id, noteId)).run();
      return this.store.note(noteId);
    });
  }
  refreshContext(noteId: string, expected: number) {
    return this.db.transaction(() => {
      const { note, edit } = this.editorial(noteId);
      const { content } = this.current(note.conversationId, expected);
      if (note.messages.some((m) => m.status === "streaming")) throw new AppError("回答が終わってから参照を更新してください。", 409);
      if (edit.from === null || edit.to === null) throw new AppError("対象の文章がありません。本文を選び直してください。", 409);
      const throughSequence = note.messages.at(-1)?.sequence ?? 0;
      this.db.update(manuscriptNotes).set({ contextRevision: expected, historyFrom: throughSequence, contextHistory: [...edit.contextHistory, { snapshot: note.contextSnapshot, throughSequence }] }).where(eq(manuscriptNotes.sideNoteId, noteId)).run();
      this.db.update(sideNotes).set({ contextSnapshot: this.snapshot(note.conversationId, content.slice(edit.from, edit.to), expected), providerSessionId: null }).where(eq(sideNotes.id, noteId)).run();
      return this.store.note(noteId);
    });
  }
}
