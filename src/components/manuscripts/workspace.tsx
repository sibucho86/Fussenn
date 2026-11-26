"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlignVerticalJustifyCenter, BookOpen, Columns2, History, ListTree, PencilLine, Save, StickyNote } from "lucide-react";
import type { ConversationDetail, ManuscriptRevision, SideNote } from "@/lib/types";
import { api } from "@/lib/api";
import { flushDesktopSaves, registerDesktopSave } from "@/lib/desktop";
import { manuscriptEdits, moveAttachment, proposalEdit, type ApplyMode, type Edit } from "@/lib/manuscript";
import { NoteCanvas, type NoteCanvasHandle } from "@/components/sidenote/note-canvas";
import { ManuscriptEditor, type EditorHandle } from "./editor";
import { ManuscriptDialog } from "./dialog";
import { ReadingPreview, type ReadingPreviewHandle } from "./reading-preview";
import { analyzeManuscript } from "@/lib/manuscript-preview";
import "./manuscripts.css";

type ViewMode = "edit" | "split" | "read";
// The browser version keeps its origin across the rename from SideNote AI, so the previous key still applies.
const VIEW_KEY = "fussenn.manuscript-view", PREVIOUS_VIEW_KEY = "sidenote.manuscript-view";

export function ManuscriptWorkspace({ detail, canvasRef, showConnectors, onShowConnectors, onDetail, onNotes, onError }: {
  detail: ConversationDetail; canvasRef: React.RefObject<NoteCanvasHandle | null>; showConnectors: boolean; onShowConnectors: () => void;
  onDetail: (update: (current: ConversationDetail) => ConversationDetail) => void;
  onNotes: (update: (notes: SideNote[]) => SideNote[]) => void; onError: (message: string) => void;
}) {
  const editor = useRef<EditorHandle>(null), current = useRef(detail);
  const content = useRef(detail.messages[0].content);
  const saved = useRef({ content: detail.messages[0].content, revision: detail.document!.revision! });
  const queue = useRef<Promise<boolean>>(Promise.resolve(true)), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState("保存済み"), [saveError, setSaveError] = useState("");
  const [geometry, setGeometry] = useState(0), [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [preview, setPreview] = useState<{ note: SideNote; revision: number; content: string } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<Pick<ManuscriptRevision, "id" | "revision" | "label" | "kind" | "createdAt">[]>([]);
  const [version, setVersion] = useState<ManuscriptRevision | null>(null);
  const [label, setLabel] = useState("");
  const reading = useRef<ReadingPreviewHandle>(null), outline = useRef<HTMLDetailsElement>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("edit"), [selectedCharacters, setSelectedCharacters] = useState(0);
  const stats = useMemo(() => analyzeManuscript(detail.messages[0].content), [detail.messages]);
  const navigateFrame = useRef(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try { const mode = localStorage.getItem(VIEW_KEY) ?? localStorage.getItem(PREVIOUS_VIEW_KEY); if (mode === "edit" || mode === "split" || mode === "read") setViewMode(mode); } catch { /* The controls also work without local storage. */ }
    });
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(navigateFrame.current); };
  }, []);
  useEffect(() => { editor.current?.measure(); }, [viewMode]);
  function navigate(from: number, editing = false) {
    if (editor.current?.composing()) { onError("日本語入力を確定してから表示を切り替えてください。"); return; }
    if (editing) { setViewMode("edit"); try { localStorage.setItem(VIEW_KEY, "edit"); } catch {} }
    if (outline.current) outline.current.open = false;
    cancelAnimationFrame(navigateFrame.current);
    navigateFrame.current = requestAnimationFrame(() => {
      editor.current?.measure();
      if (editing || viewMode !== "read") editor.current?.reveal(from, editing || viewMode === "edit");
      if (!editing && viewMode !== "edit") reading.current?.reveal(from);
      setGeometry((n) => n + 1);
    });
  }
  function changeView(mode: ViewMode) {
    if (editor.current?.composing()) { onError("日本語入力を確定してから表示を切り替えてください。"); return; }
    const from = viewMode === "read" ? reading.current?.position() ?? 0 : editor.current?.position() ?? 0;
    setViewMode(mode); window.getSelection()?.removeAllRanges();
    try { localStorage.setItem(VIEW_KEY, mode); } catch {}
    cancelAnimationFrame(navigateFrame.current);
    navigateFrame.current = requestAnimationFrame(() => {
      editor.current?.measure();
      if (mode !== "read") editor.current?.reveal(from);
      if (mode !== "edit") reading.current?.reveal(from);
      setGeometry((n) => n + 1);
    });
  }
  useEffect(() => { current.current = detail; });
  const id = detail.id;

  function accept(row: ConversationDetail, replace: boolean) {
    saved.current = { content: row.messages[0].content, revision: row.document!.revision! };
    if (replace) { content.current = saved.current.content; editor.current?.replace(content.current); }
    const residual = manuscriptEdits(row.messages[0].content, content.current);
    onDetail((local) => ({ ...local, document: row.document, updatedAt: row.updatedAt,
      messages: row.messages.map((m) => ({ ...m, content: content.current })),
      notes: local.notes.map((note) => {
        const server = row.notes.find((n) => n.id === note.id);
        if (!server?.manuscript || !note.manuscript) return note;
        return { ...note, layout: replace ? { ...note.layout, minimized: server.layout.minimized } : note.layout,
          manuscript: { ...note.manuscript, ...moveAttachment(server.manuscript, residual), appliedRevision: server.manuscript.appliedRevision } };
      }),
    }));
    setGeometry((n) => n + 1);
  }
  async function save(checkpoint?: string) {
    if (timer.current) clearTimeout(timer.current);
    const task = queue.current.then(async () => {
      if (editor.current?.composing()) return false;
      const text = content.current;
      if (text === saved.current.content && !checkpoint) { setSaveError(""); setState("保存済み"); return true; }
      setState("保存中…");
      try {
        const row = await api<ConversationDetail>(`manuscripts/${id}`, { method: "PATCH", body: JSON.stringify({ content: text, expected: saved.current.revision, ...(checkpoint ? { label: checkpoint } : {}) }) });
        accept(row, false); setSaveError("");
        const clean = content.current === text;
        setState(clean ? "保存済み" : "編集中…");
        return clean;
      } catch (e) { setSaveError((e as Error).message); setState("未保存"); return false; }
    });
    queue.current = task;
    return task;
  }
  useEffect(() => registerDesktopSave(() => save()));
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (content.current !== saved.current.content) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", unload);
    return () => { window.removeEventListener("beforeunload", unload); if (timer.current) clearTimeout(timer.current); };
  }, []);
  function changed(text: string, edits: Edit[]) {
    content.current = text;
    onDetail((local) => ({ ...local, messages: local.messages.map((m) => ({ ...m, content: text })), notes: local.notes.map((note) => note.manuscript ? { ...note, manuscript: { ...note.manuscript, ...moveAttachment(note.manuscript, edits) } } : note) }));
    setState("編集中…");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 1000);
  }
  async function operation<T>(work: () => Promise<T>): Promise<T> {
    if (busyRef.current) throw new Error("処理が終わるまでお待ちください。");
    busyRef.current = true; setBusy(true);
    try {
      if (!await flushDesktopSaves()) throw new Error("編集中の内容を保存できませんでした。未保存の表示を確認して再試行してください。");
      return await work();
    } finally { busyRef.current = false; setBusy(false); }
  }
  const previewClosed = useRef<((applied: boolean) => void) | null>(null);
  function closePreview(applied: boolean) {
    setPreview(null); previewClosed.current?.(applied); previewClosed.current = null;
  }
  async function openPreview(noteId: string) {
    await operation(async () => {
      const row = await api<ConversationDetail>(`conversations/${id}`);
      if (row.document!.revision !== saved.current.revision) throw new Error("原稿が別の画面で更新されています。最新の原稿を読み込み直してください。");
      const note = row.notes.find((n) => n.id === noteId)!;
      if (!note.manuscript || note.manuscript.from === null || note.manuscript.appliedRevision !== null) throw new Error("対象の文章を選び直して、新しい付箋を作ってください。");
      setPreview({ note, revision: saved.current.revision, content: saved.current.content });
    });
    // Waiting for the dialog happens outside the operation, which the apply in the dialog needs as well.
    // The dialog can only be closed after this has run: user input waits for the pending promise work.
    return new Promise<boolean>((resolve) => { previewClosed.current = resolve; });
  }
  async function refresh(noteId: string) {
    await operation(async () => {
      const note = await api<SideNote>(`manuscripts/notes/${noteId}/context`, { method: "POST", body: JSON.stringify({ expected: saved.current.revision }) });
      onNotes((notes) => notes.map((local) => local.id === noteId ? { ...local, contextSnapshot: note.contextSnapshot, providerSessionId: null, manuscript: { ...local.manuscript!, contextRevision: note.manuscript!.contextRevision, historyFrom: note.manuscript!.historyFrom, contextHistory: note.manuscript!.contextHistory } } : local));
    });
  }
  async function revise(noteId: string) {
    await operation(async () => {
      const edit = current.current.notes.find((n) => n.id === noteId)!.manuscript!;
      const note = await api<SideNote>(`manuscripts/notes/${noteId}/revise`, { method: "POST", body: JSON.stringify({ expected: saved.current.revision, expectedDraft: edit.draftRevision }) });
      onNotes((notes) => notes.map((local) => local.id === noteId ? { ...local, selectedText: note.selectedText, anchorStart: note.anchorStart, anchorEnd: note.anchorEnd, contextSnapshot: note.contextSnapshot, providerSessionId: null, manuscript: note.manuscript } : local));
    });
  }
  async function history() {
    try { await operation(async () => { setVersions(await api(`manuscripts/${id}/history`)); setVersion(null); setHistoryOpen(true); }); }
    catch (e) { onError((e as Error).message); }
  }
  return <>
    <NoteCanvas ref={canvasRef} detail={detail} showConnectors={showConnectors} onShowConnectors={onShowConnectors} onNotes={onNotes} onError={onError} manuscript={{
      geometry, revision: detail.document!.revision!, selection: () => viewMode === "read" ? null : editor.current?.selection() ?? null,
      rects: (noteId) => { const edit = current.current.notes.find((n) => n.id === noteId)?.manuscript; return edit ? (viewMode === "read" ? reading.current : editor.current)?.rects(edit.from, edit.to) ?? [] : []; },
      reveal: (noteId) => { const from = current.current.notes.find((n) => n.id === noteId)?.manuscript?.from; if (from !== null && from !== undefined) navigate(from); },
      create: (from, to, text, x, y) => operation(async () => {
        if (content.current.slice(from, to) !== text) throw new Error("本文が変わりました。範囲を選び直してください。");
        return api<SideNote>(`manuscripts/${id}/notes`, { method: "POST", body: JSON.stringify({ expected: saved.current.revision, from, to, x, y }) });
      }), preview: openPreview, refresh, revise,
    }}>
      <article className={`main-column manuscript-column manuscript-view-${viewMode} ${detail.notes.some((n) => !n.layout.minimized) ? "manuscript-with-notes" : ""}`} aria-label="原稿編集">
        <header className="manuscript-heading"><span>原稿</span><h1>{detail.title}</h1><p>本文を選び、付箋で練り、原稿へ。</p></header>
        <div className="manuscript-toolbar">
          <div className="manuscript-view-controls" role="group" aria-label="原稿の表示方法">
            {([["edit", "編集", PencilLine], ["split", "並べて表示", Columns2], ["read", "プレビュー", BookOpen]] as const).map(([mode, title, Icon]) => <button key={mode} aria-pressed={viewMode === mode} disabled={busy || !!preview || historyOpen} onMouseDown={(e) => e.preventDefault()} onClick={() => changeView(mode)}><Icon size={14} />{title}</button>)}
          </div>
          <details ref={outline} className="manuscript-outline" onKeyDown={(event) => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
            <summary><ListTree size={14} />目次<span>{stats.headings.length}</span></summary>
            <nav aria-label="原稿の目次">{stats.headings.length ? stats.headings.map((h) => <button key={h.from} style={{ paddingLeft: 12 + (h.depth - 1) * 12 }} disabled={busy || !!preview || historyOpen} onClick={() => navigate(h.from)}>{h.title}</button>) : <p>「# 見出し」や「## 小見出し」を書くと、ここから移動できます。</p>}</nav>
          </details>
          {viewMode === "split" && <button aria-label="編集位置をプレビューに表示" title="編集カーソルのある箇所をプレビューに表示" onMouseDown={(e) => e.preventDefault()} onClick={() => reading.current?.reveal(editor.current?.position() ?? 0)}><AlignVerticalJustifyCenter size={14} />位置を合わせる</button>}
          <span className="manuscript-toolbar-spacer" />
          <button onClick={() => void save()} disabled={busy}><Save size={14} />保存</button>
          <button onClick={() => void history()} disabled={busy}><History size={14} />履歴</button>
        </div>
        <div className="manuscript-status"><span><span role="status" data-testid="manuscript-save-state">{state}</span> · 版 {detail.document!.revision}</span><span data-testid="manuscript-character-count" title="Markdownの記号・空白・改行を除いた本文の文字数">本文 {stats.characters.toLocaleString("ja-JP")}文字{selectedCharacters > 0 && viewMode !== "read" ? ` ／ 選択 ${selectedCharacters.toLocaleString("ja-JP")}文字` : ""}</span></div>
        {saveError && <div className="manuscript-save-error" role="alert"><p>{saveError}</p><button onClick={() => void save()}>保存を再試行</button><button onClick={() => { const a = document.createElement("a"), url = URL.createObjectURL(new Blob([content.current], { type: "text/markdown;charset=utf-8" })); a.href = url; a.download = "未保存の原稿.md"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000); }}>手元の編集をMDに退避</button></div>}
        <div className="manuscript-panes">
          <section className="manuscript-source-pane" hidden={viewMode === "read"} aria-label="Markdownの編集">
            <div className="manuscript-pane-heading"><span>Markdown</span><button onMouseDown={(e) => e.preventDefault()} onClick={() => canvasRef.current?.selectCursor()} disabled={busy || !!preview || historyOpen}><StickyNote size={13} />選択箇所・カーソルに付箋</button></div>
            <ManuscriptEditor ref={editor} initial={detail.messages[0].content} locked={busy || !!preview || historyOpen || viewMode === "read"} onChange={changed} onGeometry={() => setGeometry((n) => n + 1)} onSelection={setSelectedCharacters} />
          </section>
          <section className="manuscript-preview-pane" hidden={viewMode === "edit"} aria-label="整形した原稿">
            <div className="manuscript-pane-heading"><span>プレビュー</span><small>段落をダブルクリックで編集</small></div>
            {viewMode !== "edit" && <ReadingPreview ref={reading} content={detail.messages[0].content} onEdit={(from) => { if (!busy && !preview && !historyOpen) navigate(from, true); }} onGeometry={() => setGeometry((n) => n + 1)} />}
          </section>
        </div>
        <p className="manuscript-caption">{viewMode === "edit" ? "Markdownで編集できます。新しい付箋AIは、保存した最新版の原稿全文と選択箇所を参照します。" : "プレビューの段落をダブルクリックすると、その箇所を編集できます。付箋は編集画面で文章を選んで作成します。"}</p>
      </article>
    </NoteCanvas>
    {preview && <ApplyDialog preview={preview} onClose={() => closePreview(false)} onApply={async (mode) => {
      const row = await operation(() => api<ConversationDetail>(`manuscripts/notes/${preview.note.id}/apply`, { method: "POST", body: JSON.stringify({ expected: preview.revision, expectedDraft: preview.note.manuscript!.draftRevision, mode }) }));
      accept(row, true); closePreview(true); setState("保存済み");
    }} />}
    {historyOpen && <ManuscriptDialog title="原稿の履歴" onClose={() => setHistoryOpen(false)}>
      <form className="manuscript-checkpoint" onSubmit={(e) => { e.preventDefault(); void (async () => { if (await save(label.trim())) { setLabel(""); setVersions(await api(`manuscripts/${id}/history`)); } })().catch((e) => onError(e.message)); }}><input aria-label="版の名前" placeholder="初稿、編集者提出前など" maxLength={100} value={label} onChange={(e) => setLabel(e.target.value)} /><button className="secondary-button" disabled={!label.trim() || busy}>名前を付けて保存</button></form>
      <div className="manuscript-history"><nav aria-label="原稿の版">{versions.map((v) => <button key={v.id} aria-current={version?.id === v.id ? "true" : undefined} onClick={() => { void api<ManuscriptRevision>(`manuscripts/${id}/history/${v.id}`).then(setVersion).catch((e) => onError(e.message)); }}><strong>版 {v.revision}　{v.label}</strong><time>{new Date(v.createdAt).toLocaleString("ja-JP")}</time></button>)}</nav><div>{version ? <><h3>版 {version.revision}　{version.label}</h3><pre>{version.content || "（空の原稿）"}</pre><p>本文と当時の付箋の紐づきを復元します。付箋の会話や原稿案は残り、この操作も履歴に記録します。</p><button className="primary-button" disabled={busy || version.revision === detail.document!.revision} onClick={() => { void operation(() => api<ConversationDetail>(`manuscripts/${id}/history/${version.id}`, { method: "POST", body: JSON.stringify({ expected: saved.current.revision }) })).then((row) => { accept(row, true); setState("保存済み"); setHistoryOpen(false); }).catch((e) => onError(e.message)); }}>この版を復元</button></> : <p>版を選ぶと、当時の原稿を確認できます。</p>}</div></div>
    </ManuscriptDialog>}
  </>;
}
function ApplyDialog({ preview, onClose, onApply }: { preview: { note: SideNote; content: string; revision: number }; onClose: () => void; onApply: (mode: ApplyMode) => Promise<void> }) {
  const [mode, setMode] = useState<ApplyMode>("replace"), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const edit = preview.note.manuscript!, change = proposalEdit(edit.from!, edit.to!, edit.draft, mode);
  const before = preview.content.slice(Math.max(0, change.from - 100), change.from), after = preview.content.slice(change.to, change.to + 100);
  return <ManuscriptDialog title="本文への反映を確認" onClose={onClose} busy={busy}>
    <p>版 {preview.revision} の原稿へ反映します。</p>
    <div className="manuscript-apply-modes" role="group" aria-label="反映方法">{([['replace', '選択箇所と置き換え'], ['before', '直前に挿入'], ['after', '直後に挿入']] as const).map(([value, label]) => <button key={value} aria-pressed={mode === value} onClick={() => setMode(value)} disabled={busy}>{label}</button>)}</div>
    <div className="manuscript-diff" aria-label="変更プレビュー"><span>{before}</span>{change.to > change.from && <del>{preview.content.slice(change.from, change.to)}</del>}<ins>{change.insert}</ins><span>{after}</span></div>
    <p className="manuscript-caption">取り消したいときは「履歴」から反映前の版を復元できます。</p>
    {error && <p role="alert" className="inline-error">{error}</p>}
    <div className="manuscript-dialog-actions"><button className="secondary-button" disabled={busy} onClick={onClose}>編集に戻る</button><button className="primary-button" disabled={busy || !edit.draft.trim()} onClick={() => { setBusy(true); setError(""); void onApply(mode).catch((e) => setError(e.message)).finally(() => setBusy(false)); }}>{busy ? "反映中…" : "本文に反映する"}</button></div>
  </ManuscriptDialog>;
}
