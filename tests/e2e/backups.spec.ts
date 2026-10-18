import { expect, test, type APIRequestContext, type Page } from "./fixtures";
import { readFile } from "node:fs/promises";
import type { ConversationDetail, SideNote } from "../../src/lib/types";
import type { BackupFile } from "../../src/server/services/backup-format";
import { docsImage } from "../fixtures/docs-image";

const panel = (page: Page) => page.getByRole("region", { name: "バックアップと復元" });
const dialog = (page: Page) => page.getByRole("dialog", { name: "バックアップから復元", exact: true });
const backupData = async (request: APIRequestContext) => {
  const response = await request.get("/api/backups/export");
  expect(response.ok()).toBe(true);
  return (await response.json() as BackupFile).data;
};
const select = (page: Page, buffer: Buffer, name = "保管したデータ.fussenn.json") => page.getByLabel("復元するバックアップファイル").setInputFiles({ name, mimeType: "application/json", buffer });

test.beforeEach(async ({ context }) => {
  await context.route("**/api/providers/codex/status", (route) => route.fulfill({ json: { installed: false, signedIn: false, authType: null, plan: null } }));
});

test("downloads and restores all content, returns to the safety copy and protects another tab", async ({ page, context, request }, testInfo) => {
  await request.patch("/api/settings", { data: { defaultProvider: "mock", openaiModel: "saved-api-model" } });
  const folder = await (await request.post("/api/folders", { data: { name: "バックアップで守る資料" } })).json();
  const chat: ConversationDetail = await (await request.post("/api/conversations", { data: { providerKind: "mock", model: "mock-demo" } })).json();
  expect((await request.post("/api/chat/main", { data: { ownerId: chat.id, text: "知識を記録する" } })).ok()).toBe(true);
  await request.patch(`/api/conversations/${chat.id}`, { data: { title: "保存した会話", folderId: folder.id } });
  const document: ConversationDetail = await (await request.post("/api/documents", { data: { fileName: "資料.md", content: "# 設計資料\n\n疲労限度と安全率を考えます。" } })).json();
  await request.patch(`/api/conversations/${document.id}`, { data: { folderId: folder.id } });
  const note: SideNote = await (await request.post("/api/notes", { data: { conversationId: document.id, parentMessageId: document.document!.messageId, selectedText: "疲労限度", anchorStart: 4, anchorEnd: 8, anchorPrefix: "設計資料", anchorSuffix: "と安全率", anchorVersion: 1, x: 700, y: 180 } })).json();
  await request.patch(`/api/notes/${note.id}`, { data: { memo: "大事な設計メモ", color: "blue" } });
  expect((await request.post("/api/chat/note", { data: { ownerId: note.id, text: "詳しく" } })).ok()).toBe(true);
  await request.patch(`/api/notes/${note.id}/layout`, { data: { minimized: true, collapsed: true, width: 390, height: 260, connector: { source: { side: "top", ratio: 0.2, segment: 0 }, target: { side: "left", ratio: 0.4 }, bend: { x: 40, y: -20 } } } });
  const original = await backupData(request);
  await page.goto("/settings");
  await expect(panel(page).locator(".backup-counts")).toBeVisible();
  const downloading = page.waitForEvent("download");
  await panel(page).getByRole("button", { name: "バックアップを保存", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^Fussenn-.*\.fussenn\.json$/);
  const filePath = testInfo.outputPath("saved.fussenn.json"); await download.saveAs(filePath);
  const bytes = await readFile(filePath);
  expect(JSON.parse(bytes.toString()).data).toEqual(original);
  expect(bytes.toString()).not.toContain("provider_session_id");

  await request.patch(`/api/notes/${note.id}`, { data: { memo: "復元直前の新しいメモ", color: "pink" } });
  await request.delete(`/api/conversations/${chat.id}`);
  await request.patch("/api/settings", { data: { openaiModel: "later-api-model" } });
  const later = await backupData(request);
  const other = await context.newPage(); await other.goto("/settings");
  await expect(other.getByLabel("OpenAI Model", { exact: true })).toHaveValue("later-api-model");
  await other.getByLabel("OpenAI Model", { exact: true }).fill("unsaved-tab-draft");
  await select(page, bytes);
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole("row", { name: "会話 0 1", exact: true })).toBeVisible();
  await dialog(page).getByRole("button", { name: "キャンセル", exact: true }).click();
  expect(await backupData(request)).toEqual(later);
  await select(page, bytes);
  // The documentation image shows the confirmation dialog, not the moment the file is still being read.
  await expect(dialog(page).getByRole("row", { name: "会話 0 1", exact: true })).toBeVisible();
  await page.screenshot({ path: docsImage("backup-restore.png") });
  await dialog(page).getByRole("button", { name: "現在の状態を退避して復元", exact: true }).click();
  await expect(panel(page).getByRole("status")).toContainText("バックアップから復元しました");
  expect(await backupData(request)).toEqual(original);
  await expect(page.getByLabel("OpenAI Model", { exact: true })).toHaveValue("saved-api-model");
  await expect(other.locator(".workspace-restored-banner")).toBeVisible();
  await expect(other.getByLabel("OpenAI Model", { exact: true })).toHaveValue("unsaved-tab-draft");
  await other.getByRole("button", { name: "設定を保存", exact: true }).click();
  await expect(other.locator(".settings-content > .settings-error")).toContainText("再読み込み");
  expect((await request.patch(`/api/notes/${note.id}`, { data: { memo: "old-autosave" } })).status()).toBe(409);
  expect((await request.delete(`/api/conversations/${chat.id}`)).status()).toBe(409);
  const restored: ConversationDetail = await (await request.get(`/api/conversations/${document.id}`)).json();
  expect(restored.notes[0]).toMatchObject({ memo: "大事な設計メモ", color: "blue", providerSessionId: null, layout: { minimized: true, collapsed: true, width: 390, connector: { bend: { x: 40, y: -20 } } } });
  expect(restored.document).toEqual(document.document);

  const safetyDownload = page.waitForEvent("download");
  await panel(page).getByRole("button", { name: "ダウンロード", exact: true }).first().click();
  const safetyPath = testInfo.outputPath("automatic.fussenn.json"); await (await safetyDownload).saveAs(safetyPath);
  expect(JSON.parse(await readFile(safetyPath, "utf8")).data).toEqual(later);
  await panel(page).getByRole("button", { name: "この状態に戻す", exact: true }).first().click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole("button", { name: "現在の状態を退避して復元", exact: true }).click();
  await expect(panel(page).getByRole("status")).toContainText("バックアップから復元しました");
  expect(await backupData(request)).toEqual(later);
  await expect(panel(page).locator(".backup-history li")).toHaveCount(2);
  await other.getByRole("button", { name: "再読み込み", exact: true }).click();
  await expect(other.locator(".workspace-restored-banner")).toHaveCount(0);
  await expect(other.getByLabel("OpenAI Model", { exact: true })).toHaveValue("later-api-model");
  await other.getByLabel("OpenAI Model", { exact: true }).fill("new-edit-after-reload");
  await other.getByRole("button", { name: "設定を保存", exact: true }).click();
  await expect(other.getByText("設定を保存しました", { exact: true })).toBeVisible();
});

test("rejects invalid files and lets a failed restoration retry without losing data", async ({ page, request }) => {
  const response = await request.get("/api/backups/export"), bytes = await response.body();
  const original = await backupData(request);
  await page.goto("/settings");
  for (const invalid of [Buffer.from("not a backup"), Buffer.from(bytes.toString().replace('"version":3', '"version":99'))]) {
    await select(page, invalid);
    await expect(panel(page).getByRole("alert")).toContainText("読み込めません");
    await expect(dialog(page)).not.toBeVisible();
  }
  expect(await backupData(request)).toEqual(original);
  await select(page, bytes);
  let completeFailure!: () => void;
  const failure = new Promise<void>((resolve) => { completeFailure = resolve; });
  await page.route("**/api/backups/restore", async (route) => { await failure; await route.fulfill({ status: 500, json: { error: "自動退避できませんでした。復元は行っていません。" } }); }, { times: 1 });
  await dialog(page).getByRole("button", { name: "現在の状態を退避して復元", exact: true }).click();
  await expect(dialog(page).getByRole("button", { name: "復元しています…", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeVisible();
  completeFailure();
  await expect(dialog(page).getByRole("alert")).toContainText("自動退避できません");
  expect(await backupData(request)).toEqual(original);
  await dialog(page).getByRole("button", { name: "現在の状態を退避して復元", exact: true }).click();
  await expect(panel(page).getByRole("status")).toContainText("バックアップから復元しました");
  expect(await backupData(request)).toEqual(original);
});

test("blocks backup and restoration during a live response and rejects cross-site mutations", async ({ request }) => {
  const chat: ConversationDetail = await (await request.post("/api/conversations", { data: { providerKind: "mock", model: "mock-demo" } })).json();
  const bytes = await (await request.get("/api/backups/export")).body();
  const preview = await (await request.post("/api/backups/inspect", { data: bytes })).json();
  expect((await request.post("/api/backups/restore", { data: bytes, headers: { Origin: "https://example.test", "X-Fussenn-Backup-Digest": preview.digest } })).status()).toBe(403);
  const generation = request.post("/api/chat/main", { data: { ownerId: chat.id, text: "長い質問".repeat(800) } });
  await expect.poll(async () => (await (await request.get(`/api/conversations/${chat.id}`)).json()).messages.some((m: { status: string }) => m.status === "streaming")).toBe(true);
  expect((await request.get("/api/backups/export")).status()).toBe(409);
  expect((await request.post("/api/backups/restore", { data: bytes, headers: { "X-Fussenn-Backup-Digest": preview.digest } })).status()).toBe(409);
  expect((await generation).ok()).toBe(true);
  expect((await request.get("/api/backups/export")).ok()).toBe(true);
});

test("persists the daily backup preference and can restore a locally saved periodic copy", async ({ page, request }) => {
  await page.goto("/settings");
  const toggle = panel(page).getByRole("checkbox", { name: "1日1回、自動でバックアップする" });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect.poll(async () => (await (await request.get("/api/backups")).json()).schedule.enabled).toBe(false);
  await page.reload(); await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect.poll(async () => (await (await request.get("/api/backups")).json()).schedule.enabled).toBe(true);
  const saved = await backupData(request);
  await panel(page).getByRole("button", { name: "今すぐPCに保存", exact: true }).click();
  await expect(panel(page).getByRole("status")).toContainText("このPCにバックアップを保存しました");
  const periodic = panel(page).locator(".backup-history li").filter({ hasText: "定期バックアップ" }).first();
  await expect(periodic).toBeVisible();
  await request.post("/api/folders", { data: { name: "定期保存の後に追加" } });
  await periodic.getByRole("button", { name: "この状態に戻す", exact: true }).click();
  await dialog(page).getByRole("button", { name: "現在の状態を退避して復元", exact: true }).click();
  await expect(panel(page).getByRole("status")).toContainText("バックアップから復元しました");
  expect(await backupData(request)).toEqual(saved);
  await expect(toggle).toBeChecked();
});
