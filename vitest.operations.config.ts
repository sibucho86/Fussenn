import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["tests/operations/**/*.test.ts"], environment: "node", maxWorkers: 2, testTimeout: 15 * 60 * 1000, hookTimeout: 120_000 },
});
