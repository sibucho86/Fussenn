import { expect, test, type Locator, type Page } from "../e2e/fixtures";
import { mkdirSync, readFileSync } from "node:fs";
import type { ConversationDetail, SideNote } from "../../src/lib/types";
import sharp from "sharp";

// Images for the download page (site/), written as WebP to site/images and as PNG to site/og.png.
// Run with npm run site:images. Everything shown is demo data made here: a manuscript, a Markdown
// document and a conversation answered by the Mock provider, in a new, empty data folder.
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
  "# 発酵のきほん",
  "",
  "味噌や醤油、日本酒は、微生物の働きを借りて作られています。こうした変化を **発酵** と呼びます。",
  "",
  "## 麹の役割",
  "",
  "**麹** は、蒸した米や麦に麹菌（コウジカビ）を育てたものです。麹菌が出す酵素が、でんぷんを糖に、たんぱく質をアミノ酸に分解します。甘みやうま味が増すのは、このためです。",
  "",
  "## 酵母と乳酸菌",
  "",
  "日本酒づくりでは、麹が作った糖を **酵母** がアルコールに変えます。ぬか漬けの酸味は、**乳酸菌** が作る乳酸によるものです。",
  "",
  "| 微生物 | 主な働き | 例 |",
  "| --- | --- | --- |",
  "| 麹菌 | でんぷんやたんぱく質を分解する | 味噌、醤油 |",
  "| 酵母 | 糖をアルコールに変える | 日本酒、パン |",
  "| 乳酸菌 | 乳酸を作る | ぬか漬け、ヨーグルト |",
].join("\n");
const manuscriptSource = "## 朝の駅\n\n朝の駅は、いつもより静かだった。\n\n改札を抜けると、冷たい風がホームを渡っていく。彼女はコートの襟を立てて、まだ来ない電車を待った。";
const revision = "始発を待つ駅は、自分の靴音が遠くまで響くほど静かだった。";

test("takes the download page's screenshots from demo data", async ({ page, request }) => {
  expect((await request.patch("/api/settings", { data: { defaultProvider: "mock" } })).ok()).toBe(true);

  // A manuscript: a note's draft goes back into the text after a look at the difference.
  await page.goto("/");
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
  await reflect.getByRole("button", { name: "本文に反映する", exact: true }).click();
  await expect(body).toContainText(revision);
  await page.getByRole("button", { name: "並べて表示", exact: true }).click();
  await expect(page.getByRole("button", { name: "並べて表示", exact: true })).toHaveAttribute("aria-pressed", "true");
  await settle(page);
  await save(page, "manuscript", 2000);

  // A document, read with a note in its margin: the page's first picture. The window is wider here
  // so that the note fits beside the text instead of over it.
  await page.setViewportSize({ width: 1760, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: /^資料を開く/ }).click();
  const importPanel = page.getByRole("dialog", { name: "資料を開く", exact: true });
  await importPanel.getByLabel("取り込む資料ファイル").setInputFiles({ name: "発酵のきほん.md", mimeType: "text/plain", buffer: Buffer.from(documentSource) });
  await importPanel.getByRole("button", { name: "資料を取り込む", exact: true }).click();
  const documentBody = page.getByTestId("document-body");
  await expect(documentBody).toBeVisible();
  // A word near the end of its line, so the app's line to the note stays short.
  await documentBody.evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text, offset = node.data.indexOf("アミノ酸");
      if (offset < 0) continue;
      const range = document.createRange(); range.setStart(node, offset); range.setEnd(node, offset + 4);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      root.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })); return;
    }
    throw new Error("The word to annotate was not found.");
  });
  await page.getByRole("button", { name: "付箋", exact: true }).click();
  const documentNote = page.getByTestId("floating-note");
  await expect(documentNote).toHaveCount(1);
  await documentNote.getByLabel("付箋のメモ", { exact: true }).fill("うま味のもとになるアミノ酸は？　食べ物の例もあわせて聞いてみる");
  const anchorWord = page.getByTestId("anchor-highlight").first();
  await expect(anchorWord).toBeVisible();
  const column = (await documentBody.boundingBox())!, wordBox = (await anchorWord.boundingBox())!;
  await dragNote(page, documentNote, column.x + column.width + 28 + 70, wordBox.y - 14 + 20);
  await settle(page);
  await expect(page.getByTestId("anchor-highlight").first()).toBeVisible();
  await save(page, "hero", 2400);
  // On a phone the whole window is too small to read, so the page shows this close-up instead.
  await save(page, "hero-detail", 1200, await around(page, [anchorWord, documentNote], 28));

  // A conversation: select a word in the answer, attach a note and ask about it.
  await page.setViewportSize({ width: 1600, height: 1000 });
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
    p { font-size: 28px; line-height: 1.6; margin: 0; color: #e4e8df; }
  </style><body>${icon}<div><p class="name">Fussenn</p><h1>理解を、余白に。</h1><p>文章に付箋を貼り、付箋の中でAIに質問できるアプリです。<br>MacとWindowsで、無料で使えます。</p></div></body></html>`);
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: 1200, height: 630 } });
  await sharp(png).resize({ width: 1200 }).png({ compressionLevel: 9, palette: true, quality: 90 }).toFile("site/og.png");
});
