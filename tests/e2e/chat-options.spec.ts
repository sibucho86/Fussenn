import { test, expect, type Page } from "./fixtures";

async function selectWord(page: Page, word: string) {
  const root = page.locator('[data-message-id][data-status="complete"]').first();
  await root.scrollIntoViewIfNeeded();
  await root.evaluate((element, word) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode as Text;
      const index = text.data.indexOf(word);
      if (index < 0) continue;
      const range = document.createRange(); range.setStart(text, index); range.setEnd(text, index + word.length);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })); return;
    }
    throw new Error(`Text not found: ${word}`);
  }, word);
  await page.getByRole("button", { name: "付箋", exact: true }).click();
}

test("effort and web search apply per question, progress stays visible, and an answer can be stopped", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const composer = page.locator(".composer-dock");
  await composer.getByLabel("考える深さ").selectOption("high");
  const web = composer.getByRole("button", { name: /Web検索/ });
  await expect(web).toHaveAttribute("aria-pressed", "false");
  await web.click();
  await expect(web).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("メッセージ", { exact: true }).fill("[options]");
  await page.getByRole("button", { name: "送信", exact: true }).click();
  await expect(page.locator('[data-message-id][data-status="complete"]').last()).toContainText('{"effort":"high","webSearch":true}');
  // The choices are remembered on this device.
  await page.reload();
  await expect(composer.getByLabel("考える深さ")).toHaveValue("high");
  await expect(composer.getByRole("button", { name: /Web検索/ })).toHaveAttribute("aria-pressed", "true");

  await page.getByLabel("メッセージ", { exact: true }).fill("[slow] 最新の情報で教えて");
  await page.getByRole("button", { name: "送信", exact: true }).click();
  const progress = page.getByTestId("answer-progress");
  await expect(progress).toContainText("考えています");
  await expect(progress).toContainText("Webで調べています");
  await expect(progress).toContainText("「Fussenn デモの検索」");
  await expect(progress.locator(".answer-progress-time")).toHaveText(/^[1-9]\d*秒$/);
  const announcer = page.locator(".composer-dock").getByTestId("answer-announcer");
  await expect(announcer).toHaveText("Webで調べています：Fussenn デモの検索");
  const stop = page.getByRole("button", { name: "回答を止める", exact: true });
  await stop.click();
  await expect(progress).toBeHidden();
  await expect(page.locator(".message-list").getByText("回答を止めました。", { exact: true })).toBeVisible();
  await expect(announcer).toHaveText("回答を止めました。");
  await expect(stop).toBeHidden();
  // The stop reaches the server, which ends the generation.
  await expect.poll(async () => (await page.request.get("/api/health")).json().then((health) => health.activeGenerations)).toBe(0);
  await expect(page.getByRole("button", { name: "送信", exact: true })).toBeVisible();
  // The stopped question stays in the conversation; the draft is not restored.
  await expect(page.getByLabel("メッセージ", { exact: true })).toHaveValue("");
  await page.reload();
  await expect(page.locator('[data-message-id][data-status="error"]')).toHaveCount(1);
  await page.getByLabel("メッセージ", { exact: true }).fill("続けて");
  await page.getByRole("button", { name: "送信", exact: true }).click();
  await expect(page.locator('[data-message-id][data-status="complete"]')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("notes share the choices, show progress and can be stopped", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("メッセージ", { exact: true }).fill("MCPについて、全体像から教えて");
  await page.getByRole("button", { name: "送信", exact: true }).click();
  await expect(page.locator('[data-message-id][data-status="complete"]')).toHaveCount(1);
  await selectWord(page, "Resource");
  const note = page.getByTestId("floating-note").first();
  await note.getByRole("button", { name: "AIに聞く", exact: true }).click();
  await expect(note.getByTestId("note-message-assistant")).toContainText("デモ回答");
  // Turning web search on in the note also turns it on for the main chat.
  await note.getByRole("button", { name: /^Web/ }).click();
  await expect(page.locator(".composer-dock").getByRole("button", { name: /Web検索/ })).toHaveAttribute("aria-pressed", "true");
  await note.getByLabel("考える深さ").selectOption("low");
  await expect(page.locator(".composer-dock").getByLabel("考える深さ")).toHaveValue("low");
  await note.getByLabel("付箋で追加質問").fill("[options]");
  await note.getByRole("button", { name: "追加質問を送信" }).click();
  await expect(note.getByTestId("note-message-assistant").last()).toContainText('{"effort":"low","webSearch":true}');
  await note.getByLabel("付箋で追加質問").fill("[slow] もっと詳しく");
  await note.getByRole("button", { name: "追加質問を送信" }).click();
  await expect(note.getByTestId("answer-progress")).toContainText("Webで調べています");
  await note.getByRole("button", { name: "付箋の回答を止める" }).click();
  await expect(note.getByTestId("answer-progress")).toBeHidden();
  await expect(note.getByTestId("note-message-assistant").last()).toContainText("回答を止めました。");
});

test("Codex offers the efforts of the chosen model", async ({ page }) => {
  await page.route("**/api/providers/codex/models", (route) => route.fulfill({ json: [
    { id: "a", model: "deep-model", displayName: "Deep", isDefault: true, efforts: ["low", "medium", "high", "xhigh", "max", "ultra"], defaultEffort: "medium" },
    { id: "b", model: "quick-model", displayName: "Quick", isDefault: false, efforts: ["low", "medium"], defaultEffort: "low" },
  ] }));
  await page.goto("/");
  await page.getByLabel("Provider", { exact: true }).selectOption("codex");
  await page.getByLabel("Model", { exact: true }).selectOption("deep-model");
  const effort = page.locator(".composer-dock").getByLabel("考える深さ");
  await expect(effort).toHaveValue("medium");
  await expect(effort.locator("option")).toHaveText(["低", "中（標準）", "高", "とても高い", "最大", "ウルトラ"]);
  await effort.selectOption("ultra");
  // A model without that level falls back to its own default.
  await page.getByLabel("Model", { exact: true }).selectOption("quick-model");
  await expect(effort).toHaveValue("low");
  await expect(effort.locator("option")).toHaveText(["低（標準）", "中"]);
  await page.getByLabel("Model", { exact: true }).selectOption("deep-model");
  await expect(effort).toHaveValue("ultra");
  // OpenAI-compatible servers get neither option.
  await page.getByLabel("Provider", { exact: true }).selectOption("openai-compatible");
  await expect(page.locator(".composer-dock .chat-options")).toHaveCount(0);
});

test("display settings switch the theme and text size at once and keep them", async ({ page }) => {
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const fontSize = () => page.evaluate(() => getComputedStyle(document.body).fontSize);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/settings");
  const light = await background();
  expect(await fontSize()).toBe("14px");
  await page.getByRole("radio", { name: "ダーク" }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const dark = await background();
  expect(dark).not.toBe(light);
  await page.getByRole("radio", { name: "最大" }).check();
  expect(await fontSize()).toBe("21px");
  await page.reload();
  await expect(page.getByRole("radio", { name: "ダーク" })).toBeChecked();
  expect(await background()).toBe(dark);
  expect(await fontSize()).toBe("21px");
  await page.goto("/");
  expect(await background()).toBe(dark);
  await page.goto("/settings");
  await page.getByRole("radio", { name: "システムに合わせる" }).check();
  await page.getByRole("radio", { name: "標準" }).check();
  expect(await background()).toBe(light);
  expect(await fontSize()).toBe("14px");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(background).toBe(dark);
});
