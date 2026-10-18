import { test, expect, type Page, type APIRequestContext } from "./fixtures";
import type { ConversationDetail } from "../../src/lib/types";
import { docsImage } from "../fixtures/docs-image";

async function selectResource(page: Page) {
  const word = page.locator('[data-message-id] strong').filter({ hasText: /^Resource$/ }).first();
  await word.evaluate((element) => {
    const range = document.createRange(); range.selectNodeContents(element);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.getByRole("button", { name: "付箋", exact: true }).click();
}
async function setup(page: Page, request: APIRequestContext) {
  const created = await (await request.post("/api/conversations", { data: { providerKind: "mock", model: "mock-demo" } })).json();
  await request.post("/api/chat/main", { data: { ownerId: created.id, text: "MCPのマーカーを試す" } });
  await page.goto(`/?chat=${created.id}`);
  await selectResource(page);
  return created.id as string;
}

test("stows collapsed and expanded notes, persists state, and keeps drafts and AI requests alive", async ({ page, request }) => {
  const id = await setup(page, request);
  const note = page.getByTestId("floating-note");
  const noteId = (await note.getAttribute("data-note-id"))!;
  const marker = page.getByTestId("stored-note-marker");
  await note.getByRole("button", { name: "付箋の色を変更" }).click();
  await note.getByRole("button", { name: "ピンク", exact: true }).click();
  await expect(note.getByRole("group", { name: "付箋の色", exact: true })).toBeHidden();
  await note.getByLabel("付箋のメモ").fill("しまう直前に書いたメモ");
  // A rejected layout save must leave the note accessible.
  await page.route(`**/api/notes/${noteId}/layout`, (route) => route.fulfill({ status: 500, json: { error: "test" } }));
  await note.getByRole("button", { name: "マーカーにしまう", exact: true }).click();
  await expect(page.locator(".error-banner")).toContainText("付箋をしまえませんでした");
  await expect(note).toBeVisible();
  await page.unroute(`**/api/notes/${noteId}/layout`);
  await page.getByRole("button", { name: "エラーを閉じる" }).click();
  await note.getByRole("button", { name: "付箋を折りたたむ" }).click();
  const before = (await (await request.get(`/api/conversations/${id}`)).json() as ConversationDetail).notes[0];
  await note.getByRole("button", { name: "マーカーにしまう", exact: true }).click();
  await expect(note).toBeHidden();
  await expect(marker).toBeVisible();
  await expect(marker).toBeFocused();
  await expect(marker).toHaveAttribute("data-note-color", "pink");
  await expect(page.locator(".note-connectors")).toHaveCount(0);
  await page.reload();
  await expect(note).toBeHidden();
  await expect(marker).toBeVisible();
  const saved = (await (await request.get(`/api/conversations/${id}`)).json() as ConversationDetail).notes[0];
  expect(saved).toMatchObject({ memo: "しまう直前に書いたメモ", color: "pink", layout: { minimized: true, x: before.layout.x, y: before.layout.y, width: before.layout.width, height: before.layout.height } });
  // Mouse clicks pass through the marker overlay onto the original text.
  const rect = (await marker.boundingBox())!;
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await expect(note).toBeVisible();
  await expect(note).toBeFocused();
  const position = await note.locator("..").evaluate((element) => {
    const rect = element.getBoundingClientRect(), canvas = element.closest(".conversation-canvas")!.getBoundingClientRect();
    return { x: rect.left - canvas.left, y: rect.top - canvas.top, width: rect.width, height: rect.height };
  });
  expect(position.x).toBeCloseTo(before.layout.x, 0);
  expect(position.y).toBeCloseTo(before.layout.y, 0);
  expect(position.width).toBeCloseTo(before.layout.width, 0);
  expect(position.height).toBeCloseTo(before.layout.height, 0);
  await expect(note.getByLabel("付箋のメモ")).toHaveValue("しまう直前に書いたメモ");
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  await page.route("**/api/chat/note", async (route) => { entered(); await gate; await route.continue(); });
  await note.getByRole("button", { name: "AIに聞く", exact: true }).click();
  await started;
  await note.getByRole("button", { name: "マーカーにしまう", exact: true }).click();
  await expect(note).toBeHidden();
  release();
  await expect.poll(async () => ((await (await request.get(`/api/conversations/${id}`)).json() as ConversationDetail).notes[0].messages.at(-1)?.status)).toBe("complete");
  await marker.focus(); await page.keyboard.press("Enter");
  await expect(note).toBeVisible();
  await expect(note.getByTestId("note-message-assistant")).toContainText("デモ回答");
  await note.getByLabel("付箋で追加質問").fill("まだ送っていない質問");
  await note.getByRole("button", { name: "マーカーにしまう", exact: true }).click();
  await expect(note).toBeHidden();
  await page.locator(".canvas-scroll").evaluate((el) => el.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: docsImage("stored-note.png") });
  await marker.focus(); await page.keyboard.press("Space");
  await expect(note.getByLabel("付箋で追加質問")).toHaveValue("まだ送っていない質問");
  const restored = (await (await request.get(`/api/conversations/${id}`)).json() as ConversationDetail).notes[0];
  expect(restored.layout).toMatchObject({ minimized: false, collapsed: false });
  expect(restored.messages).toHaveLength(2);
  expect(restored.contextSnapshot).toEqual(before.contextSnapshot);
  expect((await request.patch(`/api/notes/${noteId}/layout`, { data: { minimized: "yes" } })).status()).toBe(400);
});

test("keeps marked text selectable and restores overlapping notes from the same marker", async ({ page, request }) => {
  await setup(page, request);
  await page.getByTestId("floating-note").getByRole("button", { name: "マーカーにしまう", exact: true }).click();
  await expect(page.getByTestId("floating-note")).toBeHidden();
  const word = page.locator('[data-message-id] strong').filter({ hasText: /^Resource$/ }).first();
  await word.scrollIntoViewIfNeeded();
  const rect = (await word.boundingBox())!;
  await page.mouse.move(rect.x, rect.y + rect.height / 2);
  await page.mouse.down(); await page.mouse.move(rect.x + rect.width, rect.y + rect.height / 2, { steps: 10 }); await page.mouse.up();
  await expect(page.getByRole("button", { name: "付箋", exact: true })).toBeVisible();
  await expect(page.getByTestId("floating-note")).toBeHidden();
  await page.getByRole("button", { name: "付箋", exact: true }).click();
  await page.getByTestId("floating-note").last().getByRole("button", { name: "マーカーにしまう", exact: true }).click();
  await expect(page.getByTestId("stored-note-marker")).toHaveCount(2);
  const point = (await word.boundingBox())!;
  await page.mouse.click(point.x + point.width / 2, point.y + point.height / 2);
  await expect(page.getByTestId("stored-note-marker")).toHaveCount(0);
  await expect(page.getByTestId("floating-note").first()).toBeVisible();
  await expect(page.getByTestId("floating-note").last()).toBeVisible();
});

test("can recover a stored note when the original text can no longer be located", async ({ page, request }) => {
  const id = await setup(page, request);
  await page.getByTestId("floating-note").getByRole("button", { name: "マーカーにしまう", exact: true }).click();
  await expect(page.getByTestId("floating-note")).toBeHidden();
  await page.route(`**/api/conversations/${id}`, async (route) => {
    const response = await route.fetch();
    const data = await response.json() as ConversationDetail;
    data.notes[0].selectedText = "原文から見つからない文字列";
    await route.fulfill({ response, json: data });
  });
  await page.reload();
  const recovery = page.getByRole("group", { name: "マーカーが見つからない付箋" });
  await expect(recovery).toBeVisible();
  await recovery.getByRole("button", { name: /を開く/ }).click();
  await expect(page.getByTestId("floating-note")).toBeVisible();
  await expect(page.locator(".anchor-missing")).toBeVisible();
  await expect(recovery).toBeHidden();
  await page.unroute(`**/api/conversations/${id}`);
  await page.reload();
  await expect(page.getByTestId("floating-note")).toBeVisible();
});
