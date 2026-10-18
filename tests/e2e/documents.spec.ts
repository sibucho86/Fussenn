import { expect, test, type Page } from "./fixtures";
import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import type { ConversationDetail } from "../../src/lib/types";
import { docsImage } from "../fixtures/docs-image";

test.use({ viewport: { width: 1600, height: 1000 } });
const source = "# 設計資料を読み解く\n\n機械設計では **疲労限度** と **安全率** が重要です。\n\n## 手元の知識を深める\n\n文章の気になる場所に付箋を貼り、元の資料と一緒に残します。\n\n| 用語 | 内容 |\n| --- | --- |\n| 疲労限度 | 繰り返し荷重に対する強さ |\n| 安全率 | 設計上の余裕 |\n\n```typescript\nconst safetyFactor = 2;\n```\n\n資料の最後まで参照できます。END_OF_SOURCE 📝";
const importPanel = (page: Page) => page.getByRole("dialog", { name: "資料を開く", exact: true });
async function importFile(page: Page, name: string, content: string) {
  await page.getByRole("button", { name: /^資料を開く/ }).click();
  await importPanel(page).getByLabel("取り込む資料ファイル").setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(content) });
  const response = page.waitForResponse((response) => response.url().endsWith("/api/documents") && response.request().method() === "POST");
  await importPanel(page).getByRole("button", { name: "資料を取り込む", exact: true }).click();
  const imported = await response;
  expect(imported.status()).toBe(201);
  const document: ConversationDetail = await imported.json();
  await expect(page).toHaveURL(new RegExp(document.id));
  await expect(importPanel(page)).toHaveCount(0);
  await expect(page.getByTestId("document-body")).toBeVisible();
  return document;
}
async function selectInDocument(page: Page, text: string) {
  await page.getByTestId("document-body").evaluate((root, text) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const offset = node.data.indexOf(text);
      if (offset < 0) continue;
      const range = document.createRange(); range.setStart(node, offset); range.setEnd(node, offset + text.length);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      root.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })); return;
    }
    throw new Error("Selection text not found");
  }, text);
  await page.getByRole("button", { name: "付箋", exact: true }).click();
  await expect(page.getByTestId("floating-note")).toHaveCount(1);
}

test("imports Markdown as a document, annotates it, asks AI about its full source and exports the relationships", async ({ page, request }, testInfo) => {
  await page.goto("/");
  const aiRequests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/chat/")) aiRequests.push(request.url()); });
  const document = await importFile(page, "機械設計の資料.md", source);
  expect(aiRequests).toEqual([]);
  await expect(page.getByTestId("document-body").getByRole("heading", { name: "設計資料を読み解く" })).toBeVisible();
  await expect(page.getByTestId("document-body").locator("table")).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "メッセージ", exact: true })).toHaveCount(0);
  await expect(page.locator(".document-metadata")).toContainText("機械設計の資料.md");
  await expect(page.locator(".document-context")).toContainText("全文と選択した箇所");
  expect(await page.locator(".canvas-scroll").evaluate((element) => element.scrollTop)).toBe(0);
  const word = page.getByTestId("document-body").locator("strong").filter({ hasText: "疲労限度" });
  const rect = (await word.boundingBox())!;
  await page.mouse.move(rect.x + 1, rect.y + rect.height / 2); await page.mouse.down(); await page.mouse.move(rect.x + rect.width - 1, rect.y + rect.height / 2, { steps: 12 }); await page.mouse.up();
  await page.getByRole("button", { name: "付箋", exact: true }).click();
  const note = page.getByTestId("floating-note");
  await note.getByLabel("付箋のメモ", { exact: true }).fill("資料から学んだことを残す");
  await note.getByRole("button", { name: "AIに聞く", exact: true }).click();
  await expect(note.getByTestId("note-message-assistant")).toContainText("疲労限度");
  await expect(note.getByRole("button", { name: "追加質問を送信", exact: true })).toBeDisabled();
  await note.getByLabel("付箋で追加質問").fill("[context]");
  await note.getByRole("button", { name: "追加質問を送信", exact: true }).click();
  await expect(note.getByTestId("note-message-assistant").last()).toContainText("IMPORTED DOCUMENT SNAPSHOT");
  await expect(note.getByTestId("note-message-assistant").last()).toContainText("END_OF_SOURCE");
  await expect(note.getByTestId("note-message-assistant").last()).toContainText("機械設計の資料.md");
  await note.getByRole("button", { name: "マーカーにしまう", exact: true }).click();
  await expect(page.getByTestId("floating-note")).toHaveCount(0);
  await expect(page.getByTestId("stored-note-marker")).toHaveCount(1);
  await page.reload();
  await expect(page.getByTestId("stored-note-marker")).toHaveCount(1);
  await page.getByRole("button", { name: "付箋一覧を開く", exact: true }).click();
  const index = page.getByRole("dialog", { name: /^この資料の付箋/ });
  await expect(index.getByTestId("note-index-item")).toHaveCount(1);
  await index.getByTestId("note-index-item").click();
  await expect(note).toBeVisible();
  await note.getByRole("button", { name: "メモへ", exact: true }).click();
  await expect(note.getByLabel("付箋のメモ")).toHaveValue("資料から学んだことを残す");
  await expect(page.locator(".note-connectors")).toHaveCount(1);
  await page.screenshot({ path: docsImage("imported-document.png") });
  const current: ConversationDetail = await (await request.get(`/api/conversations/${document.id}`)).json();
  expect(current.messages).toEqual(document.messages);
  expect(current.notes[0].contextSnapshot.source?.fileName).toBe("機械設計の資料.md");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Obsidian用Markdownを書き出す", exact: true }).click();
  const download = await downloading;
  const path = testInfo.outputPath("document-export.zip"); await download.saveAs(path);
  const files = Object.fromEntries(Object.entries(unzipSync(await readFile(path))).map(([name, value]) => [name, strFromU8(value)]));
  const [mainName, main] = Object.entries(files).find(([name]) => name.includes("/資料 - "))!;
  expect(main).toContain(source);
  expect(main).toContain('source_file: "機械設計の資料.md"');
  const exportedNote = Object.entries(files).find(([name]) => name.includes("/付箋 - "))![1];
  expect(exportedNote).toContain(`[[${mainName.split("/").at(-1)!.slice(0, -3)}#^fussenn-message-${document.document!.messageId}|元の資料へ戻る]]`);
  expect(exportedNote).toContain("資料から学んだことを残す");
});

test("keeps text literal, imports identical filenames independently, and organizes and deletes documents", async ({ page, request }) => {
  await page.goto("/");
  const content = "# 見出しではない\r\n**太字ではない**\r\n<script>window.badImport = true</script>\r\n  [[引用箇所]] 📝\r\n";
  const first = await importFile(page, "会議メモ.txt", content);
  await expect(page.getByTestId("document-body")).toHaveText(content);
  await expect(page.getByTestId("document-body").locator("h1, strong, script, a")).toHaveCount(0);
  await selectInDocument(page, "[[引用箇所]]");
  await page.getByTestId("floating-note").getByLabel("付箋のメモ").fill("最初の資料にだけ付けたメモ");
  await page.getByRole("button", { name: "付箋一覧を開く", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await (await request.get(`/api/conversations/${first.id}`)).json()).notes[0].memo).toBe("最初の資料にだけ付けたメモ");
  const second = await importFile(page, "会議メモ.txt", "別の本文");
  expect(second.id).not.toBe(first.id);
  expect(second.notes).toEqual([]);
  await expect(page.getByTestId("floating-note")).toHaveCount(0);
  const folder = await (await request.post("/api/folders", { data: { name: "取り込んだ資料" } })).json();
  await page.reload();
  const row = page.locator(`[data-conversation-id="${second.id}"]`);
  await row.locator(".conversation-link").dragTo(page.locator(`[data-folder-id="${folder.id}"] .folder-row`));
  await expect(page.locator(`[data-folder-id="${folder.id}"] [data-conversation-id="${second.id}"]`)).toBeVisible();
  await row.getByRole("button", { name: "会議メモを編集", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "資料を編集", exact: true });
  await editor.getByLabel("資料のタイトル", { exact: true }).fill("読み直す議事録");
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".document-heading h1")).toHaveText("読み直す議事録");
  await expect(page.locator(".document-metadata")).toContainText("会議メモ.txt");
  await row.getByRole("button", { name: "読み直す議事録を編集", exact: true }).click();
  await page.getByRole("button", { name: "資料を削除", exact: true }).click();
  await page.getByRole("button", { name: "資料と付箋を削除", exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.locator(`[data-conversation-id="${first.id}"] .conversation-link`).click();
  await expect(page.getByTestId("document-body")).toHaveText(content);
  await expect(page.getByTestId("floating-note").getByLabel("付箋のメモ")).toHaveValue("最初の資料にだけ付けたメモ");
  expect((await request.post("/api/chat/main", { data: { ownerId: first.id, text: "書き換え" } })).status()).toBe(409);
  expect((await request.patch(`/api/conversations/${first.id}`, { data: { content: "書き換え" } })).status()).toBe(400);
  expect((await request.get(`/api/conversations/${second.id}`)).status()).toBe(404);
});

test("validates files, preserves the current draft on cancel, retries failed saves and rejects foreign requests", async ({ page, request }) => {
  await page.goto("/");
  await page.getByLabel("メッセージ", { exact: true }).fill("資料を開く前の下書き");
  await page.getByRole("button", { name: /^資料を開く/ }).click();
  const panel = importPanel(page), input = panel.getByLabel("取り込む資料ファイル");
  const submit = panel.getByRole("button", { name: "資料を取り込む", exact: true });
  for (const file of [{ name: "wrong.docx", buffer: Buffer.from("本文"), error: ".md" }, { name: "empty.txt", buffer: Buffer.from(" \n"), error: "本文がありません" }, { name: "encoding.txt", buffer: Buffer.from([0x82, 0xa0]), error: "UTF-8" }, { name: "big.txt", buffer: Buffer.from("あ".repeat(100001)), error: "10万文字" }]) {
    await input.setInputFiles({ name: file.name, mimeType: "application/octet-stream", buffer: file.buffer });
    await expect(panel.getByRole("alert")).toContainText(file.error);
    await expect(submit).toBeDisabled();
  }
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("メッセージ", { exact: true })).toHaveValue("資料を開く前の下書き");
  await page.getByRole("button", { name: /^資料を開く/ }).click();
  await input.setInputFiles({ name: "保存の再試行.md", mimeType: "text/markdown", buffer: Buffer.from("# 取り込む資料") });
  await page.route("**/api/documents", (route) => route.fulfill({ status: 500, json: { error: "保存に失敗しました。再試行してください。" } }));
  await submit.click();
  await expect(panel.getByRole("alert")).toContainText("保存に失敗");
  await expect(panel.locator(".document-import-preview")).toContainText("保存の再試行.md");
  await page.unroute("**/api/documents");
  await submit.click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId("document-body")).toContainText("取り込む資料");
  const before = await (await request.get("/api/conversations")).json();
  expect((await request.post("/api/documents", { headers: { Origin: "https://example.com" }, data: { fileName: "bad.md", content: "本文" } })).status()).toBe(403);
  for (const data of [{ fileName: "../bad.md", content: "本文" }, { fileName: "bad.md", content: "a".repeat(100001) }, { fileName: "bad.txt", content: "\u0000binary" }, { fileName: "empty.md", content: "  " }]) expect((await request.post("/api/documents", { data })).status()).toBe(400);
  expect(await (await request.get("/api/conversations")).json()).toEqual(before);
});

test("reads without AI configuration, configures note AI and refuses provider changes during generation", async ({ page, request }) => {
  const settings = await (await request.get("/api/settings")).json();
  let document: ConversationDetail;
  try {
    await request.patch("/api/settings", { data: { defaultProvider: "openai", openaiModel: "" } });
    document = await (await request.post("/api/documents", { data: { fileName: "AI未設定の資料.md", content: "# 資料\n\n設定前でも読める資料です。" } })).json();
  } finally { await request.patch("/api/settings", { data: { defaultProvider: settings.defaultProvider, openaiModel: settings.openaiModel } }); }
  await page.goto(`/?chat=${document!.id}`);
  await expect(page.locator(".document-dock")).toContainText("AIは未設定");
  await selectInDocument(page, "設定前でも読める資料");
  const note = page.getByTestId("floating-note");
  await note.getByRole("button", { name: "AIに聞く", exact: true }).click();
  await expect(note.getByRole("alert")).toContainText("モデルを選んでください");
  await note.getByRole("button", { name: "メモへ", exact: true }).click();
  await note.getByLabel("付箋のメモ").fill("AI設定を変えても残すメモ");
  await page.getByRole("button", { name: "付箋AIの設定", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "付箋AIの設定", exact: true });
  await dialog.getByRole("combobox", { name: "付箋のProvider", exact: true }).selectOption("mock");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(note.getByLabel("付箋のメモ")).toHaveValue("AI設定を変えても残すメモ");
  const current: ConversationDetail = await (await request.get(`/api/conversations/${document!.id}`)).json();
  const answering = request.post("/api/chat/note", { data: { ownerId: current.notes[0].id, text: "[context]" } });
  await expect.poll(async () => (await (await request.get(`/api/conversations/${document!.id}`)).json()).notes[0].messages.some((message: { status: string }) => message.status === "streaming")).toBe(true);
  expect((await request.patch(`/api/documents/${document!.id}/provider`, { data: { providerKind: "openai", model: "different-model" } })).status()).toBe(409);
  await answering;
  const finished: ConversationDetail = await (await request.get(`/api/conversations/${document!.id}`)).json();
  expect(finished.providerKind).toBe("mock");
  expect(finished.messages).toEqual(document!.messages);
  expect(finished.notes[0].messages.at(-1)!.content).toContain("IMPORTED DOCUMENT SNAPSHOT");
});
