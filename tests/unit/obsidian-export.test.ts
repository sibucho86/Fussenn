import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { openDatabase } from "@/server/db";
import { Store } from "@/server/services/store";
import { buildObsidianFiles, createObsidianArchive } from "@/lib/obsidian-export";
import type { ConversationDetail } from "@/lib/types";

const exportedAt = new Date("2026-09-10T12:00:00.000Z");
function fixture() {
  const database = openDatabase(":memory:");
  try {
    const store = new Store(database.db);
    const conversation = store.createConversation("mock", "mock-demo");
    store.updateConversation(conversation.id, { title: 'MCP / [[調査]] #1: "リンク" 📝' });
    const pair = store.beginMain(conversation.id, "Resourceについて教えて");
    store.finishMain(conversation.id, pair.assistantMessage.id, "**Resource** は情報です。\n\n| 種類 | 内容 |\n| --- | --- |\n| Tool | 道具 |\n\n```ts\nconst resource = '資料';\n```", "complete", "private-main-session");
    const anchor = { selectedText: "Resource", anchorStart: 0, anchorEnd: 8, anchorPrefix: "", anchorSuffix: " は情報です。", anchorVersion: 1 };
    const note = store.createNote(conversation.id, pair.assistantMessage.id, anchor, { x: 300, y: 80 });
    store.updateNote(note.id, { memo: "# 私の理解\n\n**情報の入口**。\n\n- [x] 確認した", color: "blue" });
    const extra = store.beginNote(note.id, "具体例を教えて");
    store.finishNote(note.id, extra.assistantMessage.id, "ファイルやデータベースの内容です。", "complete", "private-note-session");
    const stored = store.createNote(conversation.id, pair.assistantMessage.id, anchor, { x: 600, y: 80 });
    store.updateLayout(stored.id, { minimized: true });
    const collapsed = store.createNote(conversation.id, pair.assistantMessage.id, { ...anchor, selectedText: "Tool", anchorEnd: 4 }, { x: 600, y: 400 });
    store.updateLayout(collapsed.id, { collapsed: true });
    const detail = store.detail(conversation.id);
    detail.notes[0].contextSnapshot.messages.push({ role: "system", content: "private-context-snapshot" });
    return detail;
  } finally { database.sqlite.close(); }
}
function mainEntry(files: Record<string, string>) { return Object.entries(files).find(([name]) => name.includes("/会話 - "))!; }

function expectLinksResolve(files: Record<string, string>) {
  const markdown = Object.entries(files).filter(([name]) => name.endsWith(".md"));
  const byBasename = new Map(markdown.map(([name, content]) => [name.split("/").at(-1)!.slice(0, -3), content]));
  for (const [, content] of markdown) for (const match of content.replace(/^---\n[\s\S]*?\n---\n/, "").matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
    const [target, block] = match[1].split("#^");
    expect(byBasename.has(target), `Missing file: ${target}`).toBe(true);
    if (block) expect(byBasename.get(target)).toContain(` ^${block}\n`);
  }
}

describe("Obsidian export", () => {
  it("keeps all notes, Markdown and both directions of links without exposing internal context or sessions", () => {
    const detail = fixture();
    const before = structuredClone(detail);
    const { files } = buildObsidianFiles(detail, { folderName: "学習", exportedAt });
    expect(Object.keys(files)).toHaveLength(5);
    const [, main] = mainEntry(files);
    expect(main).toContain(detail.messages[1].content);
    expect(main).toContain('folder: "学習"');
    expect(main).not.toContain("具体例を教えて");
    for (const note of detail.notes) {
      const entry = Object.entries(files).find(([name]) => name.endsWith(`${note.id}.md`))!;
      expect(main).toContain(entry[0].split("/").at(-1)!.slice(0, -3));
      expect(entry[1]).toContain(`> ${note.selectedText}`);
      expect(entry[1]).toContain(`#^fussenn-message-${note.parentMessageId}|元の発言へ戻る`);
      if (note.memo) expect(entry[1]).toContain(note.memo);
      for (const message of note.messages) expect(entry[1]).toContain(message.content);
    }
    expectLinksResolve(files);
    expect(Object.values(files).join("\n")).not.toMatch(/private-main-session|private-note-session|private-context-snapshot|contextSnapshot|providerSessionId/);
    expect(detail).toEqual(before);
  });

  it("creates a UTF-8 ZIP with distinct portable paths for duplicate Japanese titles and safe metadata", async () => {
    const detail = fixture();
    detail.title = 'CON / ..\\[[#^|%%]]\r\n---\n悪いキー: true 😺';
    detail.notes[0].selectedText = '引用 [x] | ^id #見出し\n二行目 **太字**';
    const { archiveName, data } = await createObsidianArchive(detail, { folderName: '学習: "日本語"\n---', exportedAt });
    expect(archiveName).toMatch(/^Fussenn-.*\.zip$/);
    expect(archiveName).not.toMatch(/[<>:"/\\|?*#^\[\]%\r\n]/);
    const entries = Object.fromEntries(Object.entries(unzipSync(data)).map(([path, bytes]) => [path, strFromU8(bytes)]));
    expect(new Set(Object.keys(entries).map((path) => path.toLocaleLowerCase())).size).toBe(5);
    for (const path of Object.keys(entries)) {
      expect(path.split("/")).toHaveLength(2);
      expect(path.split("/")).not.toContain("..");
      expect(path).not.toMatch(/[<>:"\\|?*#^\[\]%\r\n]/);
    }
    const [, main] = mainEntry(entries);
    expect(main).toContain(`title: ${JSON.stringify(detail.title)}\n`);
    expect(main).not.toContain("\n悪いキー: true");
    expect(main).toContain("exported: \"2026-09-10T12:00:00.000Z\"");
    expectLinksResolve(entries);
  });

  it("labels partial and interrupted answers and closes unfinished fences before generated navigation", () => {
    const detail = fixture();
    detail.messages[1] = { ...detail.messages[1], status: "streaming", content: '````ts\nconst example = "```";\n```' };
    detail.messages.push({ ...detail.messages[0], id: "next-message", sequence: 3, content: "次の質問" });
    detail.notes[0].memo = "~~~md\nメモの途中";
    detail.notes[0].messages[1] = { ...detail.notes[0].messages[1], status: "error", content: "" };
    const { files } = buildObsidianFiles(detail, { exportedAt });
    const [, main] = mainEntry(files);
    expect(main).toContain("書き出し時点で生成中の回答です");
    expect(main).toContain('const example = "```";\n```\n````\n\n---\n\n### 発言 3');
    const note = Object.entries(files).find(([name]) => name.endsWith(`${detail.notes[0].id}.md`))![1];
    expect(note).toContain("メモの途中\n~~~\n\n## 付箋内の会話");
    expect(note).toContain("中断された回答です。");
    expect(note).toContain("（本文なし）");
    expectLinksResolve(files);
  });

  it("exports empty conversations and recovers orphaned anchors without emitting broken links", () => {
    const detail = fixture();
    const empty: ConversationDetail = { ...detail, notes: [], messages: [] };
    const emptyExport = buildObsidianFiles(empty, { exportedAt });
    expect(Object.keys(emptyExport.files)).toHaveLength(2);
    expect(mainEntry(emptyExport.files)[1]).toContain("まだメッセージがありません");
    detail.messages = [];
    const orphaned = buildObsidianFiles(detail, { exportedAt });
    expect(Object.values(orphaned.files).join("\n")).toContain("元の発言が見つかりません");
    expectLinksResolve(orphaned.files);
  });

  it("uses different targets for identically titled conversations exported into the same vault", () => {
    const first = fixture(), second = fixture();
    const a = buildObsidianFiles(first, { exportedAt }), b = buildObsidianFiles(second, { exportedAt });
    const names = [...Object.keys(a.files), ...Object.keys(b.files)].filter((path) => path.endsWith(".md")).map((path) => path.split("/").at(-1));
    expect(new Set(names).size).toBe(8);
    expectLinksResolve({ ...a.files, ...b.files });
  });
});
