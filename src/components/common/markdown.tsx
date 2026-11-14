"use client";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isOption, isReplacementLanguage } from "@/lib/replacements";

/** With `replacement`, a code block in the "replacement" language is shown by it instead of as code. */
export function Markdown({ children, replacement }: { children: string; replacement?: (text: string) => ReactNode }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    a: ({ children, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer">{children}</a>,
    // Remote images can leak user browsing to third parties. Images are out of v0.1 scope.
    img: ({ alt }) => <span>[画像: {alt || "非表示"}]</span>,
    pre: ({ node, children, ...props }) => {
      const code = node?.children[0];
      if (replacement && code?.type === "element" && code.tagName === "code") {
        const classes = Array.isArray(code.properties.className) ? code.properties.className.map(String) : [];
        if (classes.some((name) => name.startsWith("language-") && isReplacementLanguage(name.slice("language-".length)))) {
          // The displayed code ends with a line break that is not part of the block's text.
          const text = code.children.map((child) => child.type === "text" ? child.value : "").join("").replace(/\n$/, "");
          return isOption(text) ? replacement(text) : null;
        }
      }
      return <pre {...props}>{children}</pre>;
    },
  }}>{children}</ReactMarkdown>;
}
