import type { NextConfig } from "next";

const config: NextConfig = {
  ...(process.env.FUSSENN_DESKTOP_BUILD === "true" ? { output: "standalone", distDir: ".next-desktop" } as const : {}),
  serverExternalPackages: ["better-sqlite3", "cross-spawn"],
  // Images in Markdown render directly in the browser. No image optimizer is
  // needed in the desktop server; do not redistribute Sharp/libvips with it.
  images: { unoptimized: true },
  outputFileTracingExcludes: {
    "*": ["node_modules/sharp/**/*", "node_modules/@img/sharp-*/**/*"],
  },
  poweredByHeader: false,
};
export default config;
