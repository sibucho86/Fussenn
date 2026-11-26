"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, LoaderCircle, Square } from "lucide-react";

export function Composer({ onSend, busy, compact = false, placeholder = "気になっていることを聞いてみましょう…", draft, readOnly = false, onStop, options }: {
  onSend: (text: string) => Promise<boolean | void>; busy: boolean; compact?: boolean; placeholder?: string; readOnly?: boolean;
  draft?: { text: string; onChange: (text: string) => void };
  /** Given while an answer is being written; the send button then stops it. */
  onStop?: () => void;
  /** Choices for the next question, shown beside the send button. */
  options?: ReactNode;
}) {
  const [localText, setLocalText] = useState("");
  const text = draft?.text ?? localText;
  const setText = draft?.onChange ?? setLocalText;
  const [sending, setSending] = useState(false);
  async function submit() {
    if (!text.trim() || busy || sending) return;
    const draft = text;
    setText(""); setSending(true);
    try { if (await onSend(draft.trim()) === false) setText(draft); }
    finally { setSending(false); }
  }
  const stopping = !!onStop;
  const textarea = useRef<HTMLTextAreaElement>(null);
  // A click right after the button turned into "stop" is the second click of a double click on "send".
  const stopShownAt = useRef(0);
  useEffect(() => { if (stopping) stopShownAt.current = performance.now(); }, [stopping]);
  function stop(viaClick = false) {
    if (!onStop || (viaClick && performance.now() - stopShownAt.current < 300)) return;
    onStop(); textarea.current?.focus();
  }
  // One button that turns into "stop", so keyboard focus stays on it while an answer is written.
  return <form className={`composer ${compact ? "compact" : ""}`} onSubmit={(e) => { e.preventDefault(); void submit(); }} onKeyDown={(e) => {
    // Esc also cancels a Japanese conversion; only a plain Esc in the text box or on the button stops the answer.
    const target = e.target as HTMLElement;
    if (e.key === "Escape" && onStop && !e.nativeEvent.isComposing && e.keyCode !== 229 && (target.tagName === "TEXTAREA" || target.tagName === "BUTTON")) { e.preventDefault(); stop(); }
  }}>
    <textarea ref={textarea} aria-label={compact ? "付箋で追加質問" : "メッセージ"} value={text} placeholder={placeholder} rows={compact ? 1 : 2} maxLength={20_000} readOnly={readOnly}
      onChange={(e) => setText(e.target.value)} onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); void submit(); }
      }} />
    <div className="composer-bottom">{options}<span className="composer-hint">{compact ? "" : stopping ? "Esc で回答を止める" : "Enter で送信 · Shift + Enter で改行"}</span>
      <button className={`send-button ${stopping ? "stop-button" : ""}`} type={stopping ? "button" : "submit"}
        aria-label={stopping ? (compact ? "付箋の回答を止める" : "回答を止める") : (compact ? "追加質問を送信" : "送信")} title={stopping ? "回答を止める（Esc）" : undefined}
        disabled={!stopping && (!text.trim() || busy || sending)}
        onClick={stopping ? () => stop(true) : undefined}>
        {stopping ? <Square size={compact ? 9 : 11} fill="currentColor" /> : busy || sending ? <LoaderCircle size={17} className="spin" /> : <ArrowUp size={18} />}
      </button>
    </div>
  </form>;
}
