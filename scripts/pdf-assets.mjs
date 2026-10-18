import { cpSync, mkdirSync, copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function preparePdfAssets() {
  const require = createRequire(import.meta.url);
  const source = dirname(require.resolve("pdfjs-dist/package.json"));
  const target = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "pdfjs");
  mkdirSync(target, { recursive: true });
  copyFileSync(join(source, "build", "pdf.worker.min.mjs"), join(target, "pdf.worker.min.mjs"));
  copyFileSync(join(source, "LICENSE"), join(target, "LICENSE"));
  for (const folder of ["cmaps", "standard_fonts"]) cpSync(join(source, folder), join(target, folder), { recursive: true });
}
