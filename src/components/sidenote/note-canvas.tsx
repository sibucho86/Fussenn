"use client";
import { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Plus, StickyNote } from "lucide-react";
import type { ConversationDetail, NoteLayout, SideNote, TextAnchor } from "@/lib/types";
import { captureAnchor, restoreAnchor, textNodes } from "@/lib/anchor";
import { mergeLineRects, routeConnector, type Connector, type Rect } from "@/lib/connector";
import type { ConnectorAdjustment } from "@/lib/connector-types";
import { api } from "@/lib/api";
import { FloatingNote } from "./floating-note";
import { EditableConnector } from "./editable-connector";
import { ConnectorLayer } from "./connector-layer";
import { applyStreamEvent } from "@/hooks/use-chat-stream";
import { textScale } from "@/lib/appearance";
import { useAppearance } from "@/lib/appearance-store";

type Geometry = { anchors: Record<string, Rect[]>; textRects: Rect[]; bounds: Rect };
type ConnectorPlacement = { id: string; rect: Rect; adjustment: ConnectorAdjustment | null };
type SelectionInfo = TextAnchor & { parentMessageId: string; x: number; y: number; noteX: number; noteY: number };
export type ManuscriptCanvasBridge = {
  selection: () => { from: number; to: number; rect: DOMRect } | null;
  rects: (id: string) => DOMRect[]; geometry: number; revision: number;
  create: (from: number, to: number, text: string, x: number, y: number) => Promise<SideNote>;
  /** Opens the confirmation; settles when it closes, true when the draft was applied. */
  preview: (id: string) => Promise<boolean>; refresh: (id: string) => Promise<void>; revise: (id: string) => Promise<void>; reveal: (id: string) => void;
};
export type NoteCanvasHandle = { revealNote: (id: string) => Promise<boolean>; closeConnectorEditor: () => void; selectCursor: () => void };
export function NoteCanvas({ ref, detail, showConnectors, onShowConnectors, onNotes, onError, children, manuscript }: {
  ref?: React.Ref<NoteCanvasHandle>;
  detail: ConversationDetail | null; onNotes: (update: (notes: SideNote[]) => SideNote[]) => void;
  showConnectors: boolean; onShowConnectors: () => void;
  onError: (message: string) => void; children: React.ReactNode; manuscript?: ManuscriptCanvasBridge;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [geometry, setGeometry] = useState<Geometry>({ anchors: {}, textRects: [], bounds: { x: 0, y: 0, width: 0, height: 0 } });
  const { anchors } = geometry;
  const [editingConnector, setEditingConnector] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const appearance = useAppearance();
  const [hoveredMarker, setHoveredMarker] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const pendingRef = useRef(new Set<string>());
  const pendingFocus = useRef<{ id: string; marker: boolean } | null>(null);
  const notes = detail?.notes;
  useImperativeHandle(ref, () => ({ revealNote: async (id) => {
    const note = notes?.find((n) => n.id === id);
    manuscript?.reveal(id);
    return note ? changeMinimized(note, false) : false;
  }, closeConnectorEditor: () => setEditingConnector(null), selectCursor: () => selectManuscript(true) }));
  const visibleNotes = (notes ?? []).filter((n) => !n.layout.minimized);
  const anchorKey = JSON.stringify((notes ?? []).map(({ id, parentMessageId, selectedText, anchorStart, anchorEnd, anchorPrefix, anchorSuffix, anchorVersion }) => ({ id, parentMessageId, selectedText, anchorStart, anchorEnd, anchorPrefix, anchorSuffix, anchorVersion })));
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frame = 0;
    let disposed = false;
    const measuredNotes = JSON.parse(anchorKey) as (TextAnchor & { id: string; parentMessageId: string })[];
    const measure = () => {
      const origin = canvas.getBoundingClientRect();
      const result: Record<string, Rect[]> = {};
      const local = (r: DOMRect): Rect => ({ x: r.left - origin.left, y: r.top - origin.top, width: r.width, height: r.height });
      for (const note of measuredNotes) {
        if (manuscript) { result[note.id] = mergeLineRects(manuscript.rects(note.id).map(local)); continue; }
        const root = canvas.querySelector<HTMLElement>(`[data-message-id="${note.parentMessageId}"]`);
        const range = root ? restoreAnchor(root, note) : null;
        result[note.id] = range ? mergeLineRects(Array.from(range.getClientRects()).map(local)) : [];
      }
      const column = canvas.querySelector<HTMLElement>(".main-column");
      const textRects: Rect[] = [];
      if (column) for (const node of textNodes(column)) {
        if (!node.data.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        textRects.push(...Array.from(range.getClientRects()).map(local));
      }
      setGeometry({ anchors: result, textRects: mergeLineRects(textRects), bounds: { x: 0, y: 0, width: canvas.clientWidth, height: canvas.clientHeight } });
    };
    const schedule = () => { if (disposed) return; cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(canvas);
    const column = canvas.querySelector(".main-column");
    if (column) observer.observe(column);
    for (const root of canvas.querySelectorAll("[data-message-id]")) observer.observe(root);
    window.addEventListener("resize", schedule);
    canvas.addEventListener("scroll", schedule, true);
    void document.fonts.ready.then(schedule);
    schedule();
    return () => { disposed = true; observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener("resize", schedule); canvas.removeEventListener("scroll", schedule, true); };
    // Bridge functions read refs; its geometry counter schedules measurements.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorKey, detail?.messages, manuscript?.geometry]);
  useEffect(() => {
    const request = pendingFocus.current;
    if (!request) return;
    // Let the note index close before moving keyboard focus back into the canvas.
    const frame = requestAnimationFrame(() => {
      const selector = request.marker ? `[data-restore-note="${request.id}"]` : `section[data-note-id="${request.id}"]`;
      const target = canvasRef.current?.querySelector<HTMLElement>(selector);
      if (!target || target.matches(":disabled")) return;
      target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      target.focus({ preventScroll: true });
      pendingFocus.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [notes, anchors, pending]);
  function updateNote(id: string, patch: Partial<SideNote>) { onNotes((rows) => rows.map((n) => n.id === id ? { ...n, ...patch } : n)); }
  async function changeMinimized(note: SideNote, minimized: boolean) {
    if (pendingRef.current.has(note.id)) return false;
    pendingRef.current.add(note.id); setPending(new Set(pendingRef.current));
    const patch = minimized ? { minimized: true } : { minimized: false, collapsed: false, zIndex: Math.min(Math.max(100, ...(notes ?? []).map((n) => n.layout.zIndex)) + 1, 999_999) };
    try {
      await api(`notes/${note.id}/layout`, { method: "PATCH", body: JSON.stringify(patch), keepalive: true });
      pendingFocus.current = { id: note.id, marker: minimized };
      onNotes((rows) => rows.map((n) => n.id === note.id ? { ...n, layout: { ...n.layout, ...patch } } : n));
      setActive((current) => minimized ? (current === note.id ? null : current) : note.id);
      setEditingConnector(null);
      setHoveredMarker(null);
      return true;
    } catch { onError(minimized ? "付箋をしまえませんでした。もう一度お試しください。" : "付箋を開けませんでした。もう一度お試しください。"); return false; }
    finally { pendingRef.current.delete(note.id); setPending(new Set(pendingRef.current)); }
  }
  function storedNotesAt(event: React.MouseEvent<HTMLDivElement>) {
    if ((event.target as Element).closest(".floating-note, .selection-popover, [data-restore-note], .connector-interaction")) return [];
    const origin = canvasRef.current?.getBoundingClientRect();
    if (!origin) return [];
    const x = event.clientX - origin.left, y = event.clientY - origin.top;
    return (notes ?? []).filter((n) => n.layout.minimized && anchors[n.id]?.some((r, i) => (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) || (i === 0 && x >= r.x + r.width - 8 && x <= r.x + r.width + 5 && y >= r.y - 6 && y <= r.y + 7)));
  }
  function updateLayout(id: string, patch: Partial<NoteLayout>, persist: boolean) {
    onNotes((rows) => rows.map((n) => n.id === id ? { ...n, layout: { ...n.layout, ...patch } } : n));
    if (persist) void api(`notes/${id}/layout`, { method: "PATCH", body: JSON.stringify(patch) }).catch(() => onError("付箋の位置を保存できませんでした。もう一度動かすと再試行できます。"));
  }
  function focusNote(id: string) {
    if (active === id) return;
    setActive(id);
    setEditingConnector(null);
    const max = Math.max(100, ...(notes ?? []).map((n) => n.layout.zIndex));
    updateLayout(id, { zIndex: Math.min(max + 1, 999_999) }, true);
  }
  async function createNote() {
    if (!selection || !detail || creating) return;
    setCreating(true);
    try {
      const { noteX, noteY, parentMessageId, selectedText, anchorStart, anchorEnd, anchorPrefix, anchorSuffix, anchorVersion } = selection;
      const anchor = { parentMessageId, selectedText, anchorStart, anchorEnd, anchorPrefix, anchorSuffix, anchorVersion };
      const note = manuscript ? await manuscript.create(anchorStart, anchorEnd, selectedText, Math.round(noteX), Math.round(noteY)) : await api<SideNote>("notes", { method: "POST", body: JSON.stringify({ ...anchor, conversationId: detail.id, x: Math.round(noteX), y: Math.round(noteY) }) });
      note.layout.zIndex = Math.max(100, ...(notes ?? []).map((n) => n.layout.zIndex)) + 1;
      // With larger text, a new note starts larger in proportion, so its controls fit. Like a standard note,
      // it stays clear of the canvas's right edge, growing no wider than the canvas leaves room for.
      const scale = textScale(appearance.textSize), canvasWidth = canvasRef.current?.clientWidth ?? Infinity;
      const width = Math.max(note.layout.width, Math.min(Math.round(note.layout.width * scale), canvasWidth - 24));
      const size = scale > 1 ? { width, height: Math.round(note.layout.height * scale), x: Math.max(8, Math.min(note.layout.x, canvasWidth - width - 16)) } : {};
      Object.assign(note.layout, size);
      onNotes((rows) => [...rows, note]); setActive(note.id); setSelection(null); window.getSelection()?.removeAllRanges();
      void api(`notes/${note.id}/layout`, { method: "PATCH", body: JSON.stringify({ zIndex: note.layout.zIndex, ...size }) }).catch(() => {});
    } catch (e) { onError(e instanceof Error ? e.message : "付箋を作成できませんでした。"); }
    finally { setCreating(false); }
  }
  function selectText(event: React.MouseEvent<HTMLDivElement>) {
    if ((event.target as Element).closest(".floating-note, .selection-popover, [data-restore-note], .connector-interaction")) return;
    if (manuscript) { if ((event.target as Element).closest(".manuscript-editor")) selectManuscript(false); else setSelection(null); return; }
    const selection = window.getSelection();
    const canvas = canvasRef.current;
    if (!canvas || !selection?.rangeCount || selection.isCollapsed) { setSelection(null); return; }
    const range = selection.getRangeAt(0);
    const element = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range.startContainer.parentElement;
    const root = element?.closest<HTMLElement>("[data-message-id]");
    if (!root || !canvas.contains(root)) { setSelection(null); return; }
    if (root.dataset.status !== "complete") { setSelection(null); return; }
    try {
      const anchor = captureAnchor(root, range);
      const rect = range.getBoundingClientRect();
      const origin = canvas.getBoundingClientRect();
      let noteX = rect.right - origin.left + 24;
      if (noteX + 320 > canvas.clientWidth - 16) noteX = Math.max(16, rect.left - origin.left - 344);
      let noteY = Math.max(8, rect.top - origin.top);
      for (const note of notes ?? []) if (Math.abs(note.layout.x - noteX) < 10 && Math.abs(note.layout.y - noteY) < 10) { noteX += 24; noteY += 24; }
      setSelection({ ...anchor, parentMessageId: root.dataset.messageId!, x: Math.max(4, Math.min(rect.left - origin.left, canvas.clientWidth - 110)), y: rect.bottom - origin.top + 8, noteX: Math.max(8, Math.min(noteX, canvas.clientWidth - 336)), noteY });
    } catch (e) { setSelection(null); onError(e instanceof Error ? e.message : "文章を選択し直してください。"); }
  }
  function selectManuscript(allowCursor: boolean) {
    const selected = manuscript?.selection(), canvas = canvasRef.current;
    if (!selected || !canvas || !detail || (!allowCursor && selected.from === selected.to)) { setSelection(null); return; }
    const { from, to, rect } = selected, origin = canvas.getBoundingClientRect();
    if (to - from > 20_000) { onError("2万文字以内の範囲を選択してください。"); return; }
    setSelection({ selectedText: detail.messages[0].content.slice(from, to), anchorStart: from, anchorEnd: to, anchorPrefix: "", anchorSuffix: "", anchorVersion: 1, parentMessageId: detail.messages[0].id,
      x: Math.max(4, rect.left - origin.left), y: rect.bottom - origin.top + 8,
      noteX: Math.max(8, Math.min(canvas.clientWidth - 336, (canvas.querySelector(".main-column")?.getBoundingClientRect().right ?? rect.right) - origin.left + 24)), noteY: Math.max(8, rect.top - origin.top) });
  }
  const activeNote = visibleNotes.find((n) => n.id === active);
  // Focus, memo edits and note chat streaming do not change connection geometry.
  const connectorLayoutKey = JSON.stringify(visibleNotes.map(({ id, layout }) => ({ id, rect: { x: layout.x, y: layout.y, width: layout.width, height: layout.collapsed ? 42 : layout.height }, adjustment: layout.connector })));
  const connectors = useMemo(() => {
    const placements = JSON.parse(connectorLayoutKey) as ConnectorPlacement[];
    const result = new Map<string, Connector>();
    for (const target of placements) {
      const curve = routeConnector({ anchors: geometry.anchors[target.id] ?? [], note: target.rect, textRects: geometry.textRects, adjustment: target.adjustment, otherNotes: placements.filter((n) => n.id !== target.id).map((n) => n.rect) });
      if (curve) result.set(target.id, curve);
    }
    return result;
  }, [connectorLayoutKey, geometry]);
  const activeConnector = activeNote ? connectors.get(activeNote.id) : null;
  return <div ref={canvasRef} className="conversation-canvas" id="conversation-canvas" style={{ minHeight: visibleNotes.length ? `max(100%, ${Math.max(...visibleNotes.map((n) => n.layout.y + (n.layout.collapsed ? 42 : n.layout.height))) + 100}px)` : "100%", cursor: hoveredMarker ? "pointer" : undefined }} title={hoveredMarker ? "クリックして付箋を開く" : undefined} onMouseUp={selectText}
    onMouseMove={(event) => setHoveredMarker(event.buttons ? null : storedNotesAt(event)[0]?.id ?? null)} onMouseLeave={() => setHoveredMarker(null)}
    onClickCapture={(event) => {
      // Keep overlays transparent to pointer events so highlighted text remains selectable.
      if (!window.getSelection()?.isCollapsed) return;
      const matches = storedNotesAt(event);
      if (!matches.length) return;
      event.preventDefault(); event.stopPropagation();
      for (const note of matches) void changeMinimized(note, false);
    }}>
    {children}
    <div className="anchor-overlays" aria-hidden="true">{(notes ?? []).flatMap((note) => (anchors[note.id] ?? []).map((r, i) => <div key={`${note.id}-${i}`} data-testid="anchor-highlight" data-note-color={note.color} data-note-id={note.id} className={`anchor-highlight note-theme ${note.id === active ? "highlight-active" : ""} ${note.layout.minimized ? "highlight-stored" : ""}`} style={{ left: r.x, top: r.y, width: r.width, height: r.height }} />))}</div>
    <div className="marker-controls">{(notes ?? []).filter((n) => n.layout.minimized && anchors[n.id]?.length).map((note) => {
      const r = anchors[note.id][0];
      return <button key={note.id} type="button" data-restore-note={note.id} data-testid="stored-note-marker" data-note-color={note.color} className="stored-note-marker note-theme" style={{ left: r.x, top: r.y, width: r.width, height: r.height }} aria-label={`「${note.selectedText}」の付箋を開く`} disabled={pending.has(note.id)} onClick={(event) => { event.stopPropagation(); void changeMinimized(note, false); }}><span className="stored-marker-icon" aria-hidden="true"><StickyNote size={9} /></span></button>;
    })}</div>
    {(notes ?? []).some((n) => n.layout.minimized && (n.manuscript ? n.manuscript.from === null : anchors[n.id]?.length === 0)) && <div className="stored-note-recovery" role="group" aria-label="マーカーが見つからない付箋"><span>しまった付箋 · 元のマーカーが見つかりません</span>{(notes ?? []).filter((n) => n.layout.minimized && (n.manuscript ? n.manuscript.from === null : anchors[n.id]?.length === 0)).map((note) => <button key={note.id} data-restore-note={note.id} disabled={pending.has(note.id)} onClick={() => void changeMinimized(note, false)}><StickyNote size={12} /><span>「{note.selectedText}」を開く</span></button>)}</div>}
    {showConnectors && <ConnectorLayer notes={visibleNotes} curves={connectors} activeId={active} textRects={geometry.textRects} />}
    {activeNote && activeConnector && <EditableConnector key={activeNote.id} note={activeNote} curve={activeConnector} anchors={anchors[activeNote.id] ?? []} bounds={geometry.bounds} editing={showConnectors && editingConnector === activeNote.id} onClose={() => setEditingConnector(null)} onChange={(value) => updateLayout(activeNote.id, { connector: value }, false)} onError={onError} />}
    {selection && <button className="selection-popover" style={{ left: selection.x, top: selection.y }} onMouseDown={(e) => e.preventDefault()} onClick={() => void createNote()} disabled={creating}><Plus size={13} />{creating ? "作成中…" : "付箋"}</button>}
    {(notes ?? []).map((note) => <FloatingNote key={note.id} note={note} active={active === note.id} manuscriptActions={manuscript} missing={note.manuscript ? note.manuscript.from === null : anchors[note.id]?.length === 0} canMinimize={note.manuscript ? note.manuscript.from !== null : !!anchors[note.id]?.length} onMinimize={async () => { await changeMinimized(note, true); }} editingConnector={showConnectors && editingConnector === note.id} onEditConnector={() => { if (!showConnectors) onShowConnectors(); focusNote(note.id); setEditingConnector((current) => current === note.id ? null : note.id); }} onFocus={() => focusNote(note.id)} onChange={(patch) => updateNote(note.id, patch)} onLayout={(patch, persist) => updateLayout(note.id, patch, persist)} onChatEvent={(event) => onNotes((rows) => rows.map((n) => n.id === note.id ? { ...n, mode: "chat", messages: applyStreamEvent(n.messages, event) } : n))} onDelete={() => {
      if (!window.confirm("この付箋と付箋内の会話を削除しますか？")) return;
      void api(`notes/${note.id}`, { method: "DELETE" }).then(() => onNotes((rows) => rows.filter((n) => n.id !== note.id))).catch((e) => onError(e.message));
    }} />)}
  </div>;
}
