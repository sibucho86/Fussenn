import { test } from "@playwright/test";

// Test runs keep their screenshots in the test output folder. Set
// FUSSENN_UPDATE_DOCS_IMAGES=1 only to refresh the published documentation
// images, then review every image before committing it.
export function docsImage(name: string) {
  return process.env.FUSSENN_UPDATE_DOCS_IMAGES === "1" ? `docs/${name}` : test.info().outputPath(name);
}
