import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { CompatibleProvider } from "@/server/providers/openai-compatible";
import { MockProvider } from "@/server/providers/mock";
import { resolveProvider } from "@/server/providers";
import type { Settings } from "@/lib/types";

let server: Server;
let baseURL: string;
let captured: { body: Record<string, unknown>; authorization?: string; url?: string };
beforeEach(async () => {
  server = createServer(async (request, response) => {
    let data = ""; for await (const chunk of request) data += chunk;
    captured = { body: JSON.parse(data), authorization: request.headers.authorization, url: request.url };
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write('data: {"choices":[{"delta":{"content":"local answer"},"finish_reason":null}]}\n\n');
    response.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterEach(async () => { vi.unstubAllEnvs(); await new Promise<void>((resolve) => server.close(() => resolve())); });
it("calls a local OpenAI-compatible server without requiring or sending a key", async () => {
  vi.stubEnv("OPENAI_COMPAT_API_KEY", "");
  const provider = new CompatibleProvider(baseURL);
  const result = await provider.generate({ ownerType: "side_note", ownerId: "note", model: "local-model", messages: [{ role: "user", content: "hello" }], userText: "hello" }, () => {});
  expect(result.text).toBe("local answer");
  expect(captured.url).toBe("/v1/chat/completions");
  expect(captured.authorization).toBeUndefined();
  expect(Object.keys(captured.body).sort()).toEqual(["messages", "model", "stream"]);
});
it("routes compatible and gates the mock provider on its environment switch", () => {
  const settings: Settings = { defaultProvider: "openai-compatible", codexDefaultModel: "", openaiModel: "", compatibleBaseUrl: baseURL, compatibleModel: "local" };
  expect(resolveProvider("openai-compatible", settings)).toBeInstanceOf(CompatibleProvider);
  vi.stubEnv("ENABLE_MOCK_PROVIDER", "false");
  expect(() => resolveProvider("mock")).toThrow();
  vi.stubEnv("ENABLE_MOCK_PROVIDER", "true");
  expect(resolveProvider("mock")).toBeInstanceOf(MockProvider);
});
