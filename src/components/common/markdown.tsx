"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ children }: { children: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    a: ({ children, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer">{children}</a>,
    // Remote images can leak user browsing to third parties. Images are out of v0.1 scope.
    img: ({ alt }) => <span>[画像: {alt || "非表示"}]</span>,
  }}>{children}</ReactMarkdown>;
}
