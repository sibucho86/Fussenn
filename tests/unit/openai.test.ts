import { afterEach, expect, it, vi } from "vitest";
import OpenAI from "openai";
import { OpenAIProvider } from "@/server/providers/openai";
import { resolveProvider } from "@/server/providers";
import type { GenerationRequest } from "@/server/providers/provider";

const input: GenerationRequest = { ownerType: "conversation", ownerId: "c", model: "user-selected-model", messages: [{ role: "system", content: "instructions" }, { role: "user", content: "hello" }], userText: "hello" };
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("routes OpenAI and streams SDK Responses events with DB-owned history", async () => {
  let body: Record<string, unknown> = {};
  const client = new OpenAI({ apiKey: "test-only", fetch: async (_url, init) => {
    body = JSON.parse(init!.body as string);
    return new Response([
      { type: "response.output_text.delta", delta: "こん" }, { type: "response.output_text.delta", delta: "にちは" }, { type: "response.completed", response: {} },
    ].map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
  } });
  const chunks: string[] = [];
  expect(resolveProvider("openai")).toBeInstanceOf(OpenAIProvider);
  expect(await new OpenAIProvider(client).generate(input, (e) => chunks.push(e.text))).toEqual({ text: "こんにちは" });
  expect(chunks).toEqual(["こん", "にちは"]);
  expect(body).toMatchObject({ model: "user-selected-model", input: input.messages, stream: true, store: false });
  expect(body).not.toHaveProperty("previous_response_id");
});
it("reports missing keys without exposing secrets", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  await expect(new OpenAIProvider().generate(input, () => {})).rejects.toThrow("OPENAI_API_KEY が設定されていません");
});
it("sends the key only to the official endpoint even when OPENAI_BASE_URL is inherited", async () => {
  vi.stubEnv("OPENAI_API_KEY", "test-only");
  vi.stubEnv("OPENAI_BASE_URL", "http://127.0.0.1:9/elsewhere/v1");
  const requests: string[] = [];
  vi.stubGlobal("fetch", async (url: string | URL | Request) => {
    requests.push(String(url instanceof Request ? url.url : url));
    return new Response('data: {"type":"response.completed","response":{}}\n\n', { headers: { "Content-Type": "text/event-stream" } });
  });
  await new OpenAIProvider().generate(input, () => {});
  expect(requests).toEqual(["https://api.openai.com/v1/responses"]);
});
it("treats an incomplete Responses stream as failure", async () => {
  const client = new OpenAI({ apiKey: "test-only", fetch: async () => new Response('data: {"type":"response.output_text.delta","delta":"partial"}\n\n', { headers: { "Content-Type": "text/event-stream" } }) });
  await expect(new OpenAIProvider(client).generate(input, () => {})).rejects.toThrow("接続が途切れ");
});
