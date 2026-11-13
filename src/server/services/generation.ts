import type { ChatOptions, Message, ProviderKind, StreamEvent } from "@/lib/types";
import { supportsChatOptions } from "@/lib/chat-options";
import { buildMainContext } from "@/lib/context/main";
import { buildSideNoteContext } from "@/lib/context/side-note";
import { AppError, safeError } from "@/server/errors";
import { resolveProvider } from "@/server/providers";
import type { ChatProvider, GenerationRequest } from "@/server/providers/provider";
import type { Store } from "./store";

const shared = globalThis as typeof globalThis & { fussennGenerations?: Map<string, AbortController> };
export const generations = shared.fussennGenerations ??= new Map();
// Deep reasoning with web search can take several minutes; the user can stop an answer at any time.
export const GENERATION_TIMEOUT_MS = 20 * 60_000;
function chatOptions(kind: ProviderKind, options: Partial<ChatOptions> = {}): ChatOptions {
  return supportsChatOptions(kind) ? { effort: options.effort ?? null, webSearch: options.webSearch === true } : { effort: null, webSearch: false };
}

export function mainStream(store: Store, id: string, text: string, injectedProvider?: ChatProvider, options?: Partial<ChatOptions>) {
  const conversation = store.conversation(id);
  if (conversation.document) throw new AppError("資料の本文は読み取り専用です。付箋から質問してください。", 409);
  const provider = injectedProvider ?? resolveProvider(conversation.providerKind, store.settings());
  return generationStream(`conversation:${id}`, provider, () => {
    const pair = store.beginMain(id, text);
    return {
      ...pair,
      request: { ownerType: "conversation", ownerId: id, model: conversation.model, messages: buildMainContext(pair.history, text), userText: text, providerSessionId: conversation.providerSessionId, ...chatOptions(conversation.providerKind, options) },
      save: (content, status, session) => store.finishMain(id, pair.assistantMessage.id, content, status, session),
    };
  });
}
export function noteStream(store: Store, id: string, text: string, injectedProvider?: ChatProvider, options?: Partial<ChatOptions>) {
  const note = store.note(id);
  const conversation = store.conversation(note.conversationId);
  if (conversation.document && !conversation.model.trim()) throw new AppError("資料の「付箋AIの設定」からモデルを選んでください。", 409);
  const provider = injectedProvider ?? resolveProvider(conversation.providerKind, store.settings());
  return generationStream(`side_note:${id}`, provider, () => {
    const pair = store.beginNote(id, text);
    return {
      ...pair,
      request: { ownerType: "side_note", ownerId: id, model: conversation.model, messages: buildSideNoteContext(note.contextSnapshot, pair.history.filter((m) => m.sequence > (note.manuscript?.historyFrom ?? 0)), text), userText: text, providerSessionId: note.providerSessionId, ...chatOptions(conversation.providerKind, options) },
      save: (content, status, session) => store.finishNote(id, pair.assistantMessage.id, content, status, session),
    };
  });
}
type PreparedGeneration = {
  request: GenerationRequest; userMessage: Message; assistantMessage: Message;
  save: (content: string, status: "complete" | "error", session?: string | null) => void;
};
function generationStream(key: string, provider: ChatProvider, prepare: () => PreparedGeneration) {
  if (generations.has(key)) throw new AppError("この会話では回答を生成中です。", 409);
  const abort = new AbortController();
  generations.set(key, abort);
  let prepared: PreparedGeneration;
  try { prepared = prepare(); } catch (error) { generations.delete(key); throw error; }
  const encoder = new TextEncoder();
  let connected = true;
  return new Response(new ReadableStream({
    async start(controller) {
      const emit = (event: StreamEvent) => { if (connected) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n")); };
      let partial = "";
      const timeout = setTimeout(() => abort.abort(), GENERATION_TIMEOUT_MS);
      try {
        emit({ type: "started", userMessage: prepared.userMessage, assistantMessage: prepared.assistantMessage });
        const result = await provider.generate({ ...prepared.request, signal: abort.signal }, (event) => { if (event.type === "text_delta") partial += event.text; emit(event); });
        if (!result.text.trim()) throw new AppError("AIから文章の回答を受け取れませんでした。もう一度お試しください。");
        prepared.save(result.text, "complete", result.providerSessionId);
        emit({ type: "completed", text: result.text, messageId: prepared.assistantMessage.id });
      } catch (error) {
        // A stopped answer keeps the session the provider names (the thread this question used; it was only interrupted).
        // Otherwise the next question starts a new session from the saved conversation, which then includes this question.
        const stopped = (error as { name?: string } | null)?.name === "AbortError";
        prepared.save(partial, "error", stopped ? (error as { providerSessionId?: string }).providerSessionId ?? null : null);
        emit({ type: "error", message: safeError(error), messageId: prepared.assistantMessage.id });
      } finally {
        clearTimeout(timeout);
        generations.delete(key);
        if (connected) controller.close();
      }
    },
    cancel() { connected = false; abort.abort(); },
  }), { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
