import OpenAI from "openai";
import { AppError } from "@/server/errors";
import type { ChatProvider, GenerationEvent, GenerationRequest } from "../provider";

export class CompatibleProvider implements ChatProvider {
  constructor(private baseURL: string, private client?: OpenAI) {}
  async generate(request: GenerationRequest, emit: (event: GenerationEvent) => void) {
    const key = process.env.OPENAI_COMPAT_API_KEY;
    const client = this.client ?? new OpenAI({
      baseURL: this.baseURL, apiKey: key || "local-no-key", organization: null, project: null,
      defaultHeaders: key ? undefined : { Authorization: null }, maxRetries: 0, timeout: 150_000,
    });
    let text = "";
    let complete = false;
    try {
      // Keep the wire format minimal for local servers and third-party providers.
      const stream = await client.chat.completions.create({ model: request.model, messages: request.messages, stream: true }, { signal: request.signal });
      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (choice?.delta.content) { text += choice.delta.content; emit({ type: "text_delta", text: choice.delta.content }); }
        if (choice?.finish_reason) {
          if (choice.finish_reason !== "stop") throw new AppError("回答が途中で終了しました。入力の長さやモデルの設定を確認してください。");
          complete = true;
        }
      }
      if (!complete) throw new AppError("AIとの接続が途切れました。途中までの回答を保存しました。");
      return { text };
    } catch (error) {
      if (request.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (error instanceof AppError) throw error;
      throw new AppError("AI Providerへ接続できませんでした。Base URL / Model / API Keyを確認してください。");
    }
  }
}
