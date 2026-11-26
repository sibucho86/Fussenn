import { expect, test, type Page } from "./fixtures";
import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import type { ConversationDetail, SideNote } from "../../src/lib/types";
import { docsImage } from "../fixtures/docs-image";

test.use({ viewport: { width: 1600, height: 1000 } });
const body = (page: Page) => page.getByRole("textbox", { name: "原稿本文", exact: true });
async function create(page: Page, title: string) {
  await page.goto("/"); await page.getByRole("button", { name: "原稿を書く", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "新しい原稿", exact: true });
  await panel.getByLabel("原稿のタイトル").fill(title);
  const response = page.waitForResponse((r) => r.url().endsWith("/api/manuscripts") && r.request().method() === "POST");
  await panel.getByRole("button", { name: "原稿を作成" }).click();
  const detail: ConversationDetail = await (await response).json();
  await expect(body(page)).toBeVisible(); return detail;
}
async function write(page: Page, text: string) {
  await body(page).click(); await page.keyboard.press("ControlOrMeta+a"); await page.keyboard.insertText(text);
  await expect(body(page)).toContainText(text.split("\n")[0]);
}
async function note(page: Page, id: string, cursor = false) {
  await body(page).click(); await page.keyboard.press(cursor ? "ControlOrMeta+End" : "ControlOrMeta+Home");
  if (!cursor) await page.keyboard.press("Shift+End");
  await page.getByRole("button", { name: "選択箇所・カーソルに付箋" }).click();
  const response = page.waitForResponse((r) => r.url().endsWith(`/api/manuscripts/${id}/notes`));
  await page.getByRole("button", { name: "付箋", exact: true }).click();
  const created: SideNote = await (await response).json();
  await expect(page.locator(`section[data-note-id="${created.id}"]`)).toBeVisible(); return created;
}

test("imports Markdown and text directly into editable manuscripts and preserves their initial versions", async ({ page, request }) => {
  const before = await (await request.get("/api/conversations")).json();
  for (const extension of ["md", "txt"]) {
    await page.goto("/"); await page.getByRole("button", { name: "原稿を書く", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "新しい原稿", exact: true });
    await panel.getByRole("button", { name: "ファイルから取り込む", exact: true }).click();
    const source = "# 書きかけの第一章\r\n\r\n猫は窓辺で眠っていた。\r\n窓の外は雨だった。";
    const chooser = page.waitForEvent("filechooser");
    await panel.getByRole("button", { name: "ファイルを選ぶ", exact: true }).click();
    await (await chooser).setFiles({ name: `書きかけの第一章.${extension}`, mimeType: "text/plain", buffer: Buffer.from("\uFEFF" + source) });
    await expect(panel.getByLabel("原稿のタイトル")).toHaveValue("書きかけの第一章");
    await expect(panel.locator(".document-import-preview")).toContainText("猫は窓辺で眠っていた。");
    if (extension === "md") await page.screenshot({ path: docsImage("manuscript-import.png"), fullPage: true });
    const response = page.waitForResponse((r) => r.url().endsWith("/api/manuscripts") && r.request().method() === "POST");
    await panel.getByRole("button", { name: "原稿として取り込む", exact: true }).click();
    const created: ConversationDetail = await (await response).json();
    expect(created.document).toMatchObject({ editable: true, revision: 1, fileName: `書きかけの第一章.${extension}` });
    expect(created.messages[0].content).toBe(source.replaceAll("\r\n", "\n"));
    await expect(body(page)).toContainText("猫は窓辺で眠っていた。");
    const attached = await note(page, created.id);
    expect(attached.contextSnapshot.messages[0].content).toBe(created.messages[0].content);
    await page.getByTestId("floating-note").getByRole("button", { name: "マーカーにしまう", exact: true }).click();
    await write(page, "取り込んだ原稿を編集した本文。");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByTestId("manuscript-save-state")).toHaveText("保存済み");
    await page.reload(); await expect(body(page)).toContainText("取り込んだ原稿を編集した本文。");
    const versions = await (await request.get(`/api/manuscripts/${created.id}/history`)).json();
    const initial = versions.find((v: { revision: number }) => v.revision === 1);
    expect((await (await request.get(`/api/manuscripts/${created.id}/history/${initial.id}`)).json()).content).toBe(created.messages[0].content);
  }
  expect((await (await request.get("/api/conversations")).json()).length).toBe(before.length + 2);
});

test("validates manuscript imports, supports dropping a file, and keeps the preview on save failure", async ({ page, request }) => {
  await page.goto("/"); await page.getByLabel("メッセージ", { exact: true }).fill("会話の下書きは残す");
  await page.getByRole("button", { name: "原稿を書く", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "新しい原稿", exact: true });
  await panel.getByRole("button", { name: "ファイルから取り込む", exact: true }).click();
  const input = panel.getByLabel("取り込む原稿ファイル"), submit = panel.getByRole("button", { name: "原稿として取り込む", exact: true });
  for (const file of [{ name: "draft.pdf", buffer: Buffer.from("本文"), error: ".md" }, { name: "empty.txt", buffer: Buffer.from(" \n"), error: "本文がありません" }, { name: "encoding.txt", buffer: Buffer.from([0x82, 0xa0]), error: "UTF-8" }, { name: "big.txt", buffer: Buffer.from("a".repeat(1048577)), error: "1MB" }]) {
    await input.setInputFiles({ name: file.name, mimeType: "text/plain", buffer: file.buffer });
    await expect(panel.getByRole("alert")).toContainText(file.error); await expect(submit).toBeDisabled();
  }
  await panel.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect(page.getByLabel("メッセージ", { exact: true })).toHaveValue("会話の下書きは残す");
  await page.getByRole("button", { name: "原稿を書く", exact: true }).click();
  await panel.getByRole("button", { name: "ファイルから取り込む", exact: true }).click();
  await panel.getByLabel("原稿のタイトル").fill("自分で付けたタイトル");
  const transfer = await page.evaluateHandle(() => { const data = new DataTransfer(); data.items.add(new File(["ドロップした原稿。"], "執筆途中.markdown", { type: "text/markdown" })); return data; });
  await panel.locator(".document-drop").dispatchEvent("drop", { dataTransfer: transfer }); await transfer.dispose();
  await expect(panel.locator(".document-import-preview")).toContainText("ドロップした原稿。");
  await expect(panel.getByLabel("原稿のタイトル")).toHaveValue("自分で付けたタイトル");
  await page.route("**/api/manuscripts", (route) => route.fulfill({ status: 500, json: { error: "保存に失敗しました。" } }));
  await submit.click(); await expect(panel.getByRole("alert")).toContainText("保存に失敗");
  await expect(panel.locator(".document-import-preview")).toContainText("ドロップした原稿。");
  await page.unroute("**/api/manuscripts"); await submit.click();
  await expect(body(page)).toContainText("ドロップした原稿。");
  await expect(page.getByRole("heading", { name: "自分で付けたタイトル", exact: true })).toBeVisible();
  const before = await (await request.get("/api/conversations")).json();
  for (const data of [{ title: "無効", file: { fileName: "bad.pdf", content: "本文" } }, { title: "無効", file: { fileName: "bad.txt", content: "a".repeat(100001) } }, { title: "無効", file: { fileName: "bad.txt", content: "\u0000binary" } }, { title: "重複", sourceMessageId: "00000000-0000-4000-8000-000000000001", file: { fileName: "draft.txt", content: "本文" } }]) {
    expect((await request.post("/api/manuscripts", { data })).status()).toBe(400);
  }
  expect((await request.post("/api/manuscripts", { headers: { Origin: "https://example.com" }, data: { title: "外部", file: { fileName: "draft.md", content: "本文" } } })).status()).toBe(403);
  expect(await (await request.get("/api/conversations")).json()).toEqual(before);
  const large = await request.post("/api/manuscripts", { data: { title: "10万文字", file: { fileName: "long.md", content: "あ".repeat(100000) } } });
  expect(large.status()).toBe(201); expect((await large.json()).messages[0].content).toHaveLength(100000);
});

test("writes and merges prose, creates a fresh-context note immediately, exports and restores named history", async ({ page, request }) => {
  await request.patch("/api/settings", { data: { defaultProvider: "mock" } });
  const manuscript = await create(page, "第一章 — 余白から文章を育てる");
  const original = "猫は眠る。\n\n窓の外では雨が降っている。";
  await write(page, original);
  // Create before debounce; the editor must flush the full manuscript first.
  const first = await note(page, manuscript.id);
  expect(first.contextSnapshot.messages[0].content).toBe(original);
  const sticky = page.locator(`section[data-note-id="${first.id}"]`);
  await sticky.getByLabel("付箋のメモ", { exact: true }).fill("[context]");
  await sticky.getByRole("button", { name: "AIに聞く", exact: true }).click();
  await expect(sticky.getByTestId("note-message-assistant")).toContainText("窓の外");
  await expect(sticky.getByRole("button", { name: "原稿案に使う", exact: true })).toBeVisible();
  await sticky.getByRole("button", { name: "原稿案に使う", exact: true }).click();
  const replacement = "猫は窓辺で丸くなり、雨音に耳を傾けていた。";
  await sticky.getByLabel("本文に反映する原稿案").fill(replacement);
  await sticky.getByRole("button", { name: "本文へ反映…", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "本文への反映を確認" });
  await expect(preview.locator("del")).toHaveText("猫は眠る。");
  await expect(preview.locator("ins")).toHaveText(replacement);
  await preview.getByRole("button", { name: "本文に反映する", exact: true }).click();
  await expect(preview).toHaveCount(0); await expect(body(page)).toContainText(replacement);
  await expect(sticky.getByRole("button", { name: "続けて推敲する" })).toBeVisible();
  await sticky.getByRole("button", { name: "マーカーにしまう", exact: true }).click();
  const second = await note(page, manuscript.id);
  expect(second.contextSnapshot.messages[0].content).toBe(original.replace("猫は眠る。", replacement));
  expect(second.contextSnapshot.source?.manuscriptRevision).toBe(3);
  expect((await (await request.get(`/api/conversations/${manuscript.id}`)).json()).notes[0].contextSnapshot.messages[0].content).toBe(original);
  await page.locator(`section[data-note-id="${second.id}"]`).getByRole("button", { name: "マーカーにしまう", exact: true }).click();
  await page.getByRole("button", { name: "履歴", exact: true }).click();
  const history = page.getByRole("dialog", { name: "原稿の履歴" });
  await history.getByLabel("版の名前").fill("初稿完成");
  await history.getByRole("button", { name: "名前を付けて保存" }).click();
  await expect(history.getByRole("button", { name: /初稿完成/ })).toBeVisible();
  await history.getByRole("button", { name: /版 2\s+自動保存/ }).click();
  await history.getByRole("button", { name: "この版を復元" }).click();
  await expect(body(page)).toContainText("猫は眠る。");
  await page.getByRole("button", { name: "履歴", exact: true }).click();
  await history.getByRole("button", { name: /初稿完成/ }).click();
  await history.getByRole("button", { name: "この版を復元" }).click();
  await expect(body(page)).toContainText(replacement);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Obsidian用Markdownを書き出す" }).click();
  const files = unzipSync(new Uint8Array(await readFile((await (await download).path())!)));
  const markdown = Object.values(files).map((file) => strFromU8(file)).join("\n");
  expect(markdown).toContain(replacement); expect(markdown).toContain("## 原稿案");
  await page.reload(); await expect(body(page)).toContainText(replacement);
  await page.getByRole("button", { name: "付箋一覧を開く", exact: true }).click();
  await page.getByTestId("note-index-item").first().click();
  await page.locator(`section[data-note-id="${first.id}"]`).getByRole("button", { name: "原稿案", exact: true }).click();
  await page.screenshot({ path: docsImage("manuscript-editor.png"), fullPage: true });
  await page.locator(`section[data-note-id="${first.id}"]`).getByRole("button", { name: "最新の本文で相談し直す" }).click();
  await expect(page.locator(`section[data-note-id="${first.id}"]`).locator(".note-editor-tools")).toContainText("AI参照：版 6");
  const refreshed: ConversationDetail = await (await request.get(`/api/conversations/${manuscript.id}`)).json();
  expect(refreshed.notes[0].contextSnapshot.messages[0].content).toBe(refreshed.messages[0].content);
});

test("cursor insertion, Japanese composition, immediate navigation save and visible failure without losing text", async ({ page, request }) => {
  const manuscript = await create(page, "入力と復旧");
  await body(page).click();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", { text: "にほんご", selectionStart: 4, selectionEnd: 4 });
  await cdp.send("Input.insertText", { text: "日本語の本文。" });
  await cdp.detach();
  await expect(body(page)).toContainText("日本語の本文。");
  const inserted = await note(page, manuscript.id, true);
  const sticky = page.locator(`section[data-note-id="${inserted.id}"]`);
  await sticky.getByRole("button", { name: "原稿案", exact: true }).click();
  await sticky.getByLabel("本文に反映する原稿案").fill("\n追加した一節。");
  await sticky.getByRole("button", { name: "本文へ反映…" }).click();
  await page.getByRole("dialog", { name: "本文への反映を確認" }).getByRole("button", { name: "本文に反映する" }).click();
  await expect(body(page)).toContainText("追加した一節。");
  await page.route(`**/api/manuscripts/${manuscript.id}`, (route) => route.request().method() === "PATCH" ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "保存テスト失敗" }) }) : route.continue());
  await write(page, "失敗しても残す原稿。");
  await page.locator("button.new-chat").click();
  await expect(body(page)).toContainText("失敗しても残す原稿。");
  await expect(page.getByTestId("manuscript-save-state")).toHaveText("未保存");
  await page.unroute(`**/api/manuscripts/${manuscript.id}`);
  await page.getByRole("button", { name: "保存を再試行", exact: true }).click();
  await expect(page.getByTestId("manuscript-save-state")).toHaveText("保存済み");
  await write(page, "移動する直前に書いた本文。");
  await page.locator("button.new-chat").click();
  await expect(body(page)).toHaveCount(0);
  expect((await (await request.get(`/api/conversations/${manuscript.id}`)).json()).messages[0].content).toBe("移動する直前に書いた本文。");
});

test("stale tabs cannot overwrite a newer manuscript or create notes against old text", async ({ page, request }) => {
  const manuscript = await create(page, "競合を防ぐ");
  await write(page, "最初の本文。"); await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByTestId("manuscript-save-state")).toHaveText("保存済み");
  await request.patch(`/api/manuscripts/${manuscript.id}`, { data: { content: "別画面の最新版。", expected: 2 } });
  await write(page, "手元で編集した案。");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".manuscript-save-error")).toContainText("別の画面");
  await expect(body(page)).toContainText("手元で編集した案。");
  const latest: ConversationDetail = await (await request.get(`/api/conversations/${manuscript.id}`)).json();
  expect(latest.messages[0].content).toBe("別画面の最新版。");
});

test("continues revising the same applied note with the latest AI reference and persists repeated changes", async ({ page, request }) => {
  await request.patch("/api/settings", { data: { defaultProvider: "mock" } });
  const manuscript = await create(page, "同じ付箋で推敲を続ける");
  await write(page, "猫は眠る。\n\n窓の外は雨だった。");
  const first = await note(page, manuscript.id);
  const sticky = page.locator(`section[data-note-id="${first.id}"]`);
  await sticky.getByLabel("付箋のメモ", { exact: true }).fill("最初の相談");
  await sticky.getByRole("button", { name: "AIに聞く", exact: true }).click();
  await sticky.getByRole("button", { name: "原稿案に使う", exact: true }).click();
  async function apply(text: string) {
    await sticky.getByLabel("本文に反映する原稿案").fill(text);
    await sticky.getByRole("button", { name: "本文へ反映…", exact: true }).click();
    await page.getByRole("dialog", { name: "本文への反映を確認" }).getByRole("button", { name: "本文に反映する", exact: true }).click();
    await expect(body(page)).toContainText(text);
    await expect(sticky.getByRole("button", { name: "続けて推敲する", exact: true })).toBeVisible();
  }
  await apply("猫は窓辺で眠る。");
  await sticky.getByRole("button", { name: "続けて推敲する", exact: true }).click();
  await expect(sticky.locator(".note-editor-tools")).toContainText("AI参照：版 3");
  const composer = sticky.getByRole("textbox", { name: "付箋で追加質問" });
  await composer.fill("[context]"); await composer.press("Enter");
  await expect(sticky.getByTestId("note-message-assistant").last()).toContainText("猫は窓辺で眠る。");
  await expect(sticky.getByRole("button", { name: "原稿案に使う", exact: true })).toHaveCount(2);
  await sticky.getByRole("button", { name: "原稿案に使う", exact: true }).last().click();
  await apply("猫は窓辺で目を覚ます。");
  // Asking directly after an apply must also resume with the revised text.
  await sticky.getByRole("button", { name: "相談・メモ", exact: true }).click();
  await composer.fill("[context]"); await composer.press("Enter");
  await expect(sticky.locator(".note-editor-tools")).toContainText("AI参照：版 4");
  await expect(sticky.getByTestId("note-message-assistant").last()).toContainText("猫は窓辺で目を覚ます。");
  await expect(sticky.getByRole("button", { name: "原稿案に使う", exact: true })).toHaveCount(3);
  await sticky.getByRole("button", { name: "原稿案", exact: true }).click();
  await expect(sticky.getByLabel("本文に反映する原稿案")).toHaveValue("猫は窓辺で目を覚ます。");
  await apply("猫は静かに外へ歩き出す。");
  await page.reload();
  await expect(body(page)).toContainText("猫は静かに外へ歩き出す。");
  await sticky.getByRole("button", { name: "続けて推敲する", exact: true }).click();
  await sticky.getByRole("button", { name: "原稿案", exact: true }).click();
  await expect(sticky.getByLabel("本文に反映する原稿案")).toHaveValue("猫は静かに外へ歩き出す。");
  await page.screenshot({ path: docsImage("manuscript-revise.png"), fullPage: true });
  const latest: ConversationDetail = await (await request.get(`/api/conversations/${manuscript.id}`)).json();
  expect(latest.notes).toHaveLength(1);
  expect(latest.notes[0].messages).toHaveLength(6);
  expect(latest.notes[0].manuscript?.contextHistory).toHaveLength(3);
  const history = await (await request.get(`/api/manuscripts/${manuscript.id}/history`)).json();
  expect(history.filter((v: { kind: string }) => v.kind === "apply")).toHaveLength(3);
});

test("offers replacement options in a note and applies the chosen one, with the note AI settings at the top", async ({ page, request }) => {
  await request.patch("/api/settings", { data: { defaultProvider: "mock" } });
  const manuscript = await create(page, "置き換え案を選ぶ");
  await write(page, "ものづくりは、手を動かして考える仕事だ。");
  const bar = page.getByRole("group", { name: "付箋AI", exact: true });
  await expect(bar).toContainText("Mock · デモ · mock-demo");
  await expect(bar.getByRole("combobox", { name: "考える深さ", exact: true })).toBeVisible();
  await expect(bar.getByRole("button", { name: /^Web検索/ })).toBeVisible();
  await expect(bar.getByRole("button", { name: "付箋AIの設定", exact: true })).toBeVisible();
  const barBox = await bar.boundingBox(), editorBox = await body(page).boundingBox();
  expect(barBox!.y).toBeLessThan(editorBox!.y);
  const created = await noteOnFirstWord(page, manuscript.id);
  const sticky = page.locator(`section[data-note-id="${created.id}"]`);
  await sticky.getByLabel("付箋のメモ", { exact: true }).fill("違う言葉に置き換えたい");
  await sticky.getByRole("button", { name: "AIに聞く", exact: true }).click();
  const options = sticky.getByTestId("replacement-option");
  await expect(options).toHaveCount(3);
  await expect(options.locator(".replacement-text")).toHaveText(["手しごと", "創作", "製作"]);
  await expect(sticky.getByTestId("note-message-assistant")).toContainText("迷ったら、最初の案がおすすめです。");
  // An answer with options does not offer its whole text, explanation included, as a draft.
  await expect(sticky.getByRole("button", { name: "原稿案に使う", exact: true })).toHaveCount(0);
  // A draft written by hand comes back when a chosen option is not applied.
  await sticky.getByRole("button", { name: "原稿案", exact: true }).click();
  await sticky.getByLabel("本文に反映する原稿案").fill("自分で考えた言葉");
  await sticky.getByRole("button", { name: "相談・メモ", exact: true }).click();
  await sticky.getByRole("button", { name: "「製作」に置き換える", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "本文への反映を確認", exact: true });
  await expect(dialog.locator("ins")).toHaveText("製作");
  await dialog.getByRole("button", { name: "編集に戻る", exact: true }).click();
  await sticky.getByRole("button", { name: "原稿案", exact: true }).click();
  await expect(sticky.getByLabel("本文に反映する原稿案")).toHaveValue("自分で考えた言葉");
  await sticky.getByRole("button", { name: "相談・メモ", exact: true }).click();
  await sticky.getByRole("button", { name: "「創作」に置き換える", exact: true }).click();
  await expect(dialog.locator("del")).toHaveText("ものづくり");
  await expect(dialog.locator("ins")).toHaveText("創作");
  await dialog.getByRole("button", { name: "本文に反映する", exact: true }).click();
  await expect(body(page)).toContainText("創作は、手を動かして考える仕事だ。");
  await expect(sticky.getByRole("button", { name: /に置き換える$/ })).toHaveCount(0);
  // Another option after continuing; this one goes to the draft to be edited first.
  await sticky.getByRole("button", { name: "続けて推敲する", exact: true }).click();
  await sticky.getByRole("button", { name: "「手しごと」を原稿案で直す", exact: true }).click();
  await expect(sticky.getByLabel("本文に反映する原稿案")).toHaveValue("手しごと");
  await sticky.getByLabel("本文に反映する原稿案").fill("手しごとの仕事");
  await sticky.getByRole("button", { name: "本文へ反映…", exact: true }).click();
  await dialog.getByRole("button", { name: "本文に反映する", exact: true }).click();
  await expect(body(page)).toContainText("手しごとの仕事は、手を動かして考える仕事だ。");
});

test("a new note is larger in proportion at a larger text size, so its controls stay usable", async ({ page, request }) => {
  await page.addInitScript(() => localStorage.setItem("fussenn:text-size", "largest"));
  await request.patch("/api/settings", { data: { defaultProvider: "mock" } });
  const manuscript = await create(page, "大きな文字の付箋");
  await write(page, "ものづくりは、手を動かして考える仕事だ。");
  const created = await noteOnFirstWord(page, manuscript.id);
  const sticky = page.locator(`section[data-note-id="${created.id}"]`);
  const box = (await sticky.locator("..").boundingBox())!;
  expect([Math.round(box.width), Math.round(box.height)]).toEqual([480, 330]);
  await expect.poll(async () => ((await (await request.get(`/api/conversations/${manuscript.id}`)).json()) as ConversationDetail).notes[0].layout).toMatchObject({ width: 480, height: 330 });
  // The memo's footer sits clear of the note's own footer, so its button takes the click.
  await sticky.getByLabel("付箋のメモ", { exact: true }).fill("違う言葉に置き換えたい");
  await sticky.getByRole("button", { name: "AIに聞く", exact: true }).click({ timeout: 5_000 });
  await expect(sticky.getByTestId("replacement-option")).toHaveCount(3);
});

async function noteOnFirstWord(page: Page, id: string) {
  await body(page).click(); await page.keyboard.press("ControlOrMeta+Home");
  for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowRight");
  await page.getByRole("button", { name: "選択箇所・カーソルに付箋" }).click();
  const response = page.waitForResponse((r) => r.url().endsWith(`/api/manuscripts/${id}/notes`));
  await page.getByRole("button", { name: "付箋", exact: true }).click();
  const created: SideNote = await (await response).json();
  expect(created.selectedText).toBe("ものづくり");
  return created;
}
