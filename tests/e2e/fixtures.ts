import { test as base } from "@playwright/test";
export * from "@playwright/test";
export const test = base.extend({
  request: async ({ playwright, baseURL }, provide) => {
    const bootstrap = await playwright.request.newContext({ baseURL });
    const response = await bootstrap.get("/api/workspace");
    const revision = response.headers()["x-fussenn-revision"];
    await bootstrap.dispose();
    const request = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { "X-Fussenn-Revision": revision } });
    await provide(request);
    await request.dispose();
  },
});
