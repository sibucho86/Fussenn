import type { NormalizedMessage } from "@/lib/types";

export type GenerationRequest = {
  ownerType: "conversation" | "side_note"; ownerId: string;
  model: string; messages: NormalizedMessage[]; userText: string;
  providerSessionId?: string | null; signal?: AbortSignal;
};
export type GenerationEvent = { type: "text_delta"; text: string };
export type GenerationResult = { text: string; providerSessionId?: string | null };
export interface ChatProvider {
  generate(request: GenerationRequest, emit: (event: GenerationEvent) => void): Promise<GenerationResult>;
}
