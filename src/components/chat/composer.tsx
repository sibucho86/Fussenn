"use client";
import { useState } from "react";
import { ArrowUp, LoaderCircle } from "lucide-react";

export function Composer({ onSend, busy, compact = false, placeholder = "気になっていることを聞いてみましょう…", draft }: {
  onSend: (text: string) => Promise<boolean | void>; busy: boolean; compact?: boolean; placeholder?: string;
  draft?: { text: string; onChange: (text: string) => void };
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
  return <form className={`composer ${compact ? "compact" : ""}`} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
    <textarea aria-label={compact ? "付箋で追加質問" : "メッセージ"} value={text} placeholder={placeholder} rows={compact ? 1 : 2} maxLength={20_000}
      onChange={(e) => setText(e.target.value)} onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); void submit(); }
      }} />
    <div className="composer-bottom"><span>{compact ? "" : "Enter で送信 · Shift + Enter で改行"}</span>
      <button className="send-button" type="submit" aria-label={compact ? "追加質問を送信" : "送信"} disabled={!text.trim() || busy || sending}>
        {busy || sending ? <LoaderCircle size={17} className="spin" /> : <ArrowUp size={18} />}
      </button>
    </div>
  </form>;
}
