import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { ContextSnapshot, ProviderKind, ManuscriptNote, ManuscriptRevision } from "@/lib/types";
import type { NoteColor } from "@/lib/note-colors";
import type { ConnectorAdjustment } from "@/lib/connector-types";

const timestamps = { createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull() };
export const workspaceMetadata = sqliteTable("workspace_metadata", { id: integer("id").primaryKey(), revision: text("revision").notNull() });
export const backupSchedule = sqliteTable("backup_schedule", {
  id: integer("id").primaryKey(), enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastAttemptAt: integer("last_attempt_at"), lastSuccessAt: integer("last_success_at"), lastFile: text("last_file"), lastError: text("last_error"),
});
export const conversationFolders = sqliteTable("conversation_folders", {
  id: text("id").primaryKey(), name: text("name").notNull(), ...timestamps,
});
export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(), title: text("title").notNull(),
  titleEdited: integer("title_edited", { mode: "boolean" }).notNull().default(false),
  folderId: text("folder_id").references(() => conversationFolders.id, { onDelete: "set null" }),
  providerKind: text("provider_kind").$type<ProviderKind>().notNull(), model: text("model").notNull(),
  providerSessionId: text("provider_session_id"), ...timestamps,
}, (t) => [index("conversations_folder").on(t.folderId)]);
const messageFields = {
  id: text("id").primaryKey(), sequence: integer("sequence").notNull(),
  role: text("role").$type<"user" | "assistant">().notNull(), content: text("content").notNull(),
  status: text("status").$type<"streaming" | "complete" | "error">().notNull(), ...timestamps,
};
export const messages = sqliteTable("messages", {
  ...messageFields, conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
}, (t) => [uniqueIndex("messages_sequence").on(t.conversationId, t.sequence)]);
export const documentSources = sqliteTable("document_sources", {
  conversationId: text("conversation_id").primaryKey().references(() => conversations.id, { onDelete: "cascade" }),
  messageId: text("message_id").notNull().unique().references(() => messages.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(), format: text("format").$type<"markdown" | "text" | "pdf">().notNull(),
  editable: integer("editable", { mode: "boolean" }).notNull().default(false), revision: integer("revision").notNull().default(0),
});
export const sideNotes = sqliteTable("side_notes", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  parentMessageId: text("parent_message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  selectedText: text("selected_text").notNull(), anchorStart: integer("anchor_start").notNull(),
  anchorEnd: integer("anchor_end").notNull(), anchorPrefix: text("anchor_prefix").notNull(),
  anchorSuffix: text("anchor_suffix").notNull(), anchorVersion: integer("anchor_version").notNull(),
  mode: text("mode").$type<"memo" | "chat">().notNull(), memo: text("memo").notNull(),
  color: text("color").$type<NoteColor>().notNull().default("yellow"),
  contextSnapshot: text("context_snapshot_json", { mode: "json" }).$type<ContextSnapshot>().notNull(),
  providerSessionId: text("provider_session_id"), ...timestamps,
}, (t) => [index("notes_conversation").on(t.conversationId)]);
export const sideNoteMessages = sqliteTable("side_note_messages", {
  ...messageFields, sideNoteId: text("side_note_id").notNull().references(() => sideNotes.id, { onDelete: "cascade" }),
}, (t) => [uniqueIndex("note_messages_sequence").on(t.sideNoteId, t.sequence)]);
export const sideNoteLayouts = sqliteTable("side_note_layouts", {
  sideNoteId: text("side_note_id").primaryKey().references(() => sideNotes.id, { onDelete: "cascade" }),
  layoutType: text("layout_type").notNull().default("desktop"),
  x: integer("x").notNull(), y: integer("y").notNull(), width: integer("width").notNull(), height: integer("height").notNull(),
  collapsed: integer("collapsed", { mode: "boolean" }).notNull(), zIndex: integer("z_index").notNull(),
  minimized: integer("minimized", { mode: "boolean" }).notNull().default(false),
  connector: text("connector_json", { mode: "json" }).$type<ConnectorAdjustment>(),
  updatedAt: integer("updated_at").notNull(),
});
export const appSettings = sqliteTable("app_settings", { key: text("key").primaryKey(), value: text("value").notNull() });
export const manuscriptNotes = sqliteTable("manuscript_notes", {
  sideNoteId: text("side_note_id").primaryKey().references(() => sideNotes.id, { onDelete: "cascade" }),
  draft: text("draft").notNull().default(""), draftRevision: integer("draft_revision").notNull().default(0),
  from: integer("start_offset"), to: integer("end_offset"), originalText: text("original_text").notNull(),
  baseRevision: integer("base_revision").notNull(), appliedRevision: integer("applied_revision"), contextRevision: integer("context_revision").notNull(),
  historyFrom: integer("history_from").notNull().default(0), contextHistory: text("context_history_json", { mode: "json" }).$type<ManuscriptNote["contextHistory"]>().notNull().default([]),
});
export const manuscriptRevisions = sqliteTable("manuscript_revisions", {
  id: text("id").primaryKey(), conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(), content: text("content").notNull(), label: text("label").notNull(), kind: text("kind").notNull(),
  anchors: text("anchors_json", { mode: "json" }).$type<ManuscriptRevision["anchors"]>().notNull(), createdAt: integer("created_at").notNull(),
}, (t) => [uniqueIndex("manuscript_revision_number").on(t.conversationId, t.revision)]);
