import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "@/server/db";
import { Store } from "@/server/services/store";
import { mainStream, noteStream } from "@/server/services/generation";
import { MockProvider } from "@/server/providers/mock";
import { buildMainContext } from "@/lib/context/main";
import { buildSideNoteContext } from "@/lib/context/side-note";

describe("one-way side-note context", () => {
  let database: ReturnType<typeof openDatabase>;
  let store: Store;
  beforeEach(() => { database = openDatabase(":memory:"); store = new Store(database.db); });
  afterEach(() => database.sqlite.close());
  async function fixture() {
    const c = store.createConversation("mock", "mock-demo");
    await mainStream(store, c.id, "MCPについて教えて", new MockProvider(0)).text();
    const parent = store.mainMessages(c.id)[1];
    const note = store.createNote(c.id, parent.id, { selectedText: "Resource", anchorStart: 8, anchorEnd: 16, anchorPrefix: "", anchorSuffix: "", anchorVersion: 1 }, { x: 480, y: 120 });
    return { c, note, parent };
  }
  it("captures context when the note is created and never refreshes it", async () => {
    const { c, note } = await fixture();
    const original = JSON.stringify(note.contextSnapshot);
    await mainStream(store, c.id, "FUTURE_MAIN_MESSAGE", new MockProvider(0)).text();
    const response = await noteStream(store, note.id, "[context]", new MockProvider(0)).text();
    expect(response).toContain("Resource");
    expect(response).not.toContain("FUTURE_MAIN_MESSAGE");
    expect(JSON.stringify(store.note(note.id).contextSnapshot)).toBe(original);
  });
  it("never includes side-note conversation or memo in main context or another note", async () => {
    const { c, note, parent } = await fixture();
    store.updateNote(note.id, { memo: "PRIVATE_MEMO_TOKEN" });
    await noteStream(store, note.id, "PRIVATE_SIDE_QUESTION", new MockProvider(0)).text();
    await noteStream(store, note.id, "PRIVATE_FOLLOW_UP", new MockProvider(0)).text();
    const main = JSON.stringify(buildMainContext(store.mainMessages(c.id), "next"));
    expect(main).not.toContain("PRIVATE_");
    const output = await mainStream(store, c.id, "[context]", new MockProvider(0)).text();
    expect(output).not.toContain("PRIVATE_");
    const second = store.createNote(c.id, parent.id, { selectedText: "Tool", anchorStart: 0, anchorEnd: 4, anchorPrefix: "", anchorSuffix: "", anchorVersion: 1 }, { x: 0, y: 0 });
    expect(JSON.stringify(second.contextSnapshot)).not.toContain("PRIVATE_");
    const sideContext = JSON.stringify(buildSideNoteContext(note.contextSnapshot, store.noteMessages(note.id), "next"));
    expect(sideContext).toContain("PRIVATE_SIDE_QUESTION");
    expect(sideContext).toContain("PRIVATE_FOLLOW_UP");
    expect(store.mainMessages(c.id)).toHaveLength(4);
  });
  it("keeps layout changes separate from immutable semantic context", async () => {
    const { c, note } = await fixture();
    store.updateLayout(note.id, { x: 50, y: 80, width: 400, height: 300, collapsed: true });
    store.updateNote(note.id, { memo: "remember" });
    expect(store.note(note.id)).toMatchObject({ memo: "remember", contextSnapshot: note.contextSnapshot, layout: { x: 50, y: 80, width: 400, collapsed: true } });
    store.deleteConversation(c.id);
    for (const table of ["side_notes", "side_note_layouts", "side_note_messages"]) expect(database.sqlite.prepare(`SELECT count(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
  });
  it("rejects notes attached to user messages, unfinished messages or another conversation", async () => {
    const { c, note } = await fixture();
    const other = store.createConversation("mock", "mock");
    expect(() => store.createNote(c.id, store.mainMessages(c.id)[0].id, note, { x: 0, y: 0 })).toThrow("AI回答");
    expect(() => store.createNote(other.id, note.parentMessageId, note, { x: 0, y: 0 })).toThrow("AI回答");
  });
});
