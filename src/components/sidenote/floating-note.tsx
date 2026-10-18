"use client";
import { useEffect, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import { ChevronDown, GripHorizontal, Minimize2, Minus, Sparkles, Spline, StickyNote, Trash2 } from "lucide-react";
import type { NoteLayout, SideNote, StreamEvent } from "@/lib/types";
import { api } from "@/lib/api";
import { useChatStream } from "@/hooks/use-chat-stream";
import { Markdown } from "@/components/common/markdown";
import { Composer } from "@/components/chat/composer";
import { NoteColorPicker } from "./note-color-picker";
import { registerDesktopSave } from "@/lib/desktop";
import { useProposal } from "@/components/manuscripts/use-proposal";
import type { ManuscriptCanvasBridge } from "./note-canvas";

export function FloatingNote({ note, active, missing, canMinimize, onMinimize, editingConnector, onEditConnector, onFocus, onChange, onLayout, onDelete, onChatEvent, manuscriptActions }: {
  manuscriptActions?: ManuscriptCanvasBridge;
  note: SideNote; active: boolean; missing: boolean; canMinimize: boolean; onMinimize: () => Promise<void>; onFocus: () => void;
  editingConnector: boolean; onEditConnector: () => void;
  onChange: (patch: Partial<SideNote>) => void;
  onLayout: (patch: Partial<NoteLayout>, persist: boolean) => void;
  onDelete: () => void; onChatEvent: (event: StreamEvent) => void;
}) {
  const proposal = useProposal(note, onChange);
  const [proposalOpen, setProposalOpen] = useState(false);
  const [actionError, setActionError] = useState("");
  const [acting, setActing] = useState(false);
  const [saveState, setSaveState] = useState("保存済み");
  const [saveError, setSaveError] = useState("");
  const [minimizing, setMinimizing] = useState(false);
  const [questionDraft, setQuestionDraft] = useState("");
  const memoRef = useRef(note.memo);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef(Promise.resolve());
  const id = note.id;
  const stream = useChatStream();
  const historyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { historyRef.current?.scrollTo({ top: historyRef.current.scrollHeight }); }, [note.messages, note.layout.minimized]);
  async function ask(text: string) {
    if (acting) return false;
    if (note.manuscript?.appliedRevision != null && !await manuscriptAction("revise")) return false;
    onChange({ mode: "chat" });
    if (note.layout.height < 360) onLayout({ height: 360 }, true);
    return stream.send("note", note.id, text || (note.manuscript ? "現在の選択箇所について、原稿全体の文脈に沿って推敲の相談に乗ってください。" : `選択した「${note.selectedText}」について、この${note.contextSnapshot.source ? "資料" : "会話"}の文脈に沿ってわかりやすく説明してください。`), onChatEvent);
  }
  function saveMemo() {
    if (timer.current) clearTimeout(timer.current);
    if (!dirty.current) return;
    const memo = memoRef.current;
    dirty.current = false;
    setSaveState("保存中…");
    queue.current = queue.current.catch(() => {}).then(async () => {
      try {
        await api(`notes/${id}`, { method: "PATCH", body: JSON.stringify({ memo }), keepalive: true });
        setSaveError(""); if (memoRef.current === memo) setSaveState("保存済み");
      } catch {
        dirty.current = true; setSaveState("未保存"); setSaveError("メモを保存できませんでした。");
      }
    });
  }
  useEffect(() => registerDesktopSave(async () => {
    saveMemo();
    await queue.current;
    return !dirty.current;
  }));
  useEffect(() => {
    const flush = () => {
      if (timer.current) clearTimeout(timer.current);
      if (dirty.current) {
        dirty.current = false;
        const memo = memoRef.current;
        queue.current = queue.current.catch(() => {}).then(async () => {
          await api(`notes/${id}`, { method: "PATCH", body: JSON.stringify({ memo }), keepalive: true });
        }).catch(() => {});
      }
    };
    window.addEventListener("pagehide", flush);
    return () => { window.removeEventListener("pagehide", flush); flush(); };
  }, [id]);
  function changeMemo(value: string) {
    memoRef.current = value; dirty.current = true; onChange({ memo: value }); setSaveState("編集中…");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(saveMemo, 700);
  }
  async function minimize() {
    if (minimizing) return;
    setMinimizing(true);
    try {
      saveMemo();
      await queue.current;
      if (!dirty.current && await proposal.save()) await onMinimize();
    } finally { setMinimizing(false); }
  }
  async function manuscriptAction(kind: "preview" | "refresh" | "revise") {
    if (!manuscriptActions || acting) return false;
    setActing(true); setActionError("");
    try {
      await manuscriptActions[kind](id);
      if (kind === "revise") setProposalOpen(false);
      return true;
    } catch (e) { setActionError((e as Error).message); return false; }
    finally { setActing(false); }
  }
  async function collapse() {
    saveMemo(); await queue.current;
    if (!dirty.current && await proposal.save()) onLayout({ collapsed: !note.layout.collapsed }, true);
  }
  function adoptAnswer(text: string) {
    proposal.change(text.slice(0, 20_000)); setProposalOpen(true);
    if (note.layout.height < 440) onLayout({ height: 440 }, true);
  }
  // Keep the note's stream and draft alive, but mount Rnd only while visible so it measures real coordinates.
  if (note.layout.minimized) return null;
  return <Rnd className={`floating-note note-theme ${active ? "note-active" : ""} ${note.layout.collapsed ? "note-collapsed" : ""}`} data-note-color={note.color}
    position={{ x: note.layout.x, y: note.layout.y }} size={{ width: note.layout.width, height: note.layout.collapsed ? 42 : note.layout.height }}
    minWidth={240} minHeight={note.layout.collapsed ? 42 : 150} maxWidth={2000} maxHeight={2000}
    bounds="parent" dragHandleClassName="note-drag-handle" cancel=".note-no-drag" enableResizing={!note.layout.collapsed}
    style={{ zIndex: note.layout.zIndex }} onMouseDown={onFocus} onTouchStart={onFocus}
    onDrag={(_e, d) => onLayout({ x: Math.max(0, Math.round(d.x)), y: Math.max(0, Math.round(d.y)) }, false)}
    onDragStop={(_e, d) => onLayout({ x: Math.max(0, Math.round(d.x)), y: Math.max(0, Math.round(d.y)) }, true)}
    onResizeStop={(_e, _direction, ref, _delta, position) => onLayout({ x: Math.max(0, Math.round(position.x)), y: Math.max(0, Math.round(position.y)), width: Math.round(ref.offsetWidth), height: Math.round(ref.offsetHeight) }, true)}
    resizeHandleComponent={{ bottomRight: <span className="note-resize-handle" aria-label="付箋のサイズ変更">⌟</span> }}>
    <section className="note-inner" data-note-id={id} data-testid="floating-note" tabIndex={-1} aria-label={`付箋: ${note.selectedText}`}>
      <header className="note-drag-handle"><StickyNote size={13} /><span className="note-title" title={note.selectedText} onDoubleClick={() => void collapse()}>{note.selectedText}</span><GripHorizontal className="note-grip" size={14} /><button className="icon-button note-no-drag" aria-label="引き出し線を調整" aria-pressed={editingConnector} title="引き出し線を調整" disabled={!canMinimize} onClick={onEditConnector}><Spline size={14} /></button><NoteColorPicker noteId={id} color={note.color} onChange={(color) => onChange({ color })} /><button className="icon-button note-no-drag" aria-label={note.layout.collapsed ? "付箋を開く" : "付箋を折りたたむ"} onClick={() => void collapse()}>{note.layout.collapsed ? <ChevronDown size={14} /> : <Minus size={14} />}</button><button className="icon-button note-no-drag" aria-label="マーカーにしまう" title={canMinimize ? "マーカーにしまう · クリックで戻せます" : "元のマーカーを確認しています"} disabled={!canMinimize || minimizing} onClick={() => void minimize()}><Minimize2 size={14} /></button></header>
      {!note.layout.collapsed && <>
        {missing && <div className="anchor-missing">元の文章を再特定できません。「{note.selectedText}」</div>}
        {note.manuscript && <div className="note-editor-tools">
          <div><span>{note.manuscript.appliedRevision !== null ? "反映済み" : "推敲中"} ／ AI参照：版 {note.manuscript.contextRevision}</span><button disabled={acting || stream.busy || note.manuscript.from === null || note.manuscript.contextRevision === manuscriptActions?.revision} onClick={() => void manuscriptAction("refresh")}>最新の本文で相談し直す</button></div>
          <div role="group" aria-label="付箋の編集モード"><button aria-pressed={!proposalOpen} onClick={() => setProposalOpen(false)}>相談・メモ</button><button aria-pressed={proposalOpen} onClick={() => { setProposalOpen(true); if (note.layout.height < 440) onLayout({ height: 440 }, true); }}>原稿案</button></div>
          {note.manuscript.appliedRevision !== null && <div className="note-revise"><span>反映後の本文から、さらに直せます。</span><button className="note-ask" disabled={acting || stream.busy || note.manuscript.from === null} onClick={() => void manuscriptAction("revise")}>続けて推敲する</button></div>}
        </div>}
        {proposalOpen && note.manuscript ? <div className="note-proposal-body"><label htmlFor={`proposal-${id}`}>本文に反映する原稿案</label><textarea id={`proposal-${id}`} aria-label="本文に反映する原稿案" value={note.manuscript.draft} maxLength={20_000} readOnly={note.manuscript.appliedRevision !== null} placeholder="相談で作った文章をここで仕上げます。" onChange={(e) => proposal.change(e.target.value)} onBlur={() => void proposal.save()} /><div><span>{proposal.state}</span><button className="note-ask" disabled={acting || !note.manuscript.draft.trim() || note.manuscript.from === null || note.manuscript.appliedRevision !== null} onClick={() => void manuscriptAction("preview")}>本文へ反映…</button></div></div> : note.mode === "memo" ? <div className="note-memo-body"><textarea aria-label="付箋のメモ" className="note-memo" placeholder="メモを書く…" maxLength={20_000} value={note.memo} onChange={(e) => changeMemo(e.target.value)} onBlur={saveMemo} /><div className="note-memo-footer"><span>{saveState}</span><button className="note-ask" disabled={stream.busy} onClick={() => { saveMemo(); void ask(note.memo.trim()); }}><Sparkles size={12} />AIに聞く</button></div></div> : <div className="note-chat-body">
          <div className="note-mode-bar"><span><Sparkles size={10} />{note.manuscript ? "原稿の全文と選択箇所を参照" : note.contextSnapshot.source ? "資料の全文と選択箇所を参照" : "文脈を引き継いだ会話"}</span><button onClick={() => { onChange({ mode: "memo" }); void api(`notes/${id}`, { method: "PATCH", body: JSON.stringify({ mode: "memo" }) }).catch(() => setSaveError("モードを保存できませんでした。")); }}>メモへ</button></div>
          <div className="note-chat-history" ref={historyRef}>{note.messages.map((message) => <div key={message.id} className={`note-chat-message ${message.role}`} data-testid={`note-message-${message.role}`}><span>{message.role === "user" ? "あなた" : "AI"}</span><div className="markdown"><Markdown>{message.content || (message.status === "streaming" ? "考えています…" : "回答が中断されました。")}</Markdown></div>{note.manuscript && note.manuscript.appliedRevision === null && message.role === "assistant" && message.status === "complete" && message.content.length <= 20_000 && <button className="note-use-answer" onClick={() => adoptAnswer(message.content)}>原稿案に使う</button>}{message.status === "error" && <small>回答が中断されました。</small>}</div>)}</div>
          {stream.error && <div className="note-chat-error" role="alert">{stream.error}</div>}
          <Composer compact onSend={ask} busy={stream.busy} draft={{ text: questionDraft, onChange: setQuestionDraft }} placeholder="もう少し、聞いてみる…" />
        </div>}
        {note.mode === "memo" && note.messages.length > 0 && <button className="note-back-to-chat" onClick={() => { onChange({ mode: "chat" }); void api(`notes/${id}`, { method: "PATCH", body: JSON.stringify({ mode: "chat" }) }).catch(() => setSaveError("モードを保存できませんでした。")); }}>付箋の会話に戻る</button>}
        {note.manuscript && note.manuscript.historyFrom > 0 && <p className="note-context-changed">参照を更新済み。以前の会話は記録として残り、以後の相談は版 {note.manuscript.contextRevision} から始まります。</p>}
        {proposal.error && <button className="note-save-error" onClick={() => void proposal.save()}>{proposal.error} 再試行</button>}
        {actionError && <p className="note-save-error" role="alert">{actionError}</p>}
        {saveError && <button className="note-save-error" onClick={saveMemo}>{saveError} 再試行</button>}
        <footer className="note-footer"><span>{note.manuscript ? "推敲の過程も、この原稿に保存" : note.mode === "memo" ? "このページの、小さな余白" : "メインの会話とは独立しています"}</span><button className="icon-button" aria-label="付箋を削除" onClick={onDelete}><Trash2 size={11} /></button></footer>
      </>}
    </section>
  </Rnd>;
}
