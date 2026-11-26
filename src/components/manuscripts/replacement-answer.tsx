"use client";
import { Markdown } from "@/components/common/markdown";
import { MAX_OPTION_LENGTH } from "@/lib/replacements";

/** A manuscript note's answer, with each replacement option shown as a choice instead of a code block. */
export function ReplacementAnswer({ content, actionable, disabled, onReplace, onDraft }: {
  content: string; actionable: boolean; disabled: boolean;
  onReplace: (text: string) => void; onDraft: (text: string) => void;
}) {
  return <Markdown replacement={(text) => <div className="replacement-option" data-testid="replacement-option">
    <p className="replacement-text">{text}</p>
    {actionable && text.length <= MAX_OPTION_LENGTH && <div className="replacement-actions">
      <button className="note-ask" disabled={disabled} aria-label={`「${short(text)}」に置き換える`} onClick={() => onReplace(text)}>置き換える…</button>
      <button disabled={disabled} aria-label={`「${short(text)}」を原稿案で直す`} onClick={() => onDraft(text)}>原稿案で直す</button>
    </div>}
  </div>}>{content}</Markdown>;
}
function short(text: string) {
  const characters = Array.from(text.replace(/\s+/g, " ").trim());
  return characters.length > 24 ? `${characters.slice(0, 24).join("")}…` : characters.join("");
}
