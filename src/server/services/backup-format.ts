import { createHash } from "node:crypto";
import { z } from "zod";
import { PROVIDER_KINDS } from "@/lib/types";
import { NOTE_COLORS } from "@/lib/note-colors";
import { MAX_BACKUP_BYTES, type BackupCounts } from "@/lib/backup";
import { validateDocument } from "@/lib/document-import";
import { AppError } from "../errors";

const id = z.string().uuid();
const number = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const bit = z.union([z.literal(0), z.literal(1)]);
const times = { created_at: number, updated_at: number };
const message = { id, sequence: number.min(1), role: z.enum(["user", "assistant"]), content: z.string(), status: z.enum(["complete", "error", "streaming"]), ...times };
const attachment = z.object({ side: z.enum(["top", "right", "bottom", "left"]), ratio: z.number().min(0).max(1) }).strict();
const connector = z.object({ source: attachment.extend({ segment: number.max(1000) }), target: attachment, bend: z.object({ x: z.number().min(-2000).max(2000), y: z.number().min(-2000).max(2000) }).strict() }).strict();
const snapshot = z.object({ version: z.literal(1), conversationId: id, parentMessageId: id, selectedText: z.string().min(1).max(20_000), messages: z.array(z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string() }).strict()), source: z.object({ kind: z.literal("document"), fileName: z.string(), format: z.enum(["markdown", "text", "pdf"]), scope: z.literal("full-document"), manuscriptRevision: number.min(1).optional() }).strict().optional() }).strict();
const storedAnchors = z.record(id, z.object({ from: number.nullable(), to: number.nullable(), appliedRevision: number.min(1).nullable() }).strict());
export const backupRows = {
  conversation_folders: z.object({ id, name: z.string().min(1).max(60), ...times }).strict(),
  conversations: z.object({ id, title: z.string().max(200), title_edited: bit, folder_id: id.nullable(), provider_kind: z.enum(PROVIDER_KINDS), model: z.string().max(200), ...times }).strict(),
  messages: z.object({ ...message, conversation_id: id }).strict(),
  document_sources: z.object({ conversation_id: id, message_id: id, file_name: z.string().min(1).max(255), format: z.enum(["markdown", "text", "pdf"]), editable: bit.default(0), revision: number.default(0) }).strict(),
  side_notes: z.object({ id, conversation_id: id, parent_message_id: id, selected_text: z.string().min(1).max(500), anchor_start: number, anchor_end: number, anchor_prefix: z.string().max(50), anchor_suffix: z.string().max(50), anchor_version: z.literal(1), mode: z.enum(["memo", "chat"]), memo: z.string().max(20_000), color: z.enum(NOTE_COLORS), context_snapshot_json: z.string(), ...times }).strict(),
  side_note_messages: z.object({ ...message, side_note_id: id }).strict(),
  side_note_layouts: z.object({ side_note_id: id, layout_type: z.literal("desktop"), x: number.max(100_000), y: number.max(1_000_000), width: number.min(240).max(2000), height: number.min(150).max(2000), collapsed: bit, minimized: bit, z_index: number.min(1).max(1_000_000), connector_json: z.string().nullable(), updated_at: number }).strict(),
  app_settings: z.object({ key: z.enum(["defaultProvider", "codexDefaultModel", "openaiModel", "compatibleBaseUrl", "compatibleModel"]), value: z.string().max(2048) }).strict(),
  manuscript_notes: z.object({ side_note_id: id, draft: z.string().max(20_000), draft_revision: number, start_offset: number.nullable(), end_offset: number.nullable(), original_text: z.string().max(20_000), base_revision: number.min(1), applied_revision: number.min(1).nullable(), context_revision: number.min(1), history_from: number, context_history_json: z.string() }).strict(),
  manuscript_revisions: z.object({ id, conversation_id: id, revision: number.min(1), content: z.string().max(100_000), label: z.string().max(100), kind: z.enum(["create", "edit", "apply", "restore", "checkpoint"]), anchors_json: z.string(), created_at: number }).strict(),
};
const dataSchema = z.object({
  conversation_folders: z.array(backupRows.conversation_folders), conversations: z.array(backupRows.conversations), messages: z.array(backupRows.messages), document_sources: z.array(backupRows.document_sources), side_notes: z.array(backupRows.side_notes), side_note_messages: z.array(backupRows.side_note_messages), side_note_layouts: z.array(backupRows.side_note_layouts), app_settings: z.array(backupRows.app_settings),
  manuscript_notes: z.array(backupRows.manuscript_notes).default([]), manuscript_revisions: z.array(backupRows.manuscript_revisions).default([]),
}).strict();
export type BackupData = z.infer<typeof dataSchema>;
// Backups written before the rename from SideNote AI use the previous format name.
const envelope = z.object({ format: z.enum(["fussenn-backup", "sidenote-backup"]), version: z.union([z.literal(1), z.literal(2), z.literal(3)]), createdAt: z.iso.datetime(), data: dataSchema, checksum: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type BackupFile = z.infer<typeof envelope>;
export const digest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export function backupCounts(data: BackupData): BackupCounts {
  return { conversations: data.conversations.length - data.document_sources.length, documents: data.document_sources.length, notes: data.side_notes.length, messages: data.messages.length + data.side_note_messages.length, folders: data.conversation_folders.length };
}
function unique<T>(rows: T[], key: (row: T) => string) {
  const result = new Map<string, T>();
  for (const row of rows) { const k = key(row); if (result.has(k)) throw new Error("duplicate"); result.set(k, row); }
  return result;
}
function validateRelations(data: BackupData) {
  const folders = unique(data.conversation_folders, (r) => r.id);
  const conversations = unique(data.conversations, (r) => r.id);
  const messages = unique(data.messages, (r) => r.id);
  const sources = unique(data.document_sources, (r) => r.conversation_id);
  const notes = unique(data.side_notes, (r) => r.id);
  const layouts = unique(data.side_note_layouts, (r) => r.side_note_id);
  const edits = unique(data.manuscript_notes, (r) => r.side_note_id);
  const versions = unique(data.manuscript_revisions, (r) => `${r.conversation_id}:${r.revision}`);
  unique(data.manuscript_revisions, (r) => r.id);
  unique(data.messages, (r) => `${r.conversation_id}:${r.sequence}`);
  unique(data.side_note_messages, (r) => r.id);
  unique(data.side_note_messages, (r) => `${r.side_note_id}:${r.sequence}`);
  unique(data.document_sources, (r) => r.message_id);
  unique(data.app_settings, (r) => r.key);
  const check = (valid: unknown) => { if (!valid) throw new Error("relation"); };
  for (const c of data.conversations) check(!c.folder_id || folders.has(c.folder_id));
  const messageCounts = new Map<string, number>();
  for (const m of data.messages) {
    check(conversations.has(m.conversation_id));
    messageCounts.set(m.conversation_id, (messageCounts.get(m.conversation_id) ?? 0) + 1);
  }
  for (const s of data.document_sources) {
    const parent = messages.get(s.message_id);
    check(conversations.has(s.conversation_id) && parent?.conversation_id === s.conversation_id && parent.role === "user" && parent.status === "complete");
    if (s.editable) {
      const version = versions.get(`${s.conversation_id}:${s.revision}`);
      check(version && version.content === parent!.content && s.format === "markdown");
    } else { check(s.revision === 0); check(validateDocument(s.file_name, parent!.content, true) === s.format); }
    check(messageCounts.get(s.conversation_id) === 1);
  }
  for (const n of data.side_notes) {
    const parent = messages.get(n.parent_message_id), source = sources.get(n.conversation_id);
    check(conversations.has(n.conversation_id) && parent?.conversation_id === n.conversation_id && parent.status === "complete");
    check(source ? source.message_id === n.parent_message_id : parent?.role === "assistant");
    check(n.anchor_end - n.anchor_start === n.selected_text.length && n.selected_text.trim() && layouts.has(n.id));
    const context = snapshot.parse(JSON.parse(n.context_snapshot_json));
    check(context.conversationId === n.conversation_id && context.parentMessageId === n.parent_message_id);
    if (!source?.editable) check(context.selectedText === n.selected_text);
    if (source?.editable) {
      const edit = edits.get(n.id), version = versions.get(`${n.conversation_id}:${context.source?.manuscriptRevision}`);
      check(edit && edit.context_revision === context.source?.manuscriptRevision && version && context.messages.length === 1 && context.messages[0].content === version.content && context.messages[0].role === "user");
    } else if (source) check(context.source?.fileName === source.file_name && context.source.format === source.format && context.messages.length === 1 && context.messages[0].content === parent?.content && context.messages[0].role === "user");
    else check(!context.source);
  }
  for (const l of data.side_note_layouts) { check(notes.has(l.side_note_id)); if (l.connector_json) connector.parse(JSON.parse(l.connector_json)); }
  for (const m of data.side_note_messages) check(notes.has(m.side_note_id));
  const validRange = (from: number | null, to: number | null, length: number) => from === null ? to === null : to !== null && from <= to && to <= length;
  for (const e of data.manuscript_notes) {
    const note = notes.get(e.side_note_id), source = sources.get(note?.conversation_id ?? "");
    check(source?.editable && validRange(e.start_offset, e.end_offset, messages.get(source.message_id)!.content.length));
    check(versions.has(`${note!.conversation_id}:${e.base_revision}`));
    if (e.applied_revision !== null) check(versions.has(`${note!.conversation_id}:${e.applied_revision}`));
    for (const old of z.array(z.object({ snapshot, throughSequence: number }).strict()).parse(JSON.parse(e.context_history_json))) {
      const version = versions.get(`${note!.conversation_id}:${old.snapshot.source?.manuscriptRevision}`);
      check(old.snapshot.conversationId === note!.conversation_id && old.snapshot.parentMessageId === note!.parent_message_id && version && old.snapshot.messages.length === 1 && old.snapshot.messages[0].content === version.content);
    }
  }
  for (const v of data.manuscript_revisions) {
    const source = sources.get(v.conversation_id);
    check(source?.editable && v.revision <= source.revision);
    for (const a of Object.values(storedAnchors.parse(JSON.parse(v.anchors_json)))) check(validRange(a.from, a.to, v.content.length));
  }
  for (const s of data.app_settings) {
    if (s.key === "defaultProvider") z.enum(PROVIDER_KINDS).parse(s.value);
    else if (s.key === "compatibleBaseUrl") { const url = new URL(s.value); check(["http:", "https:"].includes(url.protocol) && !url.username && !url.password); }
    else check(s.value.length <= 200);
  }
}
export function encodeBackup(data: BackupData) {
  const body = { format: "fussenn-backup" as const, version: 3 as const, createdAt: new Date().toISOString(), data };
  const bytes = Buffer.from(JSON.stringify({ ...body, checksum: digest(JSON.stringify(body)) }));
  if (bytes.length > MAX_BACKUP_BYTES) throw new AppError("バックアップは64MBまで対応しています。データ量を減らしてからやり直してください。", 413);
  return bytes;
}
export function decodeBackup(bytes: Uint8Array): BackupFile {
  if (!bytes.length || bytes.length > MAX_BACKUP_BYTES) throw new AppError("64MB以内のFussennバックアップを選んでください。", 413);
  try {
    const raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    const file = envelope.parse(raw);
    if (file.checksum !== digest(JSON.stringify({ format: raw.format, version: raw.version, createdAt: raw.createdAt, data: raw.data }))) throw new Error("checksum");
    validateRelations(file.data);
    return file;
  } catch { throw new AppError("このバックアップは読み込めません。Fussennの対応形式か、ファイルが壊れていないか確認してください。"); }
}
