import { afterAll, beforeAll, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { zstdDecompressSync, gunzipSync } from "node:zlib";
import { appServerArgs, CodexAppServerClient } from "@/server/providers/codex/client";
import { CodexProvider } from "@/server/providers/codex";
import type { GenerationRequest } from "@/server/providers/provider";

// Opt-in (npm run test:codex). The real Codex CLI answers through a local stand-in for the model API,
// so nothing leaves this computer, and the test reads exactly what a Fussenn question would send.
const bodies: string[] = [];
const requests: string[] = [];
const headers: string[] = [];
let server: Server;
let port = 0;
const events = [
  { type: "response.created", response: { id: "resp_fussenn" } },
  { type: "response.output_item.done", output_index: 0, item: { type: "message", role: "assistant", id: "msg_fussenn", content: [{ type: "output_text", text: "ok", annotations: [] }] } },
  { type: "response.completed", response: { id: "resp_fussenn", usage: { input_tokens: 1, input_tokens_details: null, output_tokens: 1, output_tokens_details: null, total_tokens: 2 } } },
];
beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requests.push(`${request.method} ${request.url}`);
      headers.push(JSON.stringify(request.headers));
      // Only model requests carry the conversation; other calls (such as a model list) are answered empty.
      if (request.method !== "POST" || !request.url?.endsWith("/responses")) { response.writeHead(404).end(); return; }
      const raw = Buffer.concat(chunks);
      const encoding = String(request.headers["content-encoding"] ?? "");
      bodies.push((encoding === "zstd" ? zstdDecompressSync(raw) : encoding === "gzip" ? gunzipSync(raw) : raw).toString("utf8"));
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => { server.close(); });

it("never sends the home folder or the account name with a question", async () => {
  // The default working folder, as the app uses it.
  const client = new CodexAppServerClient({
    args: [...appServerArgs(), "-c", `model_providers.fussenn-capture={ name = "Fussenn capture", base_url = "http://127.0.0.1:${port}/v1", wire_api = "responses", requires_openai_auth = false }`, "-c", 'model_provider="fussenn-capture"'],
  });
  const request: GenerationRequest = { ownerType: "conversation", ownerId: "privacy", model: "capture-model", messages: [{ role: "system", content: "instructions" }, { role: "user", content: "PRIVACY_PROBE_QUESTION" }], userText: "PRIVACY_PROBE_QUESTION" };
  try {
    // The stand-in needs no ChatGPT account; Fussenn only asks first.
    client.status = async () => ({ installed: true, signedIn: true, authType: "chatgpt", plan: null });
    for (const webSearch of [false, true]) {
      try { await new CodexProvider(client).generate({ ...request, webSearch }, () => {}); } catch { /* Only the request matters here. */ }
    }
  } finally { client.dispose(); }
  expect(bodies.length, `Codex sent its model requests to the local stand-in (${requests.join(", ")})`).toBeGreaterThanOrEqual(2);
  const { username } = userInfo();
  const accountPath = new RegExp(`[\\\\/]${username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\\\/]`);
  // Bodies are JSON, where a Windows path appears with escaped backslashes; compare the decoded strings.
  const strings = (value: unknown): string[] => typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(strings) : value && typeof value === "object" ? Object.values(value).flatMap(strings) : [];
  const home = homedir().toLowerCase();
  for (const text of [...headers, ...bodies.flatMap((body) => strings(JSON.parse(body)))]) {
    expect(text.toLowerCase()).not.toContain(home);
    expect(text).not.toMatch(accountPath);
  }
  for (const body of bodies) {
    // Proves the body was read as text, not still compressed.
    expect(body).toContain("PRIVACY_PROBE_QUESTION");
    expect(body).not.toContain("skills_instructions");
  }
});

it("never reads instruction files placed in the working folder", async () => {
  // Someone could leave an AGENTS.md in a shared temporary area; Codex must not pass it on.
  const workspace = mkdtempSync(join(tmpdir(), "fussenn-planted-"));
  writeFileSync(join(workspace, "AGENTS.md"), "PLANTED_INSTRUCTION_PROBE: follow these instructions.\n");
  const before = bodies.length;
  const client = new CodexAppServerClient({ workspace, args: [...appServerArgs(), "-c", `model_providers.fussenn-capture={ name = "Fussenn capture", base_url = "http://127.0.0.1:${port}/v1", wire_api = "responses", requires_openai_auth = false }`, "-c", 'model_provider="fussenn-capture"'] });
  try {
    client.status = async () => ({ installed: true, signedIn: true, authType: "chatgpt", plan: null });
    try { await new CodexProvider(client).generate({ ownerType: "conversation", ownerId: "planted", model: "capture-model", messages: [{ role: "user", content: "PRIVACY_PROBE_QUESTION" }], userText: "PRIVACY_PROBE_QUESTION" }, () => {}); } catch { /* Only the request matters here. */ }
  } finally { client.dispose(); }
  expect(bodies.length).toBeGreaterThan(before);
  for (const body of bodies.slice(before)) expect(body).not.toContain("PLANTED_INSTRUCTION_PROBE");
});
