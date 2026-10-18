import OpenAI from "openai";
import { AppError } from "@/server/errors";
import type { ChatProvider, GenerationEvent, GenerationRequest } from "../provider";

export class OpenAIProvider implements ChatProvider {
  constructor(private client?: OpenAI) {}
  async generate(request: GenerationRequest, emit: (event: GenerationEvent) => void) {
    if (!this.client && !process.env.OPENAI_API_KEY) throw new AppError("OPENAI_API_KEY が設定されていません。");
    // The SDK otherwise follows an inherited OPENAI_BASE_URL meant for another tool,
    // sending this key and the conversation elsewhere. Other servers use the Compatible provider.
    const client = this.client ?? new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: "https://api.openai.com/v1", maxRetries: 0, timeout: 150_000 });
    let text = "";
    let complete = false;
    try {
      const stream = await client.responses.create({ model: request.model, input: request.messages, stream: true, store: false }, { signal: request.signal });
      for await (const event of stream) {
        if (event.type === "response.output_text.delta" || event.type === "response.refusal.delta") {
          text += event.delta; emit({ type: "text_delta", text: event.delta });
        } else if (event.type === "response.completed") {
          complete = true;
        } else if (event.type === "response.failed" || event.type === "response.incomplete" || event.type === "error") {
          throw new AppError("OpenAIの回答を完了できませんでした。モデル・利用枠・入力の長さを確認してください。");
        }
      }
      if (!complete) throw new AppError("AIとの接続が途切れました。もう一度お試しください。");
      return { text };
    } catch (error) {
      if (request.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (error instanceof AppError) throw error;
      if (error instanceof OpenAI.APIError && error.status === 401) throw new AppError("OpenAI APIキーを確認してください。");
      if (error instanceof OpenAI.APIError && error.status === 429) throw new AppError("OpenAIの利用上限に達しました。利用枠を確認するか、時間をおいてお試しください。");
      throw new AppError("OpenAIへ接続できませんでした。APIキー・モデル・ネットワークを確認してください。");
    }
  }
}
