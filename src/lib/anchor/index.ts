import type { TextAnchor } from "@/lib/types";

export function textNodes(root: HTMLElement): Text[] {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  return nodes;
}
export function canonicalText(root: HTMLElement) { return textNodes(root).map((n) => n.data).join(""); }
export function captureAnchor(root: HTMLElement, range: Range): TextAnchor {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) throw new Error("一つのAI回答の中で選択してください。");
  const prefixRange = root.ownerDocument.createRange();
  prefixRange.selectNodeContents(root);
  prefixRange.setEnd(range.startContainer, range.startOffset);
  const start = prefixRange.toString().length;
  const selectedText = range.toString();
  if (!selectedText.trim()) throw new Error("文章を選択してください。");
  if (selectedText.length > 500) throw new Error("選択する文章は500文字以内にしてください。");
  const text = canonicalText(root);
  const end = start + selectedText.length;
  if (text.slice(start, end) !== selectedText) throw new Error("選択位置を取得できませんでした。もう一度選択してください。");
  return { selectedText, anchorStart: start, anchorEnd: end, anchorPrefix: text.slice(Math.max(0, start - 40), start), anchorSuffix: text.slice(end, end + 40), anchorVersion: 1 };
}
export function resolveOffsets(text: string, anchor: TextAnchor): { start: number; end: number } | null {
  if (!anchor.selectedText || anchor.anchorVersion !== 1) return null;
  if (anchor.anchorStart >= 0 && text.slice(anchor.anchorStart, anchor.anchorEnd) === anchor.selectedText) return { start: anchor.anchorStart, end: anchor.anchorEnd };
  const candidates: { start: number; score: number }[] = [];
  let from = 0;
  for (;;) {
    const start = text.indexOf(anchor.selectedText, from);
    if (start < 0) break;
    const before = text.slice(0, start);
    const after = text.slice(start + anchor.selectedText.length);
    let score = 0;
    for (let n = 1; n <= anchor.anchorPrefix.length && before.endsWith(anchor.anchorPrefix.slice(-n)); n++) score++;
    for (let n = 1; n <= anchor.anchorSuffix.length && after.startsWith(anchor.anchorSuffix.slice(0, n)); n++) score++;
    candidates.push({ start, score });
    from = start + 1;
  }
  candidates.sort((a, b) => b.score - a.score);
  if (!candidates.length || (candidates.length > 1 && candidates[0].score === candidates[1].score)) return null;
  return { start: candidates[0].start, end: candidates[0].start + anchor.selectedText.length };
}
export function restoreAnchor(root: HTMLElement, anchor: TextAnchor): Range | null {
  const nodes = textNodes(root);
  const offsets = resolveOffsets(nodes.map((n) => n.data).join(""), anchor);
  if (!offsets) return null;
  let position = 0;
  let start: { node: Text; offset: number } | undefined;
  let end: { node: Text; offset: number } | undefined;
  for (const node of nodes) {
    const next = position + node.length;
    if (!start && offsets.start >= position && offsets.start <= next) start = { node, offset: offsets.start - position };
    if (!end && offsets.end >= position && offsets.end <= next) end = { node, offset: offsets.end - position };
    position = next;
  }
  if (!start || !end) return null;
  const range = root.ownerDocument.createRange();
  range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset);
  return range;
}
