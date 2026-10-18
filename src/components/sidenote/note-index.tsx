"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, LoaderCircle, MessageSquare, Search, StickyNote, X } from "lucide-react";
import type { SideNote } from "@/lib/types";
import { NOTE_COLOR_LABELS } from "@/lib/note-colors";

const compact = (value: string) => value.replace(/\s+/g, " ").trim();
const searchable = (value: string) => compact(value).normalize("NFKC").toLocaleLowerCase("ja-JP");

export function NoteIndex({ notes, title, isDocument = false, onClose, onReveal }: {
  notes: SideNote[]; title: string; isDocument?: boolean; onClose: () => void; onReveal: (id: string) => Promise<boolean>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const [query, setQuery] = useState("");
  const [storedOnly, setStoredOnly] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current!;
    element.showModal(); search.current?.focus();
    return () => element.close();
  }, []);
  const terms = searchable(query).split(" ").filter(Boolean);
  const rows = notes.filter((note) => {
    if (storedOnly && !note.layout.minimized) return false;
    const text = searchable([note.selectedText, note.memo, ...note.messages.map((m) => m.content)].join(" "));
    return terms.every((term) => text.includes(term));
  }).sort((a, b) => a.createdAt - b.createdAt);
  const storedCount = notes.filter((n) => n.layout.minimized).length;
  function close() {
    // Close while the dialog is still mounted so the browser can restore its opener's focus.
    dialog.current?.close();
    onClose();
  }
  async function reveal(id: string) {
    if (pending.current) return;
    pending.current = true; setOpening(id); setError("");
    try {
      if (await onReveal(id)) close();
      else setError("付箋を開けませんでした。もう一度選んでください。");
    } catch { setError("付箋を開けませんでした。もう一度選んでください。"); }
    finally { pending.current = false; setOpening(null); }
  }
  return <dialog ref={dialog} id="conversation-note-index" className="note-index-dialog" aria-labelledby="note-index-heading" onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div className="note-index-content">
      <header className="note-index-heading"><span className="note-index-symbol"><StickyNote size={19} /></span><div><h2 id="note-index-heading">この{isDocument ? "資料" : "会話"}の付箋 <span>{notes.length}</span></h2><p title={title}>{title}</p></div><button className="icon-button" aria-label="付箋一覧を閉じる" onClick={close}><X size={17} /></button></header>
      <div className="note-index-tools">
        <label className="note-index-search"><Search size={15} /><input ref={search} aria-label="付箋を検索" placeholder="言葉・メモ・付箋の会話を検索" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button className="icon-button" aria-label="付箋の検索をクリア" onClick={() => { setQuery(""); search.current?.focus(); }}><X size={13} /></button>}</label>
        <div className="note-index-filters" role="group" aria-label="付箋の表示範囲"><button aria-pressed={!storedOnly} onClick={() => setStoredOnly(false)}>すべて <span>{notes.length}</span></button><button aria-pressed={storedOnly} onClick={() => setStoredOnly(true)}>しまった付箋 <span>{storedCount}</span></button></div>
      </div>
      {error && <p className="note-index-error" role="alert">{error}</p>}
      <div className="note-index-results"><span role="status" aria-live="polite">{rows.length} 件{query.trim() ? "の検索結果" : "の付箋"}</span><span>作成順</span></div>
      <div className="note-index-scroll">
        {rows.length ? <ul className="note-index-list">{rows.map((note) => {
          const latest = note.messages.findLast((m) => m.role === "assistant") ?? note.messages.at(-1);
          const preview = compact(note.mode === "chat" ? latest?.content || note.memo : note.memo);
          const status = note.layout.minimized ? "マーカーに収納" : note.layout.collapsed ? "折りたたみ中" : "表示中";
          return <li key={note.id}><button className="note-index-item note-theme" data-testid="note-index-item" data-note-id={note.id} data-note-color={note.color} aria-label={`「${note.selectedText}」の付箋へ移動`} disabled={opening !== null} onClick={() => void reveal(note.id)}>
            <span className="note-index-item-meta"><span><span className="note-index-color" aria-label={NOTE_COLOR_LABELS[note.color]} />{note.mode === "chat" ? <MessageSquare size={12} /> : <StickyNote size={12} />}{note.mode === "chat" ? "AIとの会話" : "メモ"}</span><span className={`note-index-state ${note.layout.minimized ? "is-stored" : ""}`}>{status}</span></span>
            <strong className="note-index-quote">{compact(note.selectedText)}</strong>
            <span className={`note-index-preview ${!preview ? "is-empty" : ""}`}>{preview.slice(0, 180) || (latest?.status === "streaming" ? "回答を生成しています…" : "まだ内容がありません")}</span>
            <span className="note-index-item-foot"><span>{latest?.status === "streaming" && <><LoaderCircle size={11} className="spin" />回答を生成中</>}</span><span>{opening === note.id ? <><LoaderCircle size={12} className="spin" />開いています…</> : <>{note.layout.minimized || note.layout.collapsed ? "開いて移動" : "付箋へ移動"}<ArrowUpRight size={13} /></>}</span></span>
          </button></li>;
        })}</ul> : <div className="note-index-empty"><StickyNote size={27} strokeWidth={1.3} /><strong>{notes.length === 0 ? `この${isDocument ? "資料" : "会話"}には、まだ付箋がありません` : terms.length ? "該当する付箋がありません" : "しまった付箋はありません"}</strong><p>{notes.length === 0 ? `${isDocument ? "資料の本文" : "AIの回答"}から気になる言葉を選び、「＋付箋」で残せます。` : terms.length ? "検索する言葉を変えるか、表示範囲を広げてみてください。" : "マーカーにしまった付箋を、ここからまとめて見つけられます。"}</p>{notes.length > 0 && <button onClick={() => { setQuery(""); setStoredOnly(false); search.current?.focus(); }}>すべての付箋を表示</button>}</div>}
      </div>
      <footer className="note-index-footer">選ぶと付箋を手前に表示し、その場所へ移動します。</footer>
    </div>
  </dialog>;
}
