import { test, expect, type Page, type APIRequestContext, type Locator } from "./fixtures";
import type { SideNote } from "../../src/lib/types";
import { docsImage } from "../fixtures/docs-image";

test.use({ viewport: { width: 1600, height: 1000 } });
test("reroutes above and below the marker during dragging, and masks surrounding text", async ({ page, request }) => {
  const c = await (await request.post("/api/conversations", { data: { providerKind: "mock", model: "mock-demo" } })).json();
  await request.post("/api/chat/main", { data: { ownerId: c.id, text: "引き出し線の位置を試す" } });
  await page.goto(`/?chat=${c.id}`);
  const word = page.locator('[data-message-id] strong').filter({ hasText: /^Resource$/ }).first();
  await word.evaluate((element) => {
    const range = document.createRange(); range.selectNodeContents(element);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.getByRole("button", { name: "付箋", exact: true }).click();
  const note = page.getByTestId("floating-note");
  const id = await note.getAttribute("data-note-id");
  const anchor = await word.evaluate((el) => {
    const r = el.getBoundingClientRect(), origin = el.closest(".conversation-canvas")!.getBoundingClientRect();
    return { x: r.x - origin.x, y: r.y - origin.y, width: r.width, height: r.height };
  });
  const above = { x: Math.round(anchor.x + anchor.width / 2 - 120), y: Math.round(anchor.y - 160), width: 240, height: 150, collapsed: false };
  await request.patch(`/api/notes/${id}/layout`, { data: { ...above, x: Math.round(anchor.x - 258), y: Math.round(anchor.y - 60) } });
  await page.reload();
  await expect(note).toBeVisible();
  await page.locator(".canvas-scroll").evaluate((el) => el.scrollTo({ top: 0, behavior: "instant" }));
  const origin = (await page.locator(".conversation-canvas").boundingBox())!;
  const header = (await note.locator(".note-drag-handle").boundingBox())!;
  await page.mouse.move(header.x + 40, header.y + 20); await page.mouse.down();
  await page.mouse.move(origin.x + above.x + 40, origin.y + above.y + 20, { steps: 14 }); await page.mouse.up();
  const connector = page.locator(".note-connectors");
  await expect(connector).toHaveAttribute("data-source-side", "top");
  await expect(connector).toHaveAttribute("data-target-side", "bottom");
  const endpoints = await connector.locator("path").evaluate((el) => {
    const path = el as SVGPathElement, start = path.getPointAtLength(0), end = path.getPointAtLength(path.getTotalLength());
    return { start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y } };
  });
  expect(endpoints.start.y).toBeLessThan(anchor.y);
  const noteBottom = await note.locator("..").evaluate((el) => el.getBoundingClientRect().bottom - el.closest(".conversation-canvas")!.getBoundingClientRect().top);
  expect(endpoints.end.y).toBeCloseTo(noteBottom, 0);
  await expect(connector.locator("g")).toHaveAttribute("mask", /^url\(#connector-/);
  expect(await page.locator('.connector-layer mask rect[fill="black"]').count()).toBeGreaterThan(5);
  await page.screenshot({ path: docsImage("connector-above.png") });
  await request.patch(`/api/notes/${id}/layout`, { data: { ...above, y: Math.round(anchor.y + anchor.height + 10) } });
  await page.reload();
  await note.locator(".note-title").click();
  await expect(connector).toHaveAttribute("data-source-side", "bottom");
  await expect(connector).toHaveAttribute("data-target-side", "top");
  await note.getByRole("button", { name: "付箋を折りたたむ" }).click();
  await expect(connector).toHaveAttribute("data-target-side", "top");
  await page.screenshot({ path: docsImage("connector-below.png") });
  await note.getByRole("button", { name: "マーカーにしまう" }).click();
  await expect(connector).toHaveCount(0);
});

async function editableNote(page: Page, request: APIRequestContext) {
  const c = await (await request.post("/api/conversations", { data: { providerKind: "mock", model: "mock-demo" } })).json();
  await request.post("/api/chat/main", { data: { ownerId: c.id, text: "曲線の形を調整する" } });
  await page.goto(`/?chat=${c.id}`);
  const word = page.locator('[data-message-id] strong').filter({ hasText: /^Resource$/ }).first();
  await word.evaluate((element) => {
    const range = document.createRange(); range.selectNodeContents(element);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.getByRole("button", { name: "付箋", exact: true }).click();
  const note = page.getByTestId("floating-note");
  const id = (await note.getAttribute("data-note-id"))!;
  await request.patch(`/api/notes/${id}/layout`, { data: { x: 980, y: 110, width: 320, height: 240 } });
  await request.patch(`/api/notes/${id}`, { data: { memo: "線を動かしても、このメモと付箋の位置を保持する。", color: "blue" } });
  await page.reload();
  await note.getByRole("button", { name: "引き出し線を調整", exact: true }).click();
  await expect(page.getByRole("button", { name: "曲線の調整点", exact: true })).toBeVisible();
  const read = async (): Promise<SideNote> => (await (await request.get(`/api/conversations/${c.id}`)).json()).notes.find((n: SideNote) => n.id === id);
  return { note, id, word, read };
}
async function drag(page: Page, handle: Locator, dx: number, dy: number) {
  const b = (await handle.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 12 });
  await page.mouse.up();
}

test("drags the curve and its endpoints, restores saved edits and follows a moved or collapsed note", async ({ page, request }) => {
  const { note, id, word, read } = await editableNote(page, request);
  const original = await read();
  const curve = page.getByTestId("connector-curve");
  const automatic = await curve.getAttribute("d");
  expect(automatic).toMatch(/^M .+ C /);
  const bend = page.getByRole("button", { name: "曲線の調整点", exact: true });
  await drag(page, bend, 45, -65);
  await expect.poll(async () => (await read()).layout.connector?.bend.y).toBeCloseTo(-65, 0);
  await expect(curve).not.toHaveAttribute("d", automatic!);
  await expect(page.getByRole("button", { name: "完了", exact: true })).toBeEnabled();

  // Grab the line itself away from the three handles, not just its midpoint.
  const linePoint = await page.locator(".connector-drag-path").evaluate((el) => {
    const path = el as SVGPathElement, p = path.getPointAtLength(path.getTotalLength() * 0.3), rect = path.ownerSVGElement!.getBoundingClientRect();
    return { x: p.x + rect.x, y: p.y + rect.y };
  });
  const beforeLineDrag = (await read()).layout.connector!;
  await page.mouse.move(linePoint.x, linePoint.y); await page.mouse.down();
  await page.mouse.move(linePoint.x + 10, linePoint.y - 20, { steps: 10 }); await page.mouse.up();
  await expect.poll(async () => (await read()).layout.connector?.bend.y).toBeLessThan(beforeLineDrag.bend.y - 10);
  await expect(page.getByRole("button", { name: "完了", exact: true })).toBeEnabled();

  const marker = (await word.boundingBox())!;
  const source = page.getByRole("button", { name: "マーカー側の接続点", exact: true });
  const sb = (await source.boundingBox())!;
  await drag(page, source, marker.x + marker.width * 0.3 - (sb.x + sb.width / 2), marker.y - 3 - (sb.y + sb.height / 2));
  await expect.poll(async () => (await read()).layout.connector?.source.side).toBe("top");
  await expect(page.getByRole("button", { name: "完了", exact: true })).toBeEnabled();
  const card = (await note.boundingBox())!;
  const target = page.getByRole("button", { name: "付箋側の接続点", exact: true });
  const tb = (await target.boundingBox())!;
  await drag(page, target, card.x + card.width * 0.25 - (tb.x + tb.width / 2), card.y - (tb.y + tb.height / 2));
  await expect.poll(async () => (await read()).layout.connector?.target.side).toBe("top");
  await expect(page.getByRole("button", { name: "完了", exact: true })).toBeEnabled();
  const saved = (await read()).layout.connector!;
  expect(saved.source.ratio).toBeCloseTo(0.3, 1);
  expect(saved.target.ratio).toBeCloseTo(0.25, 1);
  const editedPath = await curve.getAttribute("d");
  await expect.poll(async () => {
    const toolbar = (await page.getByRole("group", { name: "引き出し線の調整", exact: true }).boundingBox())!;
    const scroll = (await page.locator(".canvas-scroll").boundingBox())!;
    return toolbar.y >= scroll.y && toolbar.y + toolbar.height <= scroll.y + scroll.height;
  }).toBe(true);
  await page.locator(".canvas-scroll").evaluate((el) => el.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: docsImage("connector-edit.png") });
  const afterEdit = await read();
  const withoutUpdateTime = (value: unknown) => JSON.parse(JSON.stringify(value, (key, field) => key === "updatedAt" ? undefined : field));
  expect(withoutUpdateTime({ ...afterEdit, layout: { ...afterEdit.layout, connector: null, zIndex: original.layout.zIndex } })).toEqual(withoutUpdateTime(original));

  await page.reload();
  await note.getByRole("button", { name: "引き出し線を調整", exact: true }).click();
  await expect(curve).toHaveAttribute("d", editedPath!);
  expect((await read()).layout.connector).toEqual(saved);
  await page.getByRole("button", { name: "完了", exact: true }).click();
  await expect(bend).toHaveCount(0);
  await drag(page, note.locator(".note-title"), -55, 60);
  await expect.poll(async () => (await read()).layout.x).toBe(925);
  await note.getByRole("button", { name: "付箋を折りたたむ" }).click();
  await expect(page.locator(".note-connectors")).toHaveAttribute("data-target-side", "top");
  const end = await curve.evaluate((el) => { const p = el as SVGPathElement; return { x: p.getPointAtLength(p.getTotalLength()).x, y: p.getPointAtLength(p.getTotalLength()).y }; });
  expect(end.x).toBeCloseTo(925 + 320 * saved.target.ratio, 0);
  expect(end.y).toBeCloseTo(170, 0);
  expect((await read()).layout.connector).toEqual(saved);
  await note.getByRole("button", { name: "付箋を開く", exact: true }).click();
  await page.locator(".canvas-scroll").evaluate((el) => el.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: docsImage("connector-curve.png") });
  await note.getByRole("button", { name: "引き出し線を調整", exact: true }).click();
  await page.getByRole("button", { name: "自動に戻す", exact: true }).click();
  await expect.poll(async () => (await read()).layout.connector).toBeNull();
  await expect(curve).toHaveAttribute("d", /^M .+ C /);
  await expect(page.getByRole("button", { name: "自動に戻す", exact: true })).toBeDisabled();
  // Nested layout values are validated and rejected without changing saved notes.
  for (const connector of [{ ...saved, target: { side: "diagonal", ratio: 0.5 } }, { ...saved, source: { ...saved.source, ratio: 2 } }, { ...saved, bend: { x: 0, y: 2001 } }]) {
    expect((await request.patch(`/api/notes/${id}/layout`, { data: { connector } })).status()).toBe(400);
  }
  expect((await read()).layout.connector).toBeNull();
});

test("cancels an unfinished drag, supports keyboard adjustment and rolls back a failed save", async ({ page, request }) => {
  const { id, read } = await editableNote(page, request);
  const curve = page.getByTestId("connector-curve");
  const initial = await curve.getAttribute("d");
  const handle = page.getByRole("button", { name: "曲線の調整点", exact: true });
  const b = (await handle.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + 45, b.y - 50, { steps: 8 });
  await expect(curve).not.toHaveAttribute("d", initial!);
  await page.keyboard.press("Escape"); await page.mouse.up();
  await expect(curve).toHaveAttribute("d", initial!);
  expect((await read()).layout.connector).toBeNull();
  await handle.focus(); await page.keyboard.press("Shift+ArrowUp");
  await expect.poll(async () => (await read()).layout.connector?.bend.y).toBe(-10);
  await expect(page.getByRole("button", { name: "完了", exact: true })).toBeEnabled();
  const savedPath = await curve.getAttribute("d");
  await page.route(`**/api/notes/${id}/layout`, async (route) => {
    if (route.request().method() === "PATCH" && "connector" in route.request().postDataJSON()) await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "保存テスト" }) });
    else await route.continue();
  });
  await drag(page, handle, -35, 45);
  await expect(page.locator(".error-banner")).toContainText("引き出し線を保存できませんでした");
  await expect(curve).toHaveAttribute("d", savedPath!);
  expect((await read()).layout.connector?.bend.y).toBe(-10);
  await page.unroute(`**/api/notes/${id}/layout`);
  await drag(page, handle, 30, -20);
  await expect.poll(async () => (await read()).layout.connector?.bend.y).toBeCloseTo(-30, 0);
  await page.keyboard.press("Escape");
  await expect(handle).toHaveCount(0);
});
