import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "@/server/db";
import { Store } from "@/server/services/store";
import { mainStream } from "@/server/services/generation";
import { MockProvider } from "@/server/providers/mock";
import { buildMainContext } from "@/lib/context/main";
import { readEventStream } from "@/lib/stream/ndjson";
import type { StreamEvent } from "@/lib/types";

describe("main conversation", () => {
  let database: ReturnType<typeof openDatabase>;
  let store: Store;
  beforeEach(() => { database = openDatabase(":memory:"); store = new Store(database.db); });
  afterEach(() => database.sqlite.close());
  it("creates, streams and persists a conversation in order", async () => {
    const c = store.createConversation("mock", "mock-demo");
    const response = mainStream(store, c.id, "MCPについて教えて", new MockProvider(0));
    const events: StreamEvent[] = [];
    await readEventStream(response.body!, (e) => events.push(e));
    expect(events[0].type).toBe("started");
    expect(events.at(-1)?.type).toBe("completed");
    const saved = store.detail(c.id);
    expect(saved.title).toBe("MCPについて教えて");
    expect(saved.messages.map((m) => [m.sequence, m.status])).toEqual([[1, "complete"], [2, "complete"]]);
    expect(saved.messages[1].content).toContain("Resource");
    store.deleteConversation(c.id);
    expect(database.sqlite.prepare("SELECT count(*) AS count FROM messages").get()).toEqual({ count: 0 });
  });
  it("persists partial output and releases generation lock on failure", async () => {
    const c = store.createConversation("mock", "mock-demo");
    const response = mainStream(store, c.id, "hello", { async generate(_r, emit) { emit({ type: "text_delta", text: "partial" }); throw new Error("secret upstream stack"); } });
    const output = await response.text();
    expect(output).not.toContain("secret upstream");
    expect(store.detail(c.id).messages[1]).toMatchObject({ content: "partial", status: "error" });
    const retry = mainStream(store, c.id, "continue", new MockProvider(0));
    await retry.text();
    expect(store.detail(c.id).messages).toHaveLength(4);
  });
  it("rejects simultaneous generation for the same conversation", async () => {
    const c = store.createConversation("mock", "mock-demo");
    let finish!: () => void;
    const response = mainStream(store, c.id, "one", { async generate() { await new Promise<void>((resolve) => { finish = resolve; }); return { text: "done" }; } });
    expect(() => mainStream(store, c.id, "two", new MockProvider(0))).toThrow("生成中");
    finish(); await response.text();
  });
  it("main builder uses complete main messages only", () => {
    const c = store.createConversation("mock", "mock");
    store.beginMain(c.id, "main");
    const context = buildMainContext(store.mainMessages(c.id), "next");
    expect(context.map((m) => m.content)).toEqual([expect.any(String), "main", "next"]);
  });
});
