import { expect, test, type APIRequestContext } from "./fixtures";
import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import type { ConversationDetail, SideNote } from "../../src/lib/types";
import { docsImage } from "../fixtures/docs-image";

test.use({ viewport: { width: 1600, height: 1000 } });
const exportLabel = "Obsidian用Markdownを書き出す";
async function setup(request: APIRequestContext) {
  const folder = await (await request.post("/api/folders", { data: { name: "Obsidian用の学習" } })).json();
  const conversation = await (await request.post("/api/conversations", { data: { providerKind: "mock", model: "mock-demo" } })).json();
  await request.patch(`/api/conversations/${conversation.id}`, { data: { title: "MCP / つながりを残す学習ノート", folderId: folder.id } });
  await request.post("/api/chat/main", { data: { ownerId: conversation.id, text: "MCPの知識をObsidianに残したい" } });
  const read = async (): Promise<ConversationDetail> => (await request.get(`/api/conversations/${conversation.id}`)).json();
  const parent = (await read()).messages.find((message) => message.role === "assistant")!;
  const notes: SideNote[] = [];
  for (const [index, text] of ["Resource", "Resource", "Prompt"].entries()) {
    const response = await request.post("/api/notes", { data: { conversationId: conversation.id, parentMessageId: parent.id, selectedText: text,
      anchorStart: 0, anchorEnd: text.length, anchorPrefix: "", anchorSuffix: text === "Resource" ? " — ドキュメントやデータなど、参照できる情報" : " — よく使うやり取りをまとめたテンプレート", anchorVersion: 1, x: index === 0 ? 30 : 980, y: index === 0 ? 170 : 170 + index * 220 } });
    expect(response.status()).toBe(201);
    notes.push(await response.json());
  }
  await request.patch(`/api/notes/${notes[0].id}`, { data: { memo: "保存済みのメモ", color: "yellow" } });
  await request.patch(`/api/notes/${notes[1].id}`, { data: { memo: "収納中にも残しておく情報", color: "blue" } });
  await request.patch(`/api/notes/${notes[1].id}/layout`, { data: { minimized: true } });
  await request.post("/api/chat/note", { data: { ownerId: notes[2].id, text: "質問のひな形を詳しく知りたい" } });
  await request.patch(`/api/notes/${notes[2].id}/layout`, { data: { collapsed: true } });
  const other = await (await request.post("/api/conversations", { data: { providerKind: "mock", model: "mock-demo" } })).json();
  await request.patch(`/api/conversations/${other.id}`, { data: { title: "別の会話の情報は混ぜない" } });
  await request.post("/api/chat/main", { data: { ownerId: other.id, text: "この会話だけの非公開の合言葉" } });
  return { conversation, notes, read };
}

test("downloads linked Markdown with all notes and current memo edits, preserving the workspace and conversation isolation", async ({ page, request }, testInfo) => {
  const { conversation, notes, read } = await setup(request);
  await page.goto(`/?chat=${conversation.id}`);
  const button = page.getByRole("button", { name: exportLabel, exact: true });
  await expect(button).toBeEnabled();
  const before = await read();
  const memo = page.locator(`[data-testid="floating-note"][data-note-id="${notes[0].id}"]`).getByLabel("付箋のメモ", { exact: true });
  // A pending/failed autosave must not cause the export to silently use an older memo.
  await page.route(`**/api/notes/${notes[0].id}`, (route) => route.fulfill({ status: 500, json: { error: "保存を止めて最新メモの取り込みを検証" } }));
  await memo.fill("保存前の最新メモ\n\n**引用元との関係を残す** 📝");
  await page.getByRole("textbox", { name: "メッセージ", exact: true }).fill("まだ送っていない質問");
  const downloading = page.waitForEvent("download");
  await button.click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^Fussenn-MCP.*\.zip$/);
  const archivePath = testInfo.outputPath("obsidian-export.zip");
  await download.saveAs(archivePath);
  const entries = Object.fromEntries(Object.entries(unzipSync(await readFile(archivePath))).map(([name, bytes]) => [name, strFromU8(bytes)]));
  expect(Object.keys(entries)).toHaveLength(5);
  const mainEntry = Object.entries(entries).find(([name]) => name.includes("/会話 - "))!;
  const mainName = mainEntry[0].split("/").at(-1)!.slice(0, -3);
  for (const message of before.messages) expect(mainEntry[1]).toContain(message.content);
  expect(mainEntry[1]).toContain('folder: "Obsidian用の学習"');
  for (const note of before.notes) {
    const entry = Object.entries(entries).find(([name]) => name.endsWith(`${note.id}.md`))!;
    expect(entry).toBeTruthy();
    const noteName = entry[0].split("/").at(-1)!.slice(0, -3);
    expect(mainEntry[1]).toContain(`[[${noteName}|${note.selectedText}]]`);
    expect(entry[1]).toContain(`[[${mainName}#^fussenn-message-${note.parentMessageId}|元の発言へ戻る]]`);
    expect(mainEntry[1]).toContain(` ^fussenn-message-${note.parentMessageId}\n`);
    for (const message of note.messages) expect(entry[1]).toContain(message.content);
  }
  const contents = Object.values(entries).join("\n");
  expect(contents).toContain("保存前の最新メモ\n\n**引用元との関係を残す** 📝");
  expect(contents).toContain("収納中にも残しておく情報");
  expect(contents).not.toMatch(/別の会話の情報は混ぜない|この会話だけの非公開の合言葉|まだ送っていない質問/);
  await expect(page.getByRole("status")).toContainText("フォルダをObsidianの保管庫に入れてください");
  await expect(memo).toHaveValue("保存前の最新メモ\n\n**引用元との関係を残す** 📝");
  await expect(page.getByRole("textbox", { name: "メッセージ", exact: true })).toHaveValue("まだ送っていない質問");
  expect(await read()).toEqual(before);
  await page.unroute(`**/api/notes/${notes[0].id}`);
  await page.locator(".note-save-error").click();
  await expect(page.locator(".note-save-error")).toHaveCount(0);
  await page.screenshot({ path: docsImage("obsidian-export.png") });
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(button).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("status")).toBeInViewport({ ratio: 1 });
  await page.getByRole("button", { name: "書き出しの案内を閉じる", exact: true }).click();
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("disables export before a conversation exists and retries a failed download for an empty conversation", async ({ page, request }, testInfo) => {
  await page.goto("/");
  const button = page.getByRole("button", { name: exportLabel, exact: true });
  await expect(button).toBeDisabled();
  const conversation = await (await request.post("/api/conversations", { data: { providerKind: "mock", model: "mock-demo" } })).json();
  await request.patch(`/api/conversations/${conversation.id}`, { data: { title: "空のObsidianノート" } });
  await page.goto(`/?chat=${conversation.id}`);
  await expect(button).toBeEnabled();
  await page.evaluate(() => {
    const original = URL.createObjectURL;
    let failed = false;
    URL.createObjectURL = function (object) {
      if (!failed) { failed = true; throw new Error("Download failure test"); }
      return original.call(URL, object);
    };
  });
  await button.click();
  await expect(page.locator(".export-notice [role=alert]")).toContainText("もう一度「MD保存」を押してください");
  await expect(button).toBeEnabled();
  const downloading = page.waitForEvent("download");
  await button.focus(); await page.keyboard.press("Enter");
  const download = await downloading;
  const path = testInfo.outputPath("empty-export.zip");
  await download.saveAs(path);
  const files = Object.values(unzipSync(await readFile(path))).map((bytes) => strFromU8(bytes));
  expect(files).toHaveLength(2);
  expect(files.join("\n")).toContain("まだメッセージがありません");
  await expect(page.getByRole("status")).toContainText("空のObsidianノート");
  await expect(page.locator(".export-notice [role=alert]")).toHaveCount(0);
  await expect(button).toBeEnabled();
});

test("exports a large partially generated answer through browser compression without losing Japanese text", async ({ page, request }, testInfo) => {
  const conversation = await (await request.post("/api/conversations", { data: { providerKind: "mock", model: "mock-demo" } })).json();
  await request.patch(`/api/conversations/${conversation.id}`, { data: { title: "長い会話を書き出す" } });
  const content = "```text\n" + "日本語の学習記録とコードを欠けずに書き出す。\n".repeat(5000);
  const now = Date.now();
  await page.route(`**/api/conversations/${conversation.id}`, (route) => route.fulfill({ json: { ...conversation, title: "長い会話を書き出す", notes: [], messages: [
    { id: "large-streaming-message", sequence: 1, role: "assistant", content, status: "streaming", createdAt: now, updatedAt: now },
  ] } }));
  await page.goto(`/?chat=${conversation.id}`);
  const button = page.getByRole("button", { name: exportLabel, exact: true });
  await expect(button).toBeEnabled();
  const downloading = page.waitForEvent("download");
  await button.click();
  const download = await downloading;
  const path = testInfo.outputPath("large-export.zip");
  await download.saveAs(path);
  const files = unzipSync(await readFile(path));
  const main = strFromU8(Object.entries(files).find(([name]) => name.includes("/会話 - "))![1]);
  expect(main).toContain(content);
  expect(main).toContain("書き出し時点で生成中の回答です");
  expect(main.endsWith("```\n\n")).toBe(true);
  await expect(button).toBeEnabled();
  await expect(page.getByRole("status")).toContainText("長い会話を書き出す");
});
