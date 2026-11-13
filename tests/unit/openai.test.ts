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
  expect(await new OpenAIProvider(client).generate(input, (e) => { if (e.type === "text_delta") chunks.push(e.text); })).toEqual({ text: "こんにちは" });
  expect(chunks).toEqual(["こん", "にちは"]);
  expect(body).toMatchObject({ model: "user-selected-model", input: input.messages, stream: true, store: false });
  expect(body).not.toHaveProperty("previous_response_id");
  expect(body).not.toHaveProperty("reasoning");
  expect(body).not.toHaveProperty("tools");
});
it("adds cited pages that the answer text does not link to", async () => {
  const client = new OpenAI({ apiKey: "test-only", fetch: async () => new Response([
    { type: "response.output_text.delta", delta: "答えです。詳しくは [公式](https://example.test/a)。" },
    { type: "response.output_text.annotation.added", annotation: { type: "url_citation", url: "https://example.test/a", title: "公式" } },
    { type: "response.output_text.annotation.added", annotation: { type: "url_citation", url: "https://example.test/b (2)", title: "別の [資料]" } },
    { type: "response.output_text.annotation.added", annotation: { type: "url_citation", url: "javascript:alert(1)", title: "x" } },
    { type: "response.output_item.done", output_index: 1, item: { type: "web_search_call", id: "ws2", status: "completed", action: { type: "open_page", url: "https://docs.example.test/page" } } },
    { type: "response.completed", response: {} },
  ].map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } }) });
  const events: unknown[] = [];
  const result = await new OpenAIProvider(client).generate({ ...input, webSearch: true }, (e) => events.push(e));
  expect(result.text).toBe("答えです。詳しくは [公式](https://example.test/a)。\n\n出典：\n- [別の 資料](https://example.test/b%20%282%29)");
  expect(events).toContainEqual({ type: "activity", activity: { kind: "reading", detail: "docs.example.test" } });
});
it("keeps the sources received so far when the answer breaks off", async () => {
  const client = new OpenAI({ apiKey: "test-only", fetch: async () => new Response([
    { type: "response.output_text.delta", delta: "途中までの答え" },
    { type: "response.output_text.annotation.added", annotation: { type: "url_citation", url: "https://example.test/c", title: "資料C" } },
  ].map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } }) });
  const texts: string[] = [];
  await expect(new OpenAIProvider(client).generate({ ...input, webSearch: true }, (e) => { if (e.type === "text_delta") texts.push(e.text); })).rejects.toThrow("接続が途切れ");
  expect(texts.join("")).toBe("途中までの答え\n\n出典：\n- [資料C](https://example.test/c)");
});
it("sends the chosen effort and web search, and reports search progress", async () => {
  let body: Record<string, unknown> = {};
  const client = new OpenAI({ apiKey: "test-only", fetch: async (_url, init) => {
    body = JSON.parse(init!.body as string);
    return new Response([
      { type: "response.created", response: {} },
      { type: "response.web_search_call.searching", item_id: "ws1", output_index: 0, sequence_number: 1 },
      { type: "response.output_item.done", output_index: 0, sequence_number: 2, item: { type: "web_search_call", id: "ws1", status: "completed", action: { type: "search", query: "Fussenn release" } } },
      { type: "response.output_text.delta", delta: "答え" }, { type: "response.completed", response: {} },
    ].map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
  } });
  const events: unknown[] = [];
  await new OpenAIProvider(client).generate({ ...input, effort: "high", webSearch: true }, (e) => events.push(e));
  expect(body).toMatchObject({ reasoning: { effort: "high" }, tools: [{ type: "web_search" }] });
  expect(events).toEqual([
    { type: "activity", activity: { kind: "thinking" } },
    { type: "activity", activity: { kind: "searching" } },
    { type: "activity", activity: { kind: "searching", detail: "Fussenn release" } },
    { type: "text_delta", text: "答え" },
  ]);
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
