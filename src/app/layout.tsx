import type { Metadata } from "next";
import "./globals.css";
import { WorkspaceRevisionGuard } from "@/components/workspace-revision-guard";
import { DesktopLifecycle } from "@/components/desktop-lifecycle";
import { AppearanceSync } from "@/components/appearance-sync";
import { APPEARANCE_SCRIPT } from "@/lib/appearance";

export const metadata: Metadata = {
  title: "Fussenn — 理解を、余白に。",
  description: "AIとの会話に、文脈のある付箋を。ローカルで使う学びと調査のためのチャット。",
  icons: {
    icon: [{ url: "/brand/favicon.ico", sizes: "any" }, { url: "/brand/fussenn.svg", type: "image/svg+xml" }, { url: "/brand/fussenn-32.png", type: "image/png", sizes: "32x32" }],
    apple: { url: "/brand/fussenn-180.png", sizes: "180x180" },
  },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // The head script sets the saved theme and text size on <html> before the first paint.
  return <html lang="ja" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: APPEARANCE_SCRIPT }} /></head><body>{children}<WorkspaceRevisionGuard /><DesktopLifecycle /><AppearanceSync /></body></html>;
}
