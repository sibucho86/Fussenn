import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root, RootContent } from "mdast";

const parser = unified().use(remarkParse).use(remarkGfm);
export type ManuscriptHeading = { from: number; depth: number; title: string };
function textOf(node: Root | RootContent): string {
  if (node.type === "text" || node.type === "inlineCode" || node.type === "code") return node.value;
  if (node.type === "image" || node.type === "imageReference") return node.alt || "";
  return "children" in node ? node.children.map((child) => textOf(child as RootContent)).join("") : "";
}
export function analyzeManuscript(source: string) {
  const tree = parser.parse(source) as Root;
  const headings: ManuscriptHeading[] = [];
  function visit(node: Root | RootContent) {
    if (node.type === "heading") headings.push({ from: node.position!.start.offset!, depth: node.depth, title: textOf(node) || "（空の見出し）" });
    if ("children" in node) node.children.forEach((child) => visit(child as RootContent));
  }
  visit(tree);
  return { headings, characters: Array.from(textOf(tree).replace(/\s/g, "")).length };
}

// Keep the parser's source offsets. Repeated paragraphs, nested formatting and
// headings inside fenced code must never be located with a text search.
export function remarkManuscriptPositions() {
  return (tree: Root) => {
    function visit(node: Root | RootContent) {
      const from = node.position?.start.offset, to = node.position?.end.offset;
      if (from !== undefined && to !== undefined && node.type !== "root") {
        node.data ??= {};
        if (node.type === "text") node.data.hName = "span";
        node.data.hProperties = { ...node.data.hProperties, "data-source-from": from, "data-source-to": to,
          ...(["text", "inlineCode"].includes(node.type) ? { "data-source-text": true } : {}),
          ...(["heading", "paragraph", "code", "table", "thematicBreak"].includes(node.type) ? { "data-source-block": true } : {}),
          ...(node.type === "heading" ? { id: `manuscript-heading-${from}` } : {}),
        };
      }
      if ("children" in node) node.children.forEach((child) => visit(child as RootContent));
    }
    visit(tree);
  };
}
