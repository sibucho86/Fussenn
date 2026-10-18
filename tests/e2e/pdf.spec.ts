import { expect, test } from "./fixtures";
import { makePdf } from "../fixtures/pdf";
import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import { docsImage } from "../fixtures/docs-image";

test.use({ viewport: { width: 1600, height: 1000 } });
test("extracts Japanese PDF pages locally, annotates, exports and copies them into an editable manuscript", async ({ page, request }) => {
  await request.patch("/api/settings", { data: { defaultProvider: "mock" } });
  await page.goto("/"); await page.getByRole("button", { name: /^資料を開く/ }).click();
  const panel = page.getByRole("dialog", { name: "資料を開く", exact: true });
  const pdf = makePdf(["First page: safety factor.", "疲労限度について考える。\n資料の最後の文章。"]);
  const remote: string[] = [];
  page.on("request", (r) => { if (!r.url().startsWith("http://127.0.0.1:3100/")) remote.push(r.url()); });
  const chooser = page.waitForEvent("filechooser"); await panel.getByRole("button", { name: "ファイルを選ぶ", exact: true }).click();
  await (await chooser).setFiles({ name: "設計の手引き.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(panel.locator(".document-import-preview")).toContainText("PDF · 2ページ");
  await expect(panel.locator(".document-import-preview")).toContainText("疲労限度");
  const response = page.waitForResponse((r) => r.url().endsWith("/api/documents") && r.request().method() === "POST");
  await panel.getByRole("button", { name: "資料を取り込む", exact: true }).click();
  const doc = await (await response).json();
  expect(doc.document.format).toBe("pdf"); expect(doc.title).toBe("設計の手引き");
  expect(doc.messages[0].content).toContain("【PDF 2 / 2 ページ】");
  const body = page.getByTestId("document-body");
  await expect(body).toContainText("資料の最後の文章。");
  await body.evaluate((root) => {
    const node = root.firstChild!, start = node.textContent!.indexOf("疲労限度"), range = document.createRange();
    range.setStart(node, start); range.setEnd(node, start + 4);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    root.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.getByRole("button", { name: "付箋", exact: true }).click();
  const note = page.getByTestId("floating-note");
  await note.getByLabel("付箋のメモ", { exact: true }).fill("[context]"); await note.getByRole("button", { name: "AIに聞く", exact: true }).click();
  await expect(note.getByTestId("note-message-assistant")).toContainText("資料の最後の文章。");
  await expect(note.getByRole("button", { name: "追加質問を送信" })).toBeDisabled();
  await expect.poll(async () => (await (await request.get(`/api/conversations/${doc.id}`)).json()).notes[0].messages.at(-1).status).toBe("complete");
  await page.reload(); await expect(body).toContainText("【PDF 2 / 2 ページ】");
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Obsidian用Markdownを書き出す" }).click();
  const files = unzipSync(new Uint8Array(await readFile((await (await download).path())!)));
  const md = Object.values(files).map((file) => strFromU8(file)).join("\n");
  expect(md).toContain('source_format: "pdf"'); expect(md).toContain("【PDF 2 / 2 ページ】");
  await page.screenshot({ path: docsImage("pdf-document.png"), fullPage: true });
  await page.getByRole("button", { name: "原稿として編集", exact: true }).click();
  await page.getByRole("dialog", { name: "この本文から原稿を作る" }).getByRole("button", { name: "原稿を作成" }).click();
  await expect(page.getByRole("textbox", { name: "原稿本文", exact: true })).toContainText("資料の最後の文章。");
  expect(remote).toEqual([]);
});

test("handles CJK maps, partial extraction, image-only, protected and oversized PDFs, and cancellation", async ({ page, request }) => {
  await page.goto("/"); await page.getByRole("button", { name: /^資料を開く/ }).click();
  const panel = page.getByRole("dialog", { name: "資料を開く", exact: true }), input = panel.getByLabel("取り込む資料ファイル");
  const submit = panel.getByRole("button", { name: "資料を取り込む", exact: true });
  const before = await (await request.get("/api/conversations")).json();
  for (const [buffer, error] of [[makePdf([""]), "OCR"], [makePdf(["secret"], { encrypted: true }), "パスワード"], [Buffer.from("not a pdf"), "PDFを読み込めません"], [makePdf(Array(201).fill("")), "200ページ"], [Buffer.alloc(10 * 1048576 + 1), "10MB"]] as const) {
    await input.setInputFiles({ name: "検証.pdf", mimeType: "application/pdf", buffer });
    await expect(panel.getByRole("alert")).toContainText(error); await expect(submit).toBeDisabled();
  }
  await input.setInputFiles({ name: "日本語.pdf", mimeType: "application/pdf", buffer: makePdf(["日本語の設計資料。", ""], { cjkMap: true }) });
  await expect(panel.locator(".document-import-preview")).toContainText("日本語の設計資料。");
  await expect(panel).toContainText("文字を抽出できないページ：2");
  await panel.getByRole("button", { name: "キャンセル", exact: true }).click();
  expect(await (await request.get("/api/conversations")).json()).toEqual(before);
  await page.getByRole("button", { name: /^資料を開く/ }).click();
  // Hold a worker resource to exercise cancellation during the actual PDF read.
  await page.route("**/pdfjs/cmaps/**", (route) => new Promise<void>((resolve) => setTimeout(() => { void route.abort().catch(() => {}).finally(resolve); }, 1500)));
  await input.setInputFiles({ name: "中断.pdf", mimeType: "application/pdf", buffer: makePdf(["中断する資料。"], { cjkMap: true }) });
  await expect.poll(() => page.workers().length).toBeGreaterThan(0);
  await panel.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect.poll(() => page.workers().length).toBe(0);
  await page.unrouteAll({ behavior: "wait" });
  expect(await (await request.get("/api/conversations")).json()).toEqual(before);
});
