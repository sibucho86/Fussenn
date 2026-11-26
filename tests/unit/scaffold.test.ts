import { describe, expect, it } from "vitest";
import { openDatabase } from "@/server/db";
import { MockProvider } from "@/server/providers/mock";

describe("foundation", () => {
  it("initializes all semantic and layout tables with foreign keys", () => {
    const { sqlite } = openDatabase(":memory:");
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).toHaveLength(12);
    sqlite.close();
  });
  it("streams deterministic text without external requests", async () => {
    const chunks: string[] = [];
    const result = await new MockProvider(0).generate({ ownerType: "conversation", ownerId: "test", model: "mock", userText: "MCP", messages: [] }, (e) => { if (e.type === "text_delta") chunks.push(e.text); });
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.join("")).toBe(result.text);
    expect(result.text).toContain("Resource");
  });
});
