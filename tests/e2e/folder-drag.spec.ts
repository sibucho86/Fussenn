import { test, expect, type Page, type APIRequestContext, type Locator } from "./fixtures";
import type { ConversationDetail } from "../../src/lib/types";
import { docsImage } from "../fixtures/docs-image";

async function setup(page: Page, request: APIRequestContext, prefix: string) {
  const c = await (await request.post("/api/conversations", { data: { providerKind: "mock", model: "mock-demo" } })).json();
  await request.post("/api/chat/main", { data: { ownerId: c.id, text: "会話をドラッグして整理する" } });
  await request.patch(`/api/conversations/${c.id}`, { data: { title: `${prefix}・開いている会話` } });
  const other = await (await request.post("/api/conversations", { data: { providerKind: "mock", model: "mock-demo" } })).json();
  await request.patch(`/api/conversations/${other.id}`, { data: { title: `${prefix}・別の会話` } });
  const learning = await (await request.post("/api/folders", { data: { name: `${prefix}・学習` } })).json();
  const work = await (await request.post("/api/folders", { data: { name: `${prefix}・仕事` } })).json();
  await page.goto(`/?chat=${c.id}`);
  const word = page.locator("[data-message-id] strong").filter({ hasText: /^Resource$/ }).first();
  await word.evaluate((element) => {
    const range = document.createRange(); range.selectNodeContents(element);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.getByRole("button", { name: "付箋", exact: true }).click();
  const note = page.getByTestId("floating-note");
  const noteId = await note.getAttribute("data-note-id");
  await request.patch(`/api/notes/${noteId}`, { data: { memo: "会話を移動しても残る付箋", color: "green" } });
  await request.patch(`/api/notes/${noteId}/layout`, { data: { x: 760, y: 180, width: 320, height: 240 } });
  await page.reload();
  await page.getByLabel("メッセージ", { exact: true }).fill("まだ送信していない文章");
  const read = async (): Promise<ConversationDetail> => (await request.get(`/api/conversations/${c.id}`)).json();
  return { c, other, learning, work, read };
}
const source = (page: Page, id: string) => page.locator(`[data-conversation-id="${id}"] .conversation-link`);
const folder = (page: Page, id: string) => page.locator(`[data-folder-id="${id}"]`);
async function hoverDrag(page: Page, from: Locator, to: Locator) {
  await from.scrollIntoViewIfNeeded();
  const start = (await from.boundingBox())!, end = (await to.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + 8, start.y + start.height / 2, { steps: 3 });
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 15 });
  await page.mouse.move(end.x + end.width / 2 + 1, end.y + end.height / 2);
}

test("drags conversations into closed folders, between folders and back to unfiled while preserving the open conversation", async ({ page, request }) => {
  const { c, other, learning, work, read } = await setup(page, request, "ドラッグ");
  const before = await read();
  const learningRegion = folder(page, learning.id), workRegion = folder(page, work.id), unfiled = folder(page, "unfiled");
  await learningRegion.locator(".folder-toggle").click();
  await expect(learningRegion.locator(".folder-toggle")).toHaveAttribute("aria-expanded", "false");
  await hoverDrag(page, source(page, c.id), learningRegion.locator(".folder-toggle"));
  await expect(learningRegion).toHaveClass(/folder-drop-active/);
  await expect(workRegion).toHaveClass(/folder-drop-available/);
  await page.screenshot({ path: docsImage("folder-drag.png") });
  await page.mouse.up();
  await expect(learningRegion.locator(`[data-conversation-id="${c.id}"]`)).toBeVisible();
  await expect(learningRegion.locator(".folder-toggle")).toHaveAttribute("aria-expanded", "true");
  await expect(learningRegion.locator(".folder-toggle small")).toHaveText("1");
  await expect(page).toHaveURL(new RegExp(c.id));
  await expect(page.getByLabel("メッセージ", { exact: true })).toHaveValue("まだ送信していない文章");
  await expect(page.getByLabel("付箋のメモ")).toHaveValue("会話を移動しても残る付箋");
  await expect.poll(async () => (await read()).folderId).toBe(learning.id);
  const saved = await read();
  expect({ ...saved, folderId: before.folderId, updatedAt: before.updatedAt }).toEqual(before);
  // Moving a different conversation must not select it.
  await source(page, other.id).dragTo(workRegion.locator(".folder-toggle"));
  await expect(workRegion.locator(`[data-conversation-id="${other.id}"]`)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(c.id));
  await source(page, c.id).dragTo(workRegion.locator(".folder-toggle"));
  await expect(workRegion.locator(`[data-conversation-id="${c.id}"]`)).toBeVisible();
  await expect(workRegion.locator(".folder-toggle small")).toHaveText("2");
  await page.reload();
  await expect(workRegion.locator(`[data-conversation-id="${c.id}"]`)).toBeVisible();
  await expect(page.getByLabel("付箋のメモ")).toHaveValue("会話を移動しても残る付箋");
  const sameFolder = await read();
  const patches: string[] = [];
  page.on("request", (r) => { if (r.method() === "PATCH" && r.url().endsWith(`/api/conversations/${c.id}`)) patches.push(r.postData()!); });
  await source(page, c.id).dragTo(workRegion.locator(".folder-toggle"));
  expect(patches).toHaveLength(0);
  expect(await read()).toEqual(sameFolder);
  await source(page, c.id).dragTo(unfiled.locator(".unfiled-label"));
  await expect(unfiled.locator(`[data-conversation-id="${c.id}"]`)).toBeVisible();
  await expect.poll(async () => (await read()).folderId).toBeNull();
  expect(patches.map((body) => JSON.parse(body))).toEqual([{ folderId: null }]);
  await page.reload();
  await expect(unfiled.locator(`[data-conversation-id="${c.id}"]`)).toBeVisible();
  const final = await read();
  expect({ ...final, updatedAt: before.updatedAt }).toEqual(before);
});

test("keeps a conversation in place until a move saves, rejects duplicate moves and supports retry after failure", async ({ page, request }) => {
  const { c, learning, read } = await setup(page, request, "再試行");
  const before = await read();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const patches: unknown[] = [];
  await page.route(`**/api/conversations/${c.id}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    patches.push(route.request().postDataJSON());
    if (patches.length === 1) { await gate; return route.fulfill({ status: 500, json: { error: "保存エラー" } }); }
    const response = await route.fetch();
    // A move response must not replace other metadata that may have changed during a generation.
    await route.fulfill({ response, json: { ...await response.json(), title: "古い応答のタイトル", titleEdited: false } });
  });
  const destination = folder(page, learning.id);
  await source(page, c.id).dragTo(destination.locator(".folder-toggle"));
  await expect(page.locator(".sidebar-move-notice")).toContainText("移動しています");
  await expect(folder(page, "unfiled").locator(`[data-conversation-id="${c.id}"]`)).toBeVisible();
  await expect(source(page, c.id)).toHaveAttribute("draggable", "false");
  await expect(page.getByRole("button", { name: `${learning.name}フォルダを編集`, exact: true })).toBeDisabled();
  expect(patches).toEqual([{ folderId: learning.id }]);
  release();
  await expect(page.locator(".sidebar-move-error")).toContainText("元の場所に残っています");
  expect(await read()).toEqual(before);
  await expect(source(page, c.id)).toHaveAttribute("draggable", "true");
  await page.locator(".sidebar-move-error").getByRole("button", { name: "再試行", exact: true }).click();
  await expect(destination.locator(`[data-conversation-id="${c.id}"]`)).toBeVisible();
  await expect(page.locator(".sidebar-move-error")).toHaveCount(0);
  await expect(page.locator(".workspace-header")).toContainText(before.title);
  await expect(source(page, c.id)).toHaveText(before.title);
  await expect(page.getByLabel("メッセージ", { exact: true })).toHaveValue("まだ送信していない文章");
  expect(patches).toEqual([{ folderId: learning.id }, { folderId: learning.id }]);
  const saved = await read();
  expect({ ...saved, folderId: before.folderId, updatedAt: before.updatedAt }).toEqual(before);
});

test("cancels a drag with Escape, ignores unrelated drops and keeps ordinary conversation clicks working", async ({ page, request }) => {
  const { c, other, learning, read } = await setup(page, request, "キャンセル");
  const before = await read(), destination = folder(page, learning.id);
  const patches: string[] = [];
  page.on("request", (r) => { if (r.method() === "PATCH" && r.url().endsWith(`/api/conversations/${c.id}`)) patches.push(r.postData()!); });
  await hoverDrag(page, source(page, c.id), destination.locator(".folder-toggle"));
  await expect(destination).toHaveClass(/folder-drop-active/);
  await page.keyboard.press("Escape"); await page.mouse.up();
  await expect(page.locator(".folder-drop-active")).toHaveCount(0);
  await expect(page.locator(".conversation-dragging")).toHaveCount(0);
  expect(await read()).toEqual(before);
  // A MIME payload by itself, without a local conversation drag, must not trigger a move.
  const transfer = await page.evaluateHandle((id) => { const data = new DataTransfer(); data.setData("application/x-fussenn-conversation", id); data.setData("text/plain", "unrelated text"); return data; }, c.id);
  await destination.dispatchEvent("dragover", { dataTransfer: transfer });
  await destination.dispatchEvent("drop", { dataTransfer: transfer });
  await transfer.dispose();
  expect(patches).toHaveLength(0);
  await expect(page.locator(".folder-drop-active")).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(c.id));
  await source(page, other.id).click();
  await expect(page).toHaveURL(new RegExp(other.id));
  await source(page, c.id).click();
  await expect(page).toHaveURL(new RegExp(c.id));
  expect(await read()).toEqual(before);
});
