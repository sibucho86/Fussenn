import { expect, test, type Page, type APIRequestContext } from "./fixtures";
import { docsImage } from "../fixtures/docs-image";

test.use({ viewport: { width: 1600, height: 1000 } });
const editor = (page: Page) => page.getByRole("textbox", { name: "原稿本文", exact: true });
const reading = (page: Page) => page.getByTestId("manuscript-reading");
const modes = (page: Page) => page.getByRole("group", { name: "原稿の表示方法" });
async function open(page: Page, request: APIRequestContext, content: string) {
  const response = await request.post("/api/manuscripts", { data: { title: "第一章　設計の余白", file: { fileName: "第一章.md", content } } });
  expect(response.status()).toBe(201);
  const row = await response.json(); await page.goto(`/?chat=${row.id}`); await expect(editor(page)).toBeVisible(); return row;
}
const manuscript = "# 設計は、問いから始まる\n\n図面を描く前に、**何を実現したいのか**を言葉にする。よい設計は、答えを急がない。\n\n## 余白を残す\n\n最初から全てを決める必要はない。仮説を書き、確かめ、文章を育てていく。\n\n> 迷った理由も、次の設計に役立つ記録になる。\n\n### 確かめたいこと\n\n- 誰が使うのか\n- どこで使うのか\n- [x] 目的を言葉にした\n\n| 項目 | 観察したこと |\n| --- | --- |\n| 操作 | 片手でも扱える |\n| 構造 | 部品を交換できる |\n\n## 手を動かして確かめる\n\n小さな試作で、考えたことと実物の違いが見えてくる。\n\n```md\n# コード例の見出し\n```\n\n![構造の参考図](https://example.com/private.png)\n\n<script>window.previewUnsafe = true</script>";

test("renders live Markdown without remote loads and preserves unsaved text and undo across modes", async ({ page, request }) => {
  const row = await open(page, request, manuscript), external: string[] = [];
  page.on("request", (r) => { if (r.url().startsWith("https://example.com")) external.push(r.url()); });
  await modes(page).getByRole("button", { name: "並べて表示", exact: true }).click();
  await expect(reading(page).getByRole("heading", { level: 1, name: "設計は、問いから始まる" })).toBeVisible();
  await expect(reading(page).locator("strong")).toHaveText("何を実現したいのか");
  await expect(reading(page).locator("blockquote")).toContainText("迷った理由");
  await expect(reading(page).locator("table")).toContainText("片手でも扱える");
  await expect(reading(page).locator("img,script")).toHaveCount(0);
  expect(await page.evaluate(() => "previewUnsafe" in window)).toBe(false); expect(external).toEqual([]);
  await page.screenshot({ path: docsImage("manuscript-preview.png"), fullPage: true });
  await page.route(`**/api/manuscripts/${row.id}`, (route) => route.request().method() === "PATCH" ? route.fulfill({ status: 500, json: { error: "保存の検証エラー" } }) : route.continue());
  await editor(page).click(); await page.keyboard.press("ControlOrMeta+End"); await page.keyboard.insertText("\n\n**未保存の追記🐈**");
  await expect(reading(page).locator("strong").last()).toHaveText("未保存の追記🐈");
  await expect(page.getByTestId("manuscript-save-state")).toContainText("未保存");
  await modes(page).getByRole("button", { name: "プレビュー", exact: true }).click();
  await expect(editor(page)).toBeHidden(); await expect(reading(page)).toContainText("未保存の追記🐈");
  await modes(page).getByRole("button", { name: "編集", exact: true }).click();
  await editor(page).click(); await page.keyboard.press("ControlOrMeta+z");
  await modes(page).getByRole("button", { name: "プレビュー", exact: true }).click();
  await expect(reading(page)).not.toContainText("未保存の追記");
  await page.unroute(`**/api/manuscripts/${row.id}`);
  await page.getByRole("button", { name: "保存を再試行", exact: true }).click();
  expect((await (await request.get(`/api/conversations/${row.id}`)).json()).messages[0].content).toBe(manuscript);
  await page.reload(); await expect(modes(page).getByRole("button", { name: "プレビュー", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(reading(page).locator("strong")).toHaveText("何を実現したいのか");
});

test("navigates a long manuscript using exact heading positions and returns from preview to the right paragraph", async ({ page, request }) => {
  const content = "# 長い原稿\n\n" + ("## 同じ見出し\n\n" + "同じ文章を何度も確かめる。".repeat(80) + "\n\n").repeat(45) + "## 最後の章\n\n最後の段落を編集する。\n\n```md\n# 目次に出ないコード\n```";
  const row = await open(page, request, content);
  await modes(page).getByRole("button", { name: "プレビュー", exact: true }).click();
  await page.locator(".manuscript-outline summary").click();
  const outline = page.getByRole("navigation", { name: "原稿の目次" });
  await expect(outline.getByRole("button", { name: "同じ見出し", exact: true })).toHaveCount(45);
  await expect(outline).not.toContainText("目次に出ないコード");
  await outline.getByRole("button", { name: "最後の章", exact: true }).click();
  const paragraph = reading(page).locator("p").filter({ hasText: /^最後の段落を編集する。$/ });
  await expect(paragraph).toBeInViewport(); await paragraph.dblclick();
  await expect(modes(page).getByRole("button", { name: "編集", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(editor(page)).toBeFocused();
  await page.keyboard.insertText("ここから推敲：");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(async () => (await (await request.get(`/api/conversations/${row.id}`)).json()).messages[0].content).toBe(content.replace("最後の段落", "ここから推敲：最後の段落"));
  await page.setViewportSize({ width: 1024, height: 800 });
  await modes(page).getByRole("button", { name: "並べて表示", exact: true }).click();
  const sourceBox = (await page.locator(".manuscript-source-pane").boundingBox())!, previewBox = (await page.locator(".manuscript-preview-pane").boundingBox())!;
  expect(previewBox.y).toBeGreaterThan(sourceBox.y + sourceBox.height - 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1024);
});

test("keeps note markers and updates the reading preview after applying and restoring prose", async ({ page, request }) => {
  const source = "# 章の見出し\n\n猫は**窓辺**にいる。\n\n次の段落。";
  const row = await open(page, request, source), from = source.indexOf("猫は"), to = source.indexOf("\n\n次");
  const noteResponse = await request.post(`/api/manuscripts/${row.id}/notes`, { data: { expected: 1, from, to, x: 920, y: 240 } });
  expect(noteResponse.status()).toBe(201); const note = await noteResponse.json();
  await page.reload(); await modes(page).getByRole("button", { name: "プレビュー", exact: true }).click();
  await expect(page.getByTestId("anchor-highlight").first()).toBeVisible();
  const sticky = page.locator(`section[data-note-id="${note.id}"]`);
  await sticky.getByRole("button", { name: "原稿案", exact: true }).click();
  await sticky.getByLabel("本文に反映する原稿案").fill("猫は**雨音**を聞いている。");
  await sticky.getByRole("button", { name: "本文へ反映…", exact: true }).click();
  await page.getByRole("dialog", { name: "本文への反映を確認" }).getByRole("button", { name: "本文に反映する", exact: true }).click();
  await expect(reading(page).locator("strong")).toHaveText("雨音");
  await sticky.getByRole("button", { name: "マーカーにしまう", exact: true }).click();
  await expect(page.getByTestId("stored-note-marker")).toBeVisible();
  await page.getByRole("button", { name: "履歴", exact: true }).click();
  const history = page.getByRole("dialog", { name: "原稿の履歴" });
  await history.getByRole("button", { name: /版 1\s/ }).click();
  await history.getByRole("button", { name: "この版を復元", exact: true }).click();
  await expect(reading(page).locator("strong")).toHaveText("窓辺");
  await modes(page).getByRole("button", { name: "編集", exact: true }).click();
  await expect(editor(page)).toContainText("猫は**窓辺**にいる。");
});

test("keeps Japanese composition intact when a preview switch is requested", async ({ page, request }) => {
  await open(page, request, "# 入力の確認\n\n");
  await editor(page).click(); await page.keyboard.press("ControlOrMeta+End");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", { text: "にほんご", selectionStart: 4, selectionEnd: 4 });
  await modes(page).getByRole("button", { name: "プレビュー", exact: true }).click();
  await expect(modes(page).getByRole("button", { name: "編集", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".error-banner[role=alert]")).toContainText("日本語入力を確定");
  await cdp.send("Input.insertText", { text: "日本語の文章🐈" }); await cdp.detach();
  await expect(editor(page)).toContainText("日本語の文章🐈");
  await page.keyboard.press("Home"); await page.keyboard.press("Shift+End");
  await expect(page.getByTestId("manuscript-character-count")).toContainText("選択 7文字");
  await page.getByRole("button", { name: "エラーを閉じる", exact: true }).click();
  await modes(page).getByRole("button", { name: "プレビュー", exact: true }).click();
  await expect(reading(page)).toContainText("日本語の文章🐈");
});

test("follows footnotes and heading links within the preview without leaving the manuscript", async ({ page, request }) => {
  const row = await open(page, request, "# 最初の見出し\n\n記録を残す[^記録]。[結びへ](#結び)。\n\n" + "本文を読み進める。\n\n".repeat(100) + "## 結び\n\n結論の段落。\n\n[^記録]: 観察ノートに残した記録。");
  await modes(page).getByRole("button", { name: "プレビュー", exact: true }).click();
  await reading(page).locator("a[data-footnote-ref]").click();
  const definition = reading(page).locator("section[data-footnotes]");
  await expect(definition).toBeInViewport(); await expect(definition).toContainText("観察ノートに残した記録。");
  await reading(page).locator("a[data-footnote-backref]").click();
  await expect(reading(page).locator("a[data-footnote-ref]")).toBeInViewport();
  await reading(page).getByRole("link", { name: "結びへ", exact: true }).click();
  await expect(reading(page).getByRole("heading", { name: "結び", exact: true })).toBeInViewport();
  await expect(page).toHaveURL(new RegExp(`chat=${row.id}$`));
});
