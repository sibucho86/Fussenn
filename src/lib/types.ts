import type { NoteColor } from "./note-colors";
import type { ConnectorAdjustment } from "./connector-types";

export const PROVIDER_KINDS = ["codex", "openai", "openai-compatible", "mock"] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];
export type NormalizedMessage = { role: "system" | "user" | "assistant"; content: string };
export type Message = {
  id: string;
  sequence: number;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "complete" | "error";
  createdAt: number;
  updatedAt: number;
};
export type Conversation = {
  id: string;
  title: string;
  titleEdited: boolean;
  folderId: string | null;
  providerKind: ProviderKind;
  model: string;
  providerSessionId: string | null;
  createdAt: number;
  updatedAt: number;
  document: DocumentSource | null;
};
export type DocumentFormat = "markdown" | "text" | "pdf";
export type DocumentSource = { messageId: string; fileName: string; format: DocumentFormat; editable?: boolean; revision?: number };
export type ManuscriptNote = {
  sideNoteId: string; draft: string; draftRevision: number; from: number | null; to: number | null;
  originalText: string; baseRevision: number; appliedRevision: number | null; contextRevision: number;
  historyFrom: number; contextHistory: { snapshot: ContextSnapshot; throughSequence: number }[];
};
export type ManuscriptRevision = { id: string; conversationId: string; revision: number; content: string; label: string; kind: string; createdAt: number; anchors: Record<string, { from: number | null; to: number | null; appliedRevision: number | null }> };
export type ConversationFolder = { id: string; name: string; createdAt: number; updatedAt: number };
export type TextAnchor = {
  selectedText: string;
  anchorStart: number;
  anchorEnd: number;
  anchorPrefix: string;
  anchorSuffix: string;
  anchorVersion: number;
};
export type ContextSnapshot = {
  version: 1;
  conversationId: string;
  parentMessageId: string;
  selectedText: string;
  messages: NormalizedMessage[];
  source?: { kind: "document"; fileName: string; format: DocumentFormat; scope: "full-document"; manuscriptRevision?: number };
};
export type NoteLayout = {
  x: number; y: number; width: number; height: number;
  collapsed: boolean; minimized: boolean; zIndex: number;
  connector: ConnectorAdjustment | null;
};
export type SideNote = TextAnchor & {
  manuscript?: ManuscriptNote | null;
  id: string;
  conversationId: string;
  parentMessageId: string;
  mode: "memo" | "chat";
  memo: string;
  color: NoteColor;
  contextSnapshot: ContextSnapshot;
  providerSessionId: string | null;
  createdAt: number;
  updatedAt: number;
  layout: NoteLayout;
  messages: Message[];
};
export type ConversationDetail = Conversation & { messages: Message[]; notes: SideNote[] };
export type Settings = {
  defaultProvider: ProviderKind;
  codexDefaultModel: string;
  openaiModel: string;
  compatibleBaseUrl: string;
  compatibleModel: string;
};
export type PublicSettings = Settings & {
  mockEnabled: boolean;
  openaiKeyConfigured: boolean;
  compatibleKeyConfigured: boolean;
};
export type StreamEvent =
  | { type: "started"; userMessage: Message; assistantMessage: Message }
  | { type: "text_delta"; text: string }
  | { type: "completed"; messageId: string; text: string }
  | { type: "error"; message: string; messageId?: string };
