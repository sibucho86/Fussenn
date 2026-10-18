import { test, expect } from "./fixtures";

test("settings persist and device-login UI detects completion", async ({ page }) => {
  let signingIn = false;
  let statusPolls = 0;
  await page.route("**/api/providers/codex/status", (route) => route.fulfill({ json: { installed: true, signedIn: signingIn && ++statusPolls > 1, authType: signingIn ? "chatgpt" : null, plan: "test" } }));
  await page.route("**/api/providers/codex/models", (route) => route.fulfill({ json: [{ id: "fixture", model: "fixture-model", displayName: "Fixture Model", isDefault: true }] }));
  await page.route("**/api/providers/codex/login/device", (route) => { signingIn = true; return route.fulfill({ json: { type: "chatgptDeviceCode", loginId: "test", verificationUrl: "https://example.test/device", userCode: "ABCD-1234" } }); });
  await page.goto("/settings");
  await page.getByRole("button", { name: "Device Codeを使う" }).click();
  await expect(page.getByText("ABCD-1234")).toBeVisible();
  await expect(page.getByText("ChatGPTにサインイン済み", { exact: false })).toBeVisible();
  await page.getByLabel("Codex Model", { exact: true }).selectOption("fixture-model");
  await page.getByLabel("OpenAI Model", { exact: true }).fill("user-selected-api-model");
  await page.getByRole("button", { name: "設定を保存", exact: true }).click();
  await expect(page.getByText("設定を保存しました", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("OpenAI Model", { exact: true })).toHaveValue("user-selected-api-model");
  await expect(page.getByLabel("Codex Model", { exact: true })).toHaveValue("fixture-model");
});

test("settings follow authentication changes from another tab without replacing drafts", async ({ page, context }) => {
  let signedIn = true;
  await context.route("**/api/providers/codex/status", (route) => route.fulfill({ json: { installed: true, signedIn, authType: signedIn ? "chatgpt" : null, plan: signedIn ? "test" : null } }));
  await context.route("**/api/providers/codex/models", (route) => route.fulfill({ json: [{ id: "fixture", model: "fixture-model", displayName: "Fixture Model", isDefault: true }] }));
  await context.route("**/api/providers/codex/logout", (route) => { signedIn = false; return route.fulfill({ json: { ok: true } }); });
  await page.goto("/settings");
  await expect(page.getByText("ChatGPTにサインイン済み", { exact: false })).toBeVisible();
  await page.getByLabel("OpenAI Model", { exact: true }).fill("keep-this-unsaved-model");
  const other = await context.newPage();
  await other.goto("/settings");
  await expect(other.getByRole("button", { name: "ログアウト", exact: true })).toBeEnabled();
  await other.getByRole("button", { name: "ログアウト", exact: true }).click();
  await expect(other.getByText("未サインイン", { exact: true })).toBeVisible();
  await page.bringToFront();
  await expect(page.getByText("未サインイン", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "ChatGPTでサインイン", exact: true })).toBeEnabled();
  await expect(page.getByLabel("OpenAI Model", { exact: true })).toHaveValue("keep-this-unsaved-model");
  signedIn = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("ChatGPTにサインイン済み", { exact: false })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Codex Model", exact: true }).getByRole("option", { name: /Fixture Model/ })).toHaveCount(1);
  await expect(page.getByLabel("OpenAI Model", { exact: true })).toHaveValue("keep-this-unsaved-model");
});

test("settings detect login completion after reloading the waiting page", async ({ page }) => {
  let signedIn = false;
  await page.clock.install();
  await page.route("**/api/providers/codex/status", (route) => route.fulfill({ json: { installed: true, signedIn, authType: signedIn ? "chatgpt" : null, plan: null } }));
  await page.route("**/api/providers/codex/models", (route) => route.fulfill({ json: [{ id: "fixture", model: "fixture-model", displayName: "Fixture Model", isDefault: true }] }));
  await page.route("**/api/providers/codex/login/device", (route) => route.fulfill({ json: { type: "chatgptDeviceCode", loginId: "test", verificationUrl: "https://example.test/device", userCode: "ABCD-1234" } }));
  await page.goto("/settings");
  await page.getByRole("button", { name: "Device Codeを使う" }).click();
  await expect(page.getByText("ログイン完了を待っています…")).toBeVisible();
  await page.reload();
  await expect(page.getByText("未サインイン", { exact: true })).toBeVisible();
  await page.getByLabel("OpenAI Model", { exact: true }).fill("another-unsaved-model");
  signedIn = true;
  await page.clock.fastForward(10_001);
  await expect(page.getByText("ChatGPTにサインイン済み", { exact: false })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Codex Model", exact: true }).getByRole("option", { name: /Fixture Model/ })).toHaveCount(1);
  await expect(page.getByLabel("OpenAI Model", { exact: true })).toHaveValue("another-unsaved-model");
});
