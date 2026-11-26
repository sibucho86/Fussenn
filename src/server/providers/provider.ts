import type { ChatActivity, NormalizedMessage } from "@/lib/types";

export type GenerationRequest = {
  ownerType: "conversation" | "side_note"; ownerId: string;
  model: string; messages: NormalizedMessage[]; userText: string;
  providerSessionId?: string | null; signal?: AbortSignal;
  /** Reasoning effort for this question; null or absent keeps the model's default. */
  effort?: string | null;
  /** Allow the provider's own web search tool for this question. */
  webSearch?: boolean;
  /**
   * Reference data that may have changed since a provider-side session began. A provider that continues such a
   * session sends only the new question, so it sends this with it; `messages` already holds the current data.
   */
  resumeContext?: string;
};
export type GenerationEvent = { type: "text_delta"; text: string } | { type: "activity"; activity: ChatActivity };
export type GenerationResult = { text: string; providerSessionId?: string | null };
export interface ChatProvider {
  generate(request: GenerationRequest, emit: (event: GenerationEvent) => void): Promise<GenerationResult>;
}
