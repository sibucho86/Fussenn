import { test, expect } from "./fixtures";
import type { ConversationDetail } from "../../src/lib/types";
import { docsImage } from "../fixtures/docs-image";

test("organizes and renames conversations, retries failed saves, and removes folders without losing notes", async ({ page, request }) => {
  const created = await (await request.post("/api/conversations", { data: { providerKind: "mock", model: "mock-demo" } })).json();
  await request.post("/api/chat/main", { data: { ownerId: created.id, text: "フォルダ整理を試す" } });
  const initial = await (await request.get(`/api/conversations/${created.id}`)).json() as ConversationDetail;
  const parent = initial.messages.find((m) => m.role === "assistant")!;
  await page.goto(`/?chat=${created.id}`);
  const anchor = await page.locator(`[data-message-id="${parent.id}"]`).evaluate((element) => {
    const text = element.textContent!;
    const start = text.indexOf("Resource");
    if (start < 0) throw new Error("Expected Resource in the rendered answer");
    return { selectedText: "Resource", anchorStart: start, anchorEnd: start + 8, anchorPrefix: text.slice(Math.max(0, start - 40), start), anchorSuffix: text.slice(start + 8, start + 48), anchorVersion: 1 };
  });
  const note = await (await request.post("/api/notes", { data: { conversationId: created.id, parentMessageId: parent.id, ...anchor, x: 850, y: 220 } })).json();
  await request.patch(`/api/notes/${note.id}`, { data: { memo: "フォルダを消しても残すメモ", color: "green" } });
  await page.reload();
  const dialog = page.getByRole("dialog");
  const sidebar = page.getByRole("navigation", { name: "会話一覧" });
  const row = sidebar.locator(`[data-conversation-id="${created.id}"]`);
  for (const name of ["学習", "仕事"]) {
    await page.getByRole("button", { name: "フォルダを作成", exact: true }).click();
    await dialog.getByLabel("フォルダ名").fill(name);
    await dialog.getByRole("button", { name: "作成", exact: true }).click();
    await expect(dialog).toBeHidden();
  }
  await row.getByRole("button", { name: /を編集$/ }).click();
  await dialog.getByLabel("会話のタイトル").fill("MCPの学習ノート");
  await dialog.getByLabel("保存先フォルダ").selectOption({ label: "学習" });
  await page.route(`**/api/conversations/${created.id}`, (route) => route.request().method() === "PATCH" ? route.fulfill({ status: 500, json: { error: "保存エラー（テスト）" } }) : route.continue());
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("保存エラー");
  await expect(row).toContainText("フォルダ整理を試す");
  await page.unroute(`**/api/conversations/${created.id}`);
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toBeHidden();
  const learning = sidebar.getByRole("region", { name: "フォルダ: 学習", exact: true });
  await expect(learning.getByRole("button", { name: "MCPの学習ノート", exact: true })).toBeVisible();
  await expect(page.locator(".workspace-header")).toContainText("MCPの学習ノート");
  await learning.getByRole("button", { expanded: true }).click();
  await expect(row).toBeHidden();
  await learning.getByRole("button", { expanded: false }).click();
  await learning.getByRole("button", { name: "学習フォルダを編集" }).click();
  await dialog.getByLabel("フォルダ名").fill("技術学習");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(sidebar.getByRole("region", { name: "フォルダ: 技術学習" }).getByRole("button", { name: "MCPの学習ノート", exact: true })).toBeVisible();
  await expect(page.getByLabel("付箋のメモ")).toHaveValue("フォルダを消しても残すメモ");
  await expect(page.locator(".anchor-missing")).toHaveCount(0);
  await page.locator(".canvas-scroll").evaluate((el) => el.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: docsImage("folders.png") });
  await row.getByRole("button", { name: /を編集$/ }).click();
  await page.screenshot({ path: docsImage("conversation-edit.png") });
  await dialog.getByLabel("保存先フォルダ").selectOption({ label: "仕事" });
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(sidebar.getByRole("region", { name: "フォルダ: 仕事" }).getByRole("button", { name: "MCPの学習ノート", exact: true })).toBeVisible();
  await sidebar.getByRole("button", { name: "仕事フォルダを編集", exact: true }).click();
  await dialog.getByRole("button", { name: "フォルダを削除", exact: true }).click();
  await expect(dialog).toContainText("中の会話・資料・原稿、付箋は残り");
  await dialog.getByRole("button", { name: "フォルダのみ削除", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(sidebar.getByRole("region", { name: "未分類", exact: true }).getByRole("button", { name: "MCPの学習ノート", exact: true })).toBeVisible();
  await page.getByLabel("メッセージ", { exact: true }).fill("もう少し教えて");
  await page.getByRole("button", { name: "送信", exact: true }).click();
  await expect(page.locator('[data-message-id][data-status="complete"]')).toHaveCount(2);
  await page.reload();
  await expect(page.locator(".workspace-header")).toContainText("MCPの学習ノート");
  const saved = await (await request.get(`/api/conversations/${created.id}`)).json() as ConversationDetail;
  expect(saved).toMatchObject({ title: "MCPの学習ノート", titleEdited: true, folderId: null });
  expect(saved.notes[0]).toMatchObject({ memo: "フォルダを消しても残すメモ", color: "green", id: note.id });
  expect(saved.notes[0].contextSnapshot).toEqual(note.contextSnapshot);
  await row.getByRole("button", { name: /を編集$/ }).click();
  await dialog.getByRole("button", { name: "会話を削除", exact: true }).click();
  await dialog.getByRole("button", { name: "戻る", exact: true }).click();
  await expect(dialog.getByLabel("会話のタイトル")).toHaveValue("MCPの学習ノート");
  await dialog.getByRole("button", { name: "会話を削除", exact: true }).click();
  await dialog.getByRole("button", { name: "会話と付箋を削除", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "理解を、余白に。" })).toBeVisible();
  expect((await request.get(`/api/conversations/${created.id}`)).status()).toBe(404);
});

test("validates folder and title changes before writing any metadata", async ({ request }) => {
  const c = await (await request.post("/api/conversations", { data: { providerKind: "mock", model: "mock-demo" } })).json();
  for (const data of [{ title: "   " }, { title: "あ".repeat(101) }, { folderId: "bad-id" }, { titleEdited: false }, {}]) {
    expect((await request.patch(`/api/conversations/${c.id}`, { data })).status()).toBe(400);
  }
  expect((await request.patch(`/api/conversations/${c.id}`, { data: { title: "保存しない", folderId: "00000000-0000-4000-8000-000000000000" } })).status()).toBe(404);
  expect((await request.post("/api/folders", { data: { name: " " } })).status()).toBe(400);
  expect((await request.post("/api/folders", { headers: { Origin: "https://example.com" }, data: { name: "作成しない" } })).status()).toBe(403);
  const unchanged = await (await request.get(`/api/conversations/${c.id}`)).json();
  expect(unchanged).toMatchObject({ title: "新しい会話", titleEdited: false, folderId: null });
});
