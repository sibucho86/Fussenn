import type { NextConfig } from "next";

const config: NextConfig = {
  // The desktop server runs from the installed app, which must not change while it runs:
  // writing there breaks the Mac code signature, and Windows updates fail on the deep cache paths.
  // The rendered-page cache therefore stays in memory instead of being flushed to disk.
  ...(process.env.FUSSENN_DESKTOP_BUILD === "true" ? { output: "standalone", distDir: ".next-desktop", experimental: { isrFlushToDisk: false } } as const : {}),
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
