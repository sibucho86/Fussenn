import { expect, test, type Locator, type Page } from "../e2e/fixtures";
import { mkdirSync, readFileSync } from "node:fs";
import type { ConversationDetail, SideNote } from "../../src/lib/types";
import sharp from "sharp";

// Images for the download page (site/), written as WebP to site/images and as PNG to site/og.png.
// Run with npm run site:images. Everything shown is demo data made here: a Markdown document, a
// manuscript and a conversation answered by the Mock provider, in a new, empty data folder.
const out = "site/images";
type Box = { x: number; y: number; width: number; height: number };

async function save(page: Page, name: string, width: number, clip?: Box) {
  const png = await page.screenshot(clip ? { clip } : {});
  mkdirSync(out, { recursive: true });
  await sharp(png).resize({ width, withoutEnlargement: true }).webp({ quality: 82 }).toFile(`${out}/${name}.webp`);
}
// A box around the given elements, widened by a margin, then grown to the given width:height ratio
// (so the page can show the close-ups side by side) and kept on the page.
async function around(page: Page, items: Locator[], margin: number, ratio = 4 / 3): Promise<Box> {
  const boxes = await Promise.all(items.map(async (item) => (await item.boundingBox())!));
  const view = page.viewportSize()!;
  let left = Math.min(...boxes.map((b) => b.x)) - margin, top = Math.min(...boxes.map((b) => b.y)) - margin;
  let width = Math.max(...boxes.map((b) => b.x + b.width)) + margin - left, height = Math.max(...boxes.map((b) => b.y + b.height)) + margin - top;
  if (width / height < ratio) { left -= (height * ratio - width) / 2; width = height * ratio; } else { top -= (width / ratio - height) / 2; height = width / ratio; }
  left = Math.min(Math.max(0, left), view.width - width); top = Math.min(Math.max(0, top), view.height - height);
  return { x: Math.round(left), y: Math.round(top), width: Math.round(width), height: Math.round(height) };
}
// Clears the text selection and focus, so no toolbar or caret shows in the picture.
async function settle(page: Page) {
  await page.evaluate(() => { window.getSelection()?.removeAllRanges(); (document.activeElement as HTMLElement | null)?.blur(); });
}
async function dragNote(page: Page, note: Locator, x: number, y: number) {
  const header = (await note.locator(".note-drag-handle").boundingBox())!;
  await page.mouse.move(header.x + 70, header.y + 20); await page.mouse.down();
  await page.mouse.move(x, y, { steps: 20 }); await page.mouse.up();
}

const documentSource = [
  "# 疲労設計の基礎",
  "",
  "部品は、一度では壊れない小さな荷重でも、何度も繰り返し受けると壊れることがあります。これを **疲労破壊** と呼びます。",
  "",
  "## S-N曲線を読む",
  "",
  "材料に繰り返し応力を与え、壊れるまでの回数との関係を表したものが **S-N曲線** です。鋼では、応力がある値より低いと、実用上は何回繰り返しても壊れなくなります。この値を **疲労限度** と呼びます。",
  "",
  "## 安全率の考え方",
  "",
  "実際の部品には、切り欠きや表面の粗さ、荷重のばらつきがあります。そこで、材料の強さを **安全率** で割った値を、許される応力として設計します。",
  "",
  "| 用語 | 意味 |",
  "| --- | --- |",
  "| 疲労限度 | 繰り返し荷重に耐えられる応力の目安 |",
  "| 安全率 | 不確かさに備えて持たせる余裕の倍率 |",
].join("\n");
const manuscriptSource = "## 朝の駅\n\n朝の駅は、いつもより静かだった。\n\n改札を抜けると、冷たい風がホームを渡っていく。彼女はコートの襟を立てて、まだ来ない電車を待った。";
const revision = "始発を待つ駅は、自分の靴音が遠くまで響くほど静かだった。";

test("takes the download page's screenshots from demo data", async ({ page, request }) => {
  expect((await request.patch("/api/settings", { data: { defaultProvider: "mock" } })).ok()).toBe(true);

  // A Markdown document with a note in the margin.
  await page.goto("/");
  await page.getByRole("button", { name: /^資料を開く/ }).click();
  const importPanel = page.getByRole("dialog", { name: "資料を開く", exact: true });
  await importPanel.getByLabel("取り込む資料ファイル").setInputFiles({ name: "疲労設計の基礎.md", mimeType: "text/plain", buffer: Buffer.from(documentSource) });
  await importPanel.getByRole("button", { name: "資料を取り込む", exact: true }).click();
  await expect(page.getByTestId("document-body")).toBeVisible();
  await page.getByTestId("document-body").evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (node.data !== "疲労限度" || node.parentElement?.tagName !== "STRONG") continue;
      const range = document.createRange(); range.selectNodeContents(node);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      root.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })); return;
    }
    throw new Error("The word to annotate was not found.");
  });
  await page.getByRole("button", { name: "付箋", exact: true }).click();
  const documentNote = page.getByTestId("floating-note");
  await expect(documentNote).toHaveCount(1);
  await documentNote.getByLabel("付箋のメモ", { exact: true }).fill("アルミ合金にも疲労限度はある？　次の設計レビューで確認する");
  // Beside the table, where the note covers no text.
  await dragNote(page, documentNote, 1150, 720);
  await settle(page);
  await expect(page.getByTestId("anchor-highlight").first()).toBeVisible();
  await save(page, "documents", 2000);

  // A manuscript: a note's draft goes back into the text after a look at the difference.
  await page.getByRole("button", { name: "原稿を書く", exact: true }).click();
  const newManuscript = page.getByRole("dialog", { name: "新しい原稿", exact: true });
  await newManuscript.getByLabel("原稿のタイトル").fill("短編「始発」");
  const created = page.waitForResponse((r) => r.url().endsWith("/api/manuscripts") && r.request().method() === "POST");
  await newManuscript.getByRole("button", { name: "原稿を作成" }).click();
  const manuscript: ConversationDetail = await (await created).json();
  const body = page.getByRole("textbox", { name: "原稿本文", exact: true });
  await expect(body).toBeVisible();
  await body.click(); await page.keyboard.press("ControlOrMeta+a"); await page.keyboard.insertText(manuscriptSource);
  await expect(body).toContainText("朝の駅は");
  await page.keyboard.press("ControlOrMeta+Home"); await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Home"); await page.keyboard.press("Shift+End");
  await page.getByRole("button", { name: "選択箇所・カーソルに付箋" }).click();
  const noteCreated = page.waitForResponse((r) => r.url().endsWith(`/api/manuscripts/${manuscript.id}/notes`));
  await page.getByRole("button", { name: "付箋", exact: true }).click();
  const manuscriptNote: SideNote = await (await noteCreated).json();
  const sticky = page.locator(`section[data-note-id="${manuscriptNote.id}"]`);
  await expect(sticky).toBeVisible();
  await sticky.getByLabel("付箋のメモ", { exact: true }).fill("静けさが伝わる描写にしたい");
  await sticky.getByRole("button", { name: "原稿案", exact: true }).click();
  await sticky.getByLabel("本文に反映する原稿案").fill(revision);
  await sticky.getByRole("button", { name: "本文へ反映…", exact: true }).click();
  const reflect = page.getByRole("dialog", { name: "本文への反映を確認" });
  await expect(reflect.locator("ins")).toHaveText(revision);
  await save(page, "step-reflect", 1200, await around(page, [reflect], 24));
  await reflect.getByRole("button", { name: "本文に反映する", exact: true }).click();
  await expect(body).toContainText(revision);
  await page.getByRole("button", { name: "並べて表示", exact: true }).click();
  await expect(page.getByRole("button", { name: "並べて表示", exact: true })).toHaveAttribute("aria-pressed", "true");
  await settle(page);
  await save(page, "manuscript", 2000);

  // A conversation: select a word in the answer, attach a note and ask about it.
  await page.goto("/");
  await page.getByLabel("メッセージ", { exact: true }).fill("MCPについて、全体像から教えて");
  await page.getByRole("button", { name: "送信", exact: true }).click();
  const answer = page.locator('[data-message-id][data-status="complete"]').first();
  await expect(answer).toBeVisible();
  const word = answer.locator("strong").filter({ hasText: /^Resource$/ });
  await word.scrollIntoViewIfNeeded();
  const rect = (await word.boundingBox())!;
  await page.mouse.move(rect.x, rect.y + rect.height / 2);
  await page.mouse.down(); await page.mouse.move(rect.x + rect.width, rect.y + rect.height / 2, { steps: 10 }); await page.mouse.up();
  const noteButton = page.getByRole("button", { name: "付箋", exact: true });
  await expect(noteButton).toBeVisible();
  // The list is as wide as the column, so frame its start: the selected word and the button under it.
  const list = (await answer.locator("ul").first().boundingBox())!;
  await save(page, "step-select", 1200, { x: Math.round(list.x - 32), y: Math.round(rect.y + rect.height / 2 + 54 - 210), width: 560, height: 420 });
  await noteButton.click();
  const note = page.getByTestId("floating-note");
  await note.getByLabel("付箋のメモ").fill("Toolとの違いを、具体例で教えて");
  await note.getByRole("button", { name: "AIに聞く", exact: true }).click();
  await expect(note.getByTestId("note-message-assistant")).toContainText("デモ回答");
  await expect(note.locator(".spin")).toHaveCount(0);
  await page.locator(".canvas-scroll").evaluate((el) => el.scrollTo({ top: 0, behavior: "instant" }));
  await dragNote(page, note, 1304, 320);
  await note.locator(".note-chat-history").evaluate((el) => el.scrollTo({ top: 0, behavior: "instant" }));
  await page.locator(".canvas-scroll").evaluate((el) => el.scrollTo({ top: 0, behavior: "instant" }));
  await expect(page.getByTestId("anchor-highlight").first()).toBeVisible();
  await save(page, "hero", 2400);
  await save(page, "step-ask", 1200, await around(page, [note], 24));
});

// The picture shown when the page is shared (Open Graph), drawn from the app icon.
test("draws the sharing image", async ({ page }) => {
  const icon = readFileSync("public/brand/fussenn.svg", "utf8");
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(`<!doctype html><html lang="ja"><meta charset="utf-8"><style>
    body { margin: 0; width: 1200px; height: 630px; background: #3f5145; color: #faf9f6; font-family: "Hiragino Sans", "Yu Gothic UI", sans-serif; display: grid; grid-template-columns: 300px 1fr; align-items: center; gap: 64px; padding: 0 96px; box-sizing: border-box; }
    svg { width: 300px; height: 300px; }
    .name { font-size: 40px; font-weight: 600; letter-spacing: .02em; margin: 0 0 18px; }
    h1 { font-family: "Hiragino Mincho ProN", "Yu Mincho", serif; font-weight: 600; font-size: 84px; line-height: 1.2; margin: 0 0 30px; letter-spacing: .02em; }
    mark { background: linear-gradient(transparent 12%, #ffe49a 12%, #ffe49a 92%, transparent 92%); color: #26302a; padding: 0 .06em; }
    p { font-size: 28px; line-height: 1.6; margin: 0; color: #e4e8df; }
  </style><body>${icon}<div><p class="name">Fussenn</p><h1>理解を、<mark>余白</mark>に。</h1><p>文章に付箋を貼って、AIと読み書きする。<br>Mac・Windows向けの無料アプリ</p></div></body></html>`);
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: 1200, height: 630 } });
  await sharp(png).resize({ width: 1200 }).png({ compressionLevel: 9, palette: true, quality: 90 }).toFile("site/og.png");
});
