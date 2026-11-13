import { describe, expect, it } from "vitest";
import { effortLabel, effortMenu, EFFORT_PATTERN, supportsChatOptions } from "@/lib/chat-options";
import { applyStreamEvent } from "@/hooks/use-chat-stream";
import { openDatabase } from "@/server/db";
import { Store } from "@/server/services/store";
import { mainStream, noteStream } from "@/server/services/generation";
import { MockProvider } from "@/server/providers/mock";
import type { GenerationRequest } from "@/server/providers/provider";
import type { Message } from "@/lib/types";

const codexModels = [{ model: "deep", efforts: ["low", "medium", "high", "xhigh"], defaultEffort: "medium" }, { model: "plain", efforts: [], defaultEffort: null }];
describe("effort menu", () => {
  it("offers what a Codex model supports and marks its default", () => {
    expect(effortMenu("codex", "deep", codexModels, "")).toEqual({ value: "medium", choices: [
      { value: "low", label: "低" }, { value: "medium", label: "中（標準）" }, { value: "high", label: "高" }, { value: "xhigh", label: "とても高い" },
    ] });
    expect(effortMenu("codex", "deep", codexModels, "xhigh")?.value).toBe("xhigh");
    // A level the model does not offer falls back to its default instead of failing the question.
    expect(effortMenu("codex", "deep", codexModels, "ultra")?.value).toBe("medium");
    expect(effortMenu("codex", "plain", codexModels, "high")).toBeNull();
    expect(effortMenu("codex", "unlisted", codexModels, "high")).toBeNull();
  });
  it("offers generic levels where models are not listed, and nothing for compatible servers", () => {
    const menu = effortMenu("openai", "any", [], "");
    expect(menu?.value).toBe("");
    expect(menu?.choices.map((choice) => choice.value)).toEqual(["", "low", "medium", "high"]);
    expect(effortMenu("mock", "mock-demo", [], "high")?.value).toBe("high");
    expect(effortMenu("openai", "any", [], "xhigh")?.value).toBe("");
    expect(effortMenu("openai-compatible", "local", [], "high")).toBeNull();
    expect(supportsChatOptions("openai-compatible")).toBe(false);
    expect(supportsChatOptions("codex")).toBe(true);
  });
  it("labels known levels in Japanese and keeps unknown ones readable", () => {
    expect(effortLabel("max")).toBe("最大");
    expect(effortLabel("ultra")).toBe("ウルトラ");
    expect(effortLabel("turbo")).toBe("turbo");
    expect(EFFORT_PATTERN.test("xhigh")).toBe(true);
    for (const bad of ["", "High", "a b", "x".repeat(40), "--"]) expect(EFFORT_PATTERN.test(bad)).toBe(false);
  });
});
describe("chat options in a generation", () => {
  it("passes the effort and web search to the provider and streams progress", async () => {
    const database = openDatabase(":memory:");
    try {
      const store = new Store(database.db);
      const conversation = store.createConversation("mock", "mock-demo");
      const output = await mainStream(store, conversation.id, "[options]", new MockProvider(0), { effort: "high", webSearch: true }).text();
      const events = output.trim().split("\n").map((line) => JSON.parse(line));
      expect(events.filter((event) => event.type === "activity").map((event) => event.activity.kind)).toEqual(["thinking", "searching"]);
      expect(JSON.parse(store.detail(conversation.id).messages[1].content)).toEqual({ effort: "high", webSearch: true });
      // Progress lines are not part of the saved answer.
      expect(store.detail(conversation.id).messages[1].content).not.toContain("searching");
    } finally { database.sqlite.close(); }
  });
  it("never sends the options to an OpenAI-compatible server", async () => {
    const database = openDatabase(":memory:");
    try {
      const store = new Store(database.db);
      store.updateSettings({ compatibleBaseUrl: "http://127.0.0.1:9/v1" });
      const conversation = store.createConversation("openai-compatible", "local-model");
      const seen: GenerationRequest[] = [];
      const provider = { async generate(request: GenerationRequest) { seen.push(request); return { text: "ok" }; } };
      await mainStream(store, conversation.id, "質問", provider, { effort: "high", webSearch: true }).text();
      expect(seen[0]).toMatchObject({ effort: null, webSearch: false });
      const parent = store.mainMessages(conversation.id)[1];
      const note = store.createNote(conversation.id, parent.id, { selectedText: "ok", anchorStart: 0, anchorEnd: 2, anchorPrefix: "", anchorSuffix: "", anchorVersion: 1 }, { x: 10, y: 10 });
      await noteStream(store, note.id, "付箋", provider, { effort: "low", webSearch: true }).text();
      expect(seen[1]).toMatchObject({ effort: null, webSearch: false });
    } finally { database.sqlite.close(); }
  });
});
describe("stopped answers", () => {
  it("keep the session the provider names, and start over otherwise", async () => {
    const database = openDatabase(":memory:");
    try {
      const store = new Store(database.db);
      const conversation = store.createConversation("mock", "mock-demo");
      const answer = (session: string) => ({ async generate() { return { text: "ok", providerSessionId: session }; } });
      const stopped = (session?: string) => ({ async generate(_request: GenerationRequest, emit: (event: { type: "text_delta"; text: string }) => void) {
        emit({ type: "text_delta", text: "途中" });
        throw Object.assign(new DOMException("Aborted", "AbortError"), session ? { providerSessionId: session } : {});
      } });
      await mainStream(store, conversation.id, "一つ目", answer("fussenn2:first")).text();
      await mainStream(store, conversation.id, "二つ目", stopped("fussenn2-web:second")).text();
      expect(store.conversation(conversation.id).providerSessionId).toBe("fussenn2-web:second");
      expect(store.mainMessages(conversation.id).at(-1)).toMatchObject({ content: "途中", status: "error" });
      await mainStream(store, conversation.id, "三つ目", stopped()).text();
      expect(store.conversation(conversation.id).providerSessionId).toBeNull();
    } finally { database.sqlite.close(); }
  });
});
describe("stream events", () => {
  it("leaves messages untouched for progress events", () => {
    const messages: Message[] = [{ id: "a", sequence: 1, role: "assistant", content: "途中", status: "streaming", createdAt: 1, updatedAt: 1 }];
    expect(applyStreamEvent(messages, { type: "activity", activity: { kind: "searching", detail: "q" } })).toBe(messages);
  });
});
