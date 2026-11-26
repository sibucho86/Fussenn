import OpenAI from "openai";
import type { ReasoningEffort } from "openai/resources/shared";
import { AppError } from "@/server/errors";
import type { ChatProvider, GenerationEvent, GenerationRequest } from "../provider";

export class OpenAIProvider implements ChatProvider {
  constructor(private client?: OpenAI) {}
  async generate(request: GenerationRequest, emit: (event: GenerationEvent) => void) {
    if (!this.client && !process.env.OPENAI_API_KEY) throw new AppError("OPENAI_API_KEY が設定されていません。");
    // The SDK otherwise follows an inherited OPENAI_BASE_URL meant for another tool,
    // sending this key and the conversation elsewhere. Other servers use the Compatible provider.
    // Reasoning and web search can take minutes; the generation itself has its own limit.
    const client = this.client ?? new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: "https://api.openai.com/v1", maxRetries: 0, timeout: 600_000 });
    let text = "";
    let complete = false;
    // Web results are cited as annotations, which the text itself may not contain.
    const sources = new Map<string, string>();
    const addSources = () => {
      const missing = [...sources].filter(([url]) => !text.includes(url));
      sources.clear();
      if (!missing.length) return;
      const list = `\n\n出典：\n${missing.map(([url, title]) => `- [${title.replace(/[[\]*_`<>]/g, "")}](${url.replace(/[()\s]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`)})`).join("\n")}`;
      text += list; emit({ type: "text_delta", text: list });
    };
    try {
      const stream = await client.responses.create({
        model: request.model, input: request.messages, stream: true, store: false,
        ...(request.effort ? { reasoning: { effort: request.effort as ReasoningEffort } } : {}),
        ...(request.webSearch ? { tools: [{ type: "web_search" as const }] } : {}),
      }, { signal: request.signal });
      for await (const event of stream) {
        if (event.type === "response.output_text.delta" || event.type === "response.refusal.delta") {
          text += event.delta; emit({ type: "text_delta", text: event.delta });
        } else if (event.type === "response.created") {
          emit({ type: "activity", activity: { kind: "thinking" } });
        } else if (event.type === "response.output_item.added" && event.item.type === "reasoning") {
          emit({ type: "activity", activity: { kind: "thinking" } });
        } else if (event.type === "response.web_search_call.searching") {
          emit({ type: "activity", activity: { kind: "searching" } });
        } else if (event.type === "response.output_item.done" && event.item.type === "web_search_call") {
          const action = event.item.action as { query?: unknown; url?: unknown } | undefined;
          if (typeof action?.query === "string" && action.query.trim()) emit({ type: "activity", activity: { kind: "searching", detail: action.query.trim().slice(0, 120) } });
          else if (typeof action?.url === "string") emit({ type: "activity", activity: { kind: "reading", detail: hostName(action.url) } });
        } else if (event.type === "response.output_text.annotation.added") {
          const annotation = event.annotation as { type?: unknown; url?: unknown; title?: unknown } | undefined;
          if (annotation?.type === "url_citation" && typeof annotation.url === "string" && /^https?:\/\//.test(annotation.url) && !sources.has(annotation.url)) {
            sources.set(annotation.url, typeof annotation.title === "string" && annotation.title.trim() ? annotation.title.trim() : hostName(annotation.url) ?? annotation.url);
          }
        } else if (event.type === "response.completed") {
          complete = true;
        } else if (event.type === "response.failed" || event.type === "response.incomplete" || event.type === "error") {
          throw new AppError("OpenAIの回答を完了できませんでした。モデル・利用枠・入力の長さを確認してください。");
        }
      }
      if (!complete) throw new AppError("AIとの接続が途切れました。もう一度お試しください。");
      addSources();
      return { text };
    } catch (error) {
      // A stopped or failed answer keeps the sources received so far with its partial text.
      if (text.trim()) addSources();
      if (request.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (error instanceof AppError) throw error;
      if (error instanceof OpenAI.APIError && error.status === 401) throw new AppError("OpenAI APIキーを確認してください。");
      if (error instanceof OpenAI.APIError && error.status === 429) throw new AppError("OpenAIの利用上限に達しました。利用枠を確認するか、時間をおいてお試しください。");
      if (error instanceof OpenAI.APIError && error.status === 400 && (request.effort || request.webSearch)) throw new AppError("OpenAIがこの質問の設定を受け付けませんでした。モデルが推論の深さやWeb検索に対応しているか確認してください。");
      throw new AppError("OpenAIへ接続できませんでした。APIキー・モデル・ネットワークを確認してください。");
    }
  }
}
function hostName(url: string) {
  try { return new URL(url).hostname; } catch { return undefined; }
}
