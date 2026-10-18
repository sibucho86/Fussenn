"use client";
import { memo, useEffect, useImperativeHandle, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkManuscriptPositions } from "@/lib/manuscript-preview";

export type ReadingPreviewHandle = {
  rects: (from: number | null, to: number | null) => DOMRect[];
  reveal: (from: number) => void;
  position: () => number;
};
export const ReadingPreview = memo(function ReadingPreview({ ref, content, onEdit, onGeometry }: {
  ref: React.Ref<ReadingPreviewHandle>; content: string; onEdit: (from: number) => void; onGeometry: () => void;
}) {
  const root = useRef<HTMLDivElement>(null), source = useRef(content);
  source.current = content;
  const geometry = useRef(onGeometry);
  useEffect(() => { geometry.current = onGeometry; });
  useEffect(() => { geometry.current(); }, [content]);
  function blockAt(from: number) {
    const blocks = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-source-block]") ?? []);
    return blocks.find((el) => Number(el.dataset.sourceFrom) <= from && from < Number(el.dataset.sourceTo))
      ?? blocks.find((el) => Number(el.dataset.sourceFrom) >= from) ?? blocks.at(-1);
  }
  useImperativeHandle(ref, () => ({
    reveal: (from) => blockAt(from)?.scrollIntoView({ block: "center", behavior: "instant" }),
    position: () => {
      const top = root.current?.getBoundingClientRect().top ?? 0;
      const block = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-source-block]") ?? []).find((el) => el.getBoundingClientRect().bottom > top + 16);
      return Number(block?.dataset.sourceFrom ?? 0);
    },
    rects: (from, to) => {
      const container = root.current;
      if (!container || !container.getClientRects().length || from === null || to === null) return [];
      const bounds = container.getBoundingClientRect(), result: DOMRect[] = [];
      for (const el of container.querySelectorAll<HTMLElement>("[data-source-text]")) {
        const start = Number(el.dataset.sourceFrom), end = Number(el.dataset.sourceTo);
        if (end <= from || start >= to) continue;
        const text = el.firstChild;
        if (!text || text.nodeType !== Node.TEXT_NODE) continue;
        const raw = source.current.slice(start, end), shown = text.textContent ?? "";
        const exact = raw.indexOf(shown);
        const range = document.createRange();
        // Escapes/entities may occupy more source characters than rendered text.
        // In that case mark the containing text span, without guessing offsets.
        const a = exact < 0 ? 0 : Math.max(0, Math.min(shown.length, from - start - exact));
        const b = exact < 0 ? shown.length : Math.max(a, Math.min(shown.length, to - start - exact));
        range.setStart(text, a); range.setEnd(text, b);
        result.push(...Array.from(range.getClientRects()));
      }
      if (!result.length) {
        const block = blockAt(from);
        if (block) { const rect = block.getBoundingClientRect(); result.push(new DOMRect(rect.left, rect.top, 5, Math.min(24, rect.height))); }
      }
      return result.flatMap((r) => {
        const left = Math.max(r.left, bounds.left), top = Math.max(r.top, bounds.top), right = Math.min(r.right, bounds.right), bottom = Math.min(r.bottom, bounds.bottom);
        return right > left && bottom > top ? [new DOMRect(left, top, right - left, bottom - top)] : [];
      });
    },
  }));
  return <div ref={root} className="manuscript-reading markdown" data-testid="manuscript-reading" aria-label="原稿のプレビュー" tabIndex={0}
    onDoubleClick={(event) => {
      if ((event.target as Element).closest("a, button, input")) return;
      const block = (event.target as Element).closest<HTMLElement>("[data-source-block]");
      if (block) onEdit(Number(block.dataset.sourceFrom));
    }}>
    {content.trim() ? <ReactMarkdown remarkPlugins={[remarkGfm, remarkManuscriptPositions]} components={{
      a: ({ node, children, href, ...props }) => <a {...props} data-source-from={node?.position?.start.offset} href={href} target={href?.startsWith("#") ? undefined : "_blank"} rel="noopener noreferrer" onClick={(event) => {
        if (!href?.startsWith("#")) return;
        event.preventDefault();
        let label: string; try { label = decodeURIComponent(href.slice(1)); } catch { return; }
        const target = Array.from(root.current?.querySelectorAll<HTMLElement>("[id]") ?? []).find((el) => el.id === href.slice(1) || el.id === label);
        if (target) { target.scrollIntoView({ block: "center", behavior: "instant" }); return; }
        const normalize = (s: string) => s.toLowerCase().trim().replace(/\s+/g, "-");
        const heading = Array.from(root.current?.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6") ?? []).find((el) => el.id === label || normalize(el.textContent ?? "") === normalize(label));
        heading?.scrollIntoView({ block: "start", behavior: "instant" });
      }}>{children}</a>,
      img: ({ alt }) => <span className="manuscript-image-placeholder">画像：{alt || "非表示"}</span>,
    }}>{content}</ReactMarkdown> : <p className="manuscript-reading-empty">ここに原稿のプレビューが表示されます。<br />「編集」で文章を書き始めてください。</p>}
  </div>;
});
