import { asc, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { AppDatabase } from "@/server/db";
import { appSettings, conversations, conversationFolders, documentSources, messages, sideNotes, sideNoteLayouts, sideNoteMessages, manuscriptNotes } from "@/server/db/schema";
import type { ContextSnapshot, ConversationDetail, Message, NoteLayout, ProviderKind, PublicSettings, Settings, SideNote, TextAnchor } from "@/lib/types";
import { AppError } from "@/server/errors";
import type { NoteColor } from "@/lib/note-colors";
import { validateDocument } from "@/lib/document-import";

export class Store {
  constructor(readonly db: AppDatabase) {}
  listConversations() {
    return this.db.select({ conversation: conversations, document: documentSources }).from(conversations).leftJoin(documentSources, eq(conversations.id, documentSources.conversationId))
      .orderBy(desc(conversations.updatedAt)).all().map(({ conversation, document }) => ({ ...conversation, document }));
  }
  listFolders() { return this.db.select().from(conversationFolders).orderBy(asc(conversationFolders.createdAt), asc(conversationFolders.id)).all(); }
  folder(id: string) {
    const row = this.db.select().from(conversationFolders).where(eq(conversationFolders.id, id)).get();
    if (!row) throw new AppError("フォルダが見つかりません。", 404);
    return row;
  }
  createFolder(name: string) {
    const now = Date.now();
    const row = { id: randomUUID(), name, createdAt: now, updatedAt: now };
    this.db.insert(conversationFolders).values(row).run();
    return row;
  }
  renameFolder(id: string, name: string) {
    this.folder(id);
    this.db.update(conversationFolders).set({ name, updatedAt: Date.now() }).where(eq(conversationFolders.id, id)).run();
    return this.folder(id);
  }
  deleteFolder(id: string) {
    this.folder(id);
    // The foreign key returns conversations to unfiled; messages and notes remain intact.
    this.db.delete(conversationFolders).where(eq(conversationFolders.id, id)).run();
  }
  updateConversation(id: string, patch: { title?: string; folderId?: string | null }) {
    this.conversation(id);
    if (patch.folderId) this.folder(patch.folderId);
    this.db.update(conversations).set({ ...patch, ...(patch.title !== undefined ? { titleEdited: true } : {}), updatedAt: Date.now() }).where(eq(conversations.id, id)).run();
    return this.conversation(id);
  }
  conversation(id: string) {
    const row = this.db.select().from(conversations).where(eq(conversations.id, id)).get();
    if (!row) throw new AppError("会話が見つかりません。", 404);
    const document = this.db.select().from(documentSources).where(eq(documentSources.conversationId, id)).get() ?? null;
    return { ...row, document };
  }
  importDocument(fileName: string, content: string) {
    let format: "markdown" | "text" | "pdf";
    try { format = validateDocument(fileName, content, true); } catch (error) { throw new AppError((error as Error).message); }
    const settings = this.settings();
    const kind = settings.defaultProvider;
    const model = kind === "mock" ? "mock-demo" : kind === "codex" ? settings.codexDefaultModel : kind === "openai" ? settings.openaiModel : settings.compatibleModel;
    return this.db.transaction(() => {
      const id = randomUUID(), messageId = randomUUID(), now = Date.now();
      const title = Array.from(fileName.replace(/\.(md|markdown|txt|pdf)$/i, "").trim() || fileName).slice(0, 100).join("");
      this.db.insert(conversations).values({ id, title, titleEdited: true, providerKind: kind, model, createdAt: now, updatedAt: now }).run();
      // The imported source is user-supplied reference material, never an AI reply.
      this.db.insert(messages).values({ id: messageId, conversationId: id, sequence: 1, role: "user", content, status: "complete", createdAt: now, updatedAt: now }).run();
      this.db.insert(documentSources).values({ conversationId: id, messageId, fileName, format }).run();
      return this.detail(id);
    });
  }
  updateDocumentProvider(id: string, providerKind: ProviderKind, model: string) {
    const conversation = this.conversation(id);
    if (!conversation.document) throw new AppError("資料が見つかりません。", 404);
    if (conversation.providerKind === providerKind && conversation.model === model) return this.detail(id);
    this.db.transaction(() => {
      this.db.update(conversations).set({ providerKind, model, providerSessionId: null, updatedAt: Date.now() }).where(eq(conversations.id, id)).run();
      this.db.update(sideNotes).set({ providerSessionId: null }).where(eq(sideNotes.conversationId, id)).run();
    });
    return this.detail(id);
  }
  mainMessages(id: string): Message[] {
    // Intentionally only reads messages. Never join side_note_messages here.
    return this.db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(asc(messages.sequence)).all();
  }
  noteMessages(id: string): Message[] {
    return this.db.select().from(sideNoteMessages).where(eq(sideNoteMessages.sideNoteId, id)).orderBy(asc(sideNoteMessages.sequence)).all();
  }
  note(id: string): SideNote {
    const row = this.db.select().from(sideNotes).where(eq(sideNotes.id, id)).get();
    const layout = this.db.select().from(sideNoteLayouts).where(eq(sideNoteLayouts.sideNoteId, id)).get();
    if (!row || !layout) throw new AppError("付箋が見つかりません。", 404);
    const manuscript = this.db.select().from(manuscriptNotes).where(eq(manuscriptNotes.sideNoteId, id)).get();
    return { ...row, layout, messages: this.noteMessages(id), ...(manuscript ? { manuscript } : {}) };
  }
  detail(id: string): ConversationDetail {
    const conversation = this.conversation(id);
    const noteRows = this.db.select({ id: sideNotes.id }).from(sideNotes).where(eq(sideNotes.conversationId, id)).all();
    return { ...conversation, messages: this.mainMessages(id), notes: noteRows.map((n) => this.note(n.id)) };
  }
  createConversation(providerKind: ProviderKind, model: string) {
    const now = Date.now();
    const row = { id: randomUUID(), title: "新しい会話", providerKind, model, providerSessionId: null, createdAt: now, updatedAt: now };
    this.db.insert(conversations).values(row).run();
    return this.detail(row.id);
  }
  deleteConversation(id: string) {
    this.conversation(id);
    this.db.delete(conversations).where(eq(conversations.id, id)).run();
  }
  createNote(conversationId: string, parentMessageId: string, anchor: TextAnchor, position: { x: number; y: number }, manuscript = false) {
    const conversation = this.conversation(conversationId);
    if (conversation.document?.editable && !manuscript) throw new AppError("原稿を保存してから付箋を作成してください。", 409);
    return this.db.transaction(() => {
      const history = this.mainMessages(conversationId);
      const parent = history.find((m) => m.id === parentMessageId);
      const document = conversation.document;
      if (!parent || parent.status !== "complete" || (document ? parent.id !== document.messageId : parent.role !== "assistant")) throw new AppError(document ? "この資料の本文から選択してください。" : "生成が完了した一つのAI回答から選択してください。");
      const snapshot: ContextSnapshot = {
        version: 1, conversationId, parentMessageId, selectedText: anchor.selectedText,
        messages: (document ? [parent] : history.filter((m) => m.status === "complete")).map(({ role, content }) => ({ role, content })),
        ...(document ? { source: { kind: "document" as const, fileName: document.fileName, format: document.format, scope: "full-document" as const } } : {}),
      };
      const now = Date.now();
      const id = randomUUID();
      this.db.insert(sideNotes).values({ id, conversationId, parentMessageId, ...anchor, mode: "memo", memo: "", contextSnapshot: snapshot, providerSessionId: null, createdAt: now, updatedAt: now }).run();
      this.db.insert(sideNoteLayouts).values({ sideNoteId: id, layoutType: "desktop", ...position, width: 320, height: 220, collapsed: false, zIndex: 100, updatedAt: now }).run();
      return this.note(id);
    });
  }
  updateNote(id: string, patch: { memo?: string; mode?: "memo" | "chat"; color?: NoteColor }) {
    this.note(id);
    this.db.update(sideNotes).set({ ...patch, updatedAt: Date.now() }).where(eq(sideNotes.id, id)).run();
    return this.note(id);
  }
  updateLayout(id: string, patch: Partial<NoteLayout>) {
    this.note(id);
    this.db.update(sideNoteLayouts).set({ ...patch, updatedAt: Date.now() }).where(eq(sideNoteLayouts.sideNoteId, id)).run();
    return this.note(id).layout;
  }
  deleteNote(id: string) {
    this.note(id);
    this.db.delete(sideNotes).where(eq(sideNotes.id, id)).run();
  }
  beginNote(id: string, text: string) {
    this.note(id);
    return this.db.transaction(() => {
      const history = this.noteMessages(id);
      const pair = messagePair((history.at(-1)?.sequence ?? 0) + 1, text, Date.now());
      this.db.insert(sideNoteMessages).values(pair.map((m) => ({ ...m, sideNoteId: id }))).run();
      this.db.update(sideNotes).set({ mode: "chat", updatedAt: Date.now() }).where(eq(sideNotes.id, id)).run();
      return { history, userMessage: pair[0], assistantMessage: pair[1] };
    });
  }
  finishNote(id: string, messageId: string, content: string, status: "complete" | "error", providerSessionId?: string | null) {
    this.db.transaction(() => {
      this.db.update(sideNoteMessages).set({ content, status, updatedAt: Date.now() }).where(eq(sideNoteMessages.id, messageId)).run();
      this.db.update(sideNotes).set({ updatedAt: Date.now(), ...(providerSessionId !== undefined ? { providerSessionId } : {}) }).where(eq(sideNotes.id, id)).run();
    });
  }
  beginMain(id: string, text: string) {
    const conversation = this.conversation(id);
    if (conversation.document) throw new AppError("資料の本文は読み取り専用です。付箋から質問してください。", 409);
    return this.db.transaction(() => {
      const history = this.mainMessages(id);
      const sequence = (history.at(-1)?.sequence ?? 0) + 1;
      const now = Date.now();
      const pair = messagePair(sequence, text, now);
      this.db.insert(messages).values(pair.map((m) => ({ ...m, conversationId: id }))).run();
      this.db.update(conversations).set({ updatedAt: now, ...(history.length || conversation.titleEdited ? {} : { title: Array.from(text.replace(/\s+/g, " ")).slice(0, 50).join("") }) }).where(eq(conversations.id, id)).run();
      return { history, userMessage: pair[0], assistantMessage: pair[1] };
    });
  }
  finishMain(id: string, messageId: string, content: string, status: "complete" | "error", providerSessionId?: string | null) {
    this.db.transaction(() => {
      this.db.update(messages).set({ content, status, updatedAt: Date.now() }).where(eq(messages.id, messageId)).run();
      this.db.update(conversations).set({ updatedAt: Date.now(), ...(providerSessionId !== undefined ? { providerSessionId } : {}) }).where(eq(conversations.id, id)).run();
    });
  }
  settings(): PublicSettings {
    const saved = Object.fromEntries(this.db.select().from(appSettings).all().map((r) => [r.key, r.value]));
    const mockEnabled = process.env.ENABLE_MOCK_PROVIDER === "true";
    const defaults: Settings = {
      defaultProvider: mockEnabled ? "mock" : "codex", codexDefaultModel: "", openaiModel: "",
      compatibleBaseUrl: "http://localhost:11434/v1", compatibleModel: "",
    };
    const merged = { ...defaults, ...saved } as Settings;
    if (!mockEnabled && merged.defaultProvider === "mock") merged.defaultProvider = "codex";
    return { ...merged, mockEnabled, openaiKeyConfigured: !!process.env.OPENAI_API_KEY, compatibleKeyConfigured: !!process.env.OPENAI_COMPAT_API_KEY };
  }
  updateSettings(patch: Partial<Settings>) {
    this.db.transaction(() => {
      for (const [key, value] of Object.entries(patch)) this.db.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } }).run();
    });
    return this.settings();
  }
}

export function messagePair(sequence: number, text: string, now: number): [Message, Message] {
  return [
    { id: randomUUID(), sequence, role: "user", content: text, status: "complete", createdAt: now, updatedAt: now },
    { id: randomUUID(), sequence: sequence + 1, role: "assistant", content: "", status: "streaming", createdAt: now, updatedAt: now },
  ];
}
