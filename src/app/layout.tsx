import type { Metadata } from "next";
import "./globals.css";
import { WorkspaceRevisionGuard } from "@/components/workspace-revision-guard";
import { DesktopLifecycle } from "@/components/desktop-lifecycle";

export const metadata: Metadata = {
  title: "Fussenn — 理解を、余白に。",
  description: "AIとの会話に、文脈のある付箋を。ローカルで使う学びと調査のためのチャット。",
  icons: {
    icon: [{ url: "/brand/favicon.ico", sizes: "any" }, { url: "/brand/fussenn.svg", type: "image/svg+xml" }, { url: "/brand/fussenn-32.png", type: "image/png", sizes: "32x32" }],
    apple: { url: "/brand/fussenn-180.png", sizes: "180x180" },
  },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja"><body>{children}<WorkspaceRevisionGuard /><DesktopLifecycle /></body></html>;
}
