import { test, expect, type Page, type APIRequestContext } from "./fixtures";
import type { ConversationDetail, SideNote } from "../../src/lib/types";
import { docsImage } from "../fixtures/docs-image";

test.use({ viewport: { width: 1600, height: 1000 } });
async function setup(page: Page, request: APIRequestContext) {
  const c = await (await request.post("/api/conversations", { data: { providerKind: "mock", model: "mock-demo" } })).json();
  await request.post("/api/chat/main", { data: { ownerId: c.id, text: "付箋のつながりを一覧で見渡す" } });
  await page.goto(`/?chat=${c.id}`);
  for (const [index, text] of ["Tool", "Resource", "Prompt", "heading"].entries()) {
    const word = text === "heading" ? page.locator("[data-message-id] h3").first() : page.locator("[data-message-id] strong").filter({ hasText: new RegExp(`^${text}$`) }).first();
    await word.evaluate((element) => {
      const range = document.createRange(); range.selectNodeContents(element);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.getByRole("button", { name: "付箋", exact: true }).click();
    await expect(page.getByTestId("floating-note")).toHaveCount(index + 1);
  }
  const read = async (): Promise<ConversationDetail> => (await request.get(`/api/conversations/${c.id}`)).json();
  const notes = (await read()).notes;
  const placements = [
    { x: 30, y: 180, width: 250, height: 170 },
    { x: 1010, y: 200, width: 300, height: 220 },
    { x: 920, y: 520, width: 320, height: 230 },
    { x: 30, y: 590, width: 280, height: 170, minimized: true },
  ];
  for (let i = 0; i < notes.length; i++) {
    await request.patch(`/api/notes/${notes[i].id}/layout`, { data: { ...placements[i], ...(i === 2 ? { connector: { source: { side: "bottom", ratio: 0.5, segment: 0 }, target: { side: "left", ratio: 0.5 }, bend: { x: 20, y: 40 } } } : {}) } });
    await request.patch(`/api/notes/${notes[i].id}`, { data: { color: ["yellow", "blue", "green", "lavender"][i], memo: ["処理を実行するための道具", "参照する情報。Toolとの違いを確認する。", "よく使うやり取りをまとめておく。", "マーカーにしまった付箋"][i] } });
  }
  const empty = await (await request.post("/api/conversations", { data: { providerKind: "mock", model: "mock-demo" } })).json();
  await page.reload();
  await expect(page.locator(".note-connectors")).toHaveCount(3);
  await page.locator(".canvas-scroll").evaluate((el) => el.scrollTo({ top: 0, behavior: "instant" }));
  return { id: c.id as string, emptyId: empty.id as string, notes: (await read()).notes, read };
}
const line = (page: Page, note: SideNote) => page.locator(`.note-connectors[data-note-id="${note.id}"]`);
const card = (page: Page, note: SideNote) => page.locator(`[data-testid="floating-note"][data-note-id="${note.id}"]`);
const hide = (page: Page) => page.getByRole("button", { name: "引き出し線をまとめて隠す", exact: true });
const show = (page: Page) => page.getByRole("button", { name: "引き出し線をまとめて表示", exact: true });
async function expectAttached(page: Page, note: SideNote) {
  const group = line(page, note), side = await group.getAttribute("data-target-side");
  const end = await group.locator("path").evaluate((el) => { const p = el as SVGPathElement, point = p.getPointAtLength(p.getTotalLength()); return { x: point.x, y: point.y }; });
  const rect = await card(page, note).locator("..").evaluate((el) => { const r = el.getBoundingClientRect(), o = el.closest(".conversation-canvas")!.getBoundingClientRect(); return { x: r.x - o.x, y: r.y - o.y, width: r.width, height: r.height }; });
  if (side === "top" || side === "bottom") {
    expect(end.y).toBeCloseTo(rect.y + (side === "bottom" ? rect.height : 0), 0);
    expect(end.x).toBeGreaterThanOrEqual(rect.x - 1); expect(end.x).toBeLessThanOrEqual(rect.x + rect.width + 1);
  } else {
    expect(end.x).toBeCloseTo(rect.x + (side === "right" ? rect.width : 0), 0);
    expect(end.y).toBeGreaterThanOrEqual(rect.y - 1); expect(end.y).toBeLessThanOrEqual(rect.y + rect.height + 1);
  }
}

test("shows every visible note's line without selecting a note and remembers the bulk visibility preference", async ({ page, request }) => {
  const { id, emptyId, notes, read } = await setup(page, request);
  const before = await read();
  await expect(page.locator('.note-connectors[data-active="true"]')).toHaveCount(0);
  await expect(hide(page)).toHaveAttribute("aria-pressed", "true");
  await expect(line(page, notes[3])).toHaveCount(0);
  const paths = new Map<string, string>();
  for (const note of notes.slice(0, 3)) {
    await expect(line(page, note)).toHaveAttribute("data-note-color", note.color);
    await expect(line(page, note).locator("path")).toHaveAttribute("d", /^M .+ C /);
    await expectAttached(page, note);
    paths.set(note.id, (await line(page, note).locator("path").getAttribute("d"))!);
  }
  await expect(page.locator(".connector-layer mask")).toHaveCount(1);
  for (const group of await page.locator(".note-connectors > g").all()) await expect(group).toHaveAttribute("mask", /^url\(#connector-/);
  await page.screenshot({ path: docsImage("connector-overview.png") });
  await hide(page).click();
  await expect(page.locator(".note-connectors")).toHaveCount(0);
  await expect(page.getByTestId("floating-note")).toHaveCount(3);
  await expect(page.getByTestId("anchor-highlight")).toHaveCount(4);
  expect(await read()).toEqual(before);
  await page.reload();
  await expect(show(page)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".note-connectors")).toHaveCount(0);
  await page.locator(`[data-conversation-id="${emptyId}"] .conversation-link`).click();
  await expect(page).toHaveURL(new RegExp(emptyId));
  await expect(show(page)).toBeVisible();
  await page.locator(`[data-conversation-id="${id}"] .conversation-link`).click();
  await expect(page).toHaveURL(new RegExp(id));
  await expect(page.locator(".note-connectors")).toHaveCount(0);
  await show(page).focus(); await page.keyboard.press("Space");
  await expect(page.locator(".note-connectors")).toHaveCount(3);
  for (const note of notes.slice(0, 3)) await expect(line(page, note).locator("path")).toHaveAttribute("d", paths.get(note.id)!);
  await page.reload();
  await expect(hide(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".note-connectors")).toHaveCount(3);
  expect(await read()).toEqual(before);
  for (const note of notes.slice(0, 2)) {
    await card(page, note).locator(".note-title").click();
    await expect(line(page, note)).toHaveAttribute("data-active", "true");
    await expect(page.locator(".note-connectors")).toHaveCount(3);
    for (const other of notes.slice(0, 3)) await expect(line(page, other).locator("path")).toHaveAttribute("d", paths.get(other.id)!);
  }
});

test("keeps other connections visible during movement, collapse, restoration and individual curve editing", async ({ page, request }) => {
  const { notes, read } = await setup(page, request);
  const [tool, resource, prompt, stored] = notes;
  const header = (await card(page, tool).locator(".note-title").boundingBox())!;
  await page.mouse.move(header.x + 20, header.y + header.height / 2); await page.mouse.down();
  await page.mouse.move(header.x + 20, header.y + header.height / 2 + 70, { steps: 12 }); await page.mouse.up();
  await expect.poll(async () => (await read()).notes.find((n) => n.id === tool.id)?.layout.y).toBe(tool.layout.y + 70);
  await expect(page.locator(".note-connectors")).toHaveCount(3);
  await expectAttached(page, tool);
  await card(page, resource).getByRole("button", { name: "付箋を折りたたむ", exact: true }).click();
  await expect(page.locator(".note-connectors")).toHaveCount(3);
  await expectAttached(page, resource);
  await card(page, resource).getByRole("button", { name: "マーカーにしまう", exact: true }).click();
  await expect(line(page, resource)).toHaveCount(0);
  await expect(page.locator(".note-connectors")).toHaveCount(2);
  await page.locator(`[data-restore-note="${resource.id}"]`).focus(); await page.keyboard.press("Enter");
  await expect(page.locator(".note-connectors")).toHaveCount(3);
  await expectAttached(page, resource);
  await card(page, prompt).getByRole("button", { name: "引き出し線を調整", exact: true }).click();
  await expect(page.locator(".connector-editor")).toHaveCount(1);
  await expect(page.locator(".note-connectors")).toHaveCount(3);
  const bend = page.getByRole("button", { name: "曲線の調整点", exact: true });
  await bend.focus(); await page.keyboard.press("Shift+ArrowUp");
  await expect.poll(async () => (await read()).notes.find((n) => n.id === prompt.id)?.layout.connector?.bend.y).toBe(30);
  await expect(page.getByRole("button", { name: "完了", exact: true })).toBeEnabled();
  const editedPath = (await line(page, prompt).locator("path").getAttribute("d"))!;
  await hide(page).click();
  await expect(page.locator(".note-connectors")).toHaveCount(0);
  await expect(page.locator(".connector-editor")).toHaveCount(0);
  await show(page).click();
  await expect(page.locator(".connector-editor")).toHaveCount(0);
  await expect(line(page, prompt).locator("path")).toHaveAttribute("d", editedPath);
  await hide(page).click();
  await card(page, tool).getByRole("button", { name: "引き出し線を調整", exact: true }).click();
  await expect(hide(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".note-connectors")).toHaveCount(3);
  await expect(page.locator(".connector-editor")).toHaveCount(1);
  await page.getByRole("button", { name: "完了", exact: true }).click();
  // All lines remain transparent to normal mouse text selection.
  const word = page.locator("[data-message-id] strong").filter({ hasText: /^Tool$/ }).first();
  await word.scrollIntoViewIfNeeded();
  const r = (await word.boundingBox())!;
  await page.mouse.move(r.x, r.y + r.height / 2); await page.mouse.down();
  await page.mouse.move(r.x + r.width, r.y + r.height / 2, { steps: 10 }); await page.mouse.up();
  await expect(page.getByRole("button", { name: "付箋", exact: true })).toBeVisible();
  await page.getByLabel("メッセージ", { exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await card(page, tool).getByRole("button", { name: "付箋を削除", exact: true }).click();
  await expect(line(page, tool)).toHaveCount(0);
  await expect(page.locator(".note-connectors")).toHaveCount(2);
  await page.locator(`[data-restore-note="${stored.id}"]`).focus(); await page.keyboard.press("Enter");
  await expect(line(page, stored)).toHaveCount(1);
  await expect(page.locator(".note-connectors")).toHaveCount(3);
});
