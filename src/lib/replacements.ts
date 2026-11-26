import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root, RootContent } from "mdast";

/**
 * Replacement options in a manuscript note's answer. The note AI writes each option as a fenced code block whose
 * language is "replacement"; the block holds only the text that takes the place of the selection. Answers are
 * read with the same Markdown parser that displays them, so what counts as an option matches what the note shows.
 */
export const REPLACEMENT_LANGUAGE = "replacement";
/** The most a draft holds. A longer option is shown but cannot be used. */
export const MAX_OPTION_LENGTH = 20_000;
const parser = unified().use(remarkParse).use(remarkGfm);

export function isReplacementLanguage(language: string | null | undefined) { return language?.toLowerCase() === REPLACEMENT_LANGUAGE; }
/** An option's text is used exactly as written; a block with nothing but white space is not an option. */
export function isOption(text: string) { return text.trim().length > 0; }

function blocks(content: string) {
  // Most answers have no options and need no second parse.
  if (!/replacement/i.test(content)) return [];
  const found: { text: string; from: number; to: number }[] = [];
  const visit = (node: Root | RootContent) => {
    if (node.type === "code" && isReplacementLanguage(node.lang) && isOption(node.value)) found.push({ text: node.value, from: node.position!.start.offset!, to: node.position!.end.offset! });
    if ("children" in node) node.children.forEach((child) => visit(child as RootContent));
  };
  visit(parser.parse(content) as Root);
  return found;
}
/** The options in an answer, in order. A block still being written counts, as it does on screen. */
export function replacementOptions(content: string) { return blocks(content).map((block) => block.text); }
export function hasReplacements(content: string) { return blocks(content).length > 0; }
/** The answer as plain text, each option in 「」, for short previews. */
export function replacementsAsText(content: string) {
  let text = "", at = 0;
  for (const block of blocks(content)) { text += `${content.slice(at, block.from)}「${block.text}」`; at = block.to; }
  return text + content.slice(at);
}
