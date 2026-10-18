import type { Message, NormalizedMessage } from "@/lib/types";

export const MAIN_INSTRUCTIONS = "You are a helpful assistant for learning and research. Answer directly in the user's language. Use Markdown where helpful. Be clear about uncertainty.";
export function buildMainContext(history: Message[], userText: string): NormalizedMessage[] {
  return [
    { role: "system", content: MAIN_INSTRUCTIONS },
    ...history.filter((m) => m.status === "complete").map(({ role, content }) => ({ role, content })),
    { role: "user", content: userText },
  ];
}
