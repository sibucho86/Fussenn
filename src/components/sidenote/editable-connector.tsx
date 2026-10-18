"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { closestCurveParameter, curvePoint, nearestAttachment, type Connector, type Point, type Rect } from "@/lib/connector";
import type { ConnectorAdjustment } from "@/lib/connector-types";
import type { SideNote } from "@/lib/types";

type Handle = "source" | "target" | "bend";
type Drag = { kind: Handle; start: Point; base: ConnectorAdjustment; previous: ConnectorAdjustment | null; latest: ConnectorAdjustment; factor: number; target: SVGElement; pointerId: number; moved: boolean };
const limit = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

function placeToolbar(midpoint: Point, handles: Point[], viewport: Rect, size: { width: number; height: number }): Point {
  const gap = 12;
  const left = viewport.x + 8, top = viewport.y + 8;
  const right = Math.max(left, viewport.x + viewport.width - size.width - 8);
  const bottom = Math.max(top, viewport.y + viewport.height - size.height - 8);
  const preferred = { x: limit(midpoint.x + 18, left, right), y: limit(midpoint.y + 22, top, bottom) };
  const overlaps = (position: Point) => handles.some((p) => p.x + gap > position.x && p.x - gap < position.x + size.width && p.y + gap > position.y && p.y - gap < position.y + size.height);
  if (!overlaps(preferred)) return preferred;
  // The nearest free position lies at a viewport edge or beside a handle's clearance box.
  const xs = [preferred.x, left, right, ...handles.flatMap((p) => [p.x - size.width - gap, p.x + gap])].map((x) => limit(x, left, right));
  const ys = [preferred.y, top, bottom, ...handles.flatMap((p) => [p.y - size.height - gap, p.y + gap])].map((y) => limit(y, top, bottom));
  return xs.flatMap((x) => ys.map((y) => ({ x, y }))).filter((position) => !overlaps(position))
    .sort((a, b) => Math.hypot(a.x - preferred.x, a.y - preferred.y) - Math.hypot(b.x - preferred.x, b.y - preferred.y))[0] ?? preferred;
}

export function EditableConnector({ note, curve, anchors, bounds, editing, onClose, onChange, onError }: {
  note: SideNote; curve: Connector; anchors: Rect[]; bounds: Rect; editing: boolean;
  onClose: () => void; onChange: (value: ConnectorAdjustment | null) => void; onError: (message: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const [viewport, setViewport] = useState<Rect | null>(null);
  const [toolbarSize, setToolbarSize] = useState({ width: 290, height: 50 });
  const midpoint = curvePoint(curve, 0.5);
  const targetRect = { ...note.layout, height: note.layout.collapsed ? 42 : note.layout.height };
  const visible = viewport ?? bounds;
  const toolbarPosition = placeToolbar(midpoint, [curve.start, curve.end, midpoint], visible, toolbarSize);
  useEffect(() => {
    const canvas = svgRef.current?.closest<HTMLElement>(".conversation-canvas");
    const scroll = canvas?.closest<HTMLElement>(".canvas-scroll");
    const toolbar = toolbarRef.current;
    if (!editing || !canvas || !scroll || !toolbar) return;
    let frame = 0;
    const measure = () => {
      const origin = canvas.getBoundingClientRect(), clip = scroll.getBoundingClientRect();
      const left = Math.max(0, clip.left, origin.left), top = Math.max(0, clip.top, origin.top);
      const right = Math.min(window.innerWidth, clip.right, origin.right), bottom = Math.min(window.innerHeight, clip.bottom, origin.bottom);
      setViewport({ x: left - origin.left, y: top - origin.top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) });
      const { width, height } = toolbar.getBoundingClientRect();
      setToolbarSize((current) => current.width === width && current.height === height ? current : { width, height });
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(scroll); observer.observe(canvas); observer.observe(toolbar);
    scroll.addEventListener("scroll", schedule); window.addEventListener("resize", schedule);
    schedule();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); scroll.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule); };
  }, [editing]);
  function release(current: Drag) { if (current.target.hasPointerCapture(current.pointerId)) current.target.releasePointerCapture(current.pointerId); }
  function cancel() {
    const current = drag.current;
    if (!current) return;
    drag.current = null; onChange(current.previous); release(current);
  }
  useEffect(() => {
    if (!editing) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      const current = drag.current;
      if (current) { drag.current = null; onChange(current.previous); release(current); }
      else onClose();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [editing, onChange, onClose]);
  async function persist(value: ConnectorAdjustment | null, previous: ConnectorAdjustment | null) {
    if (busy.current) return;
    busy.current = true; setSaving(true); onChange(value);
    try { await api(`notes/${note.id}/layout`, { method: "PATCH", body: JSON.stringify({ connector: value }), keepalive: true }); }
    catch { onChange(previous); onError("引き出し線を保存できませんでした。変更前の形に戻しました。もう一度調整してください。"); }
    finally { busy.current = false; setSaving(false); }
  }
  function point(event: React.PointerEvent<SVGElement>): Point {
    const origin = event.currentTarget.closest(".conversation-canvas")!.getBoundingClientRect();
    return { x: limit(event.clientX - origin.left, 0, bounds.width), y: limit(event.clientY - origin.top, 0, bounds.height) };
  }
  function adjusted(kind: Handle, position: Point, base: ConnectorAdjustment, start: Point, factor = 1): ConnectorAdjustment {
    if (kind === "source") return { ...base, source: nearestAttachment(position, anchors, 3) };
    if (kind === "target") { const { side, ratio } = nearestAttachment(position, [targetRect]); return { ...base, target: { side, ratio } }; }
    return { ...base, bend: { x: limit(base.bend.x + (position.x - start.x) / factor, -2000, 2000), y: limit(base.bend.y + (position.y - start.y) / factor, -2000, 2000) } };
  }
  function begin(kind: Handle, event: React.PointerEvent<SVGElement>, onLine = false) {
    if (busy.current || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const start = point(event), t = onLine ? closestCurveParameter(curve, start) : 0.5;
    drag.current = { kind, start, base: curve.adjustment, previous: note.layout.connector, latest: curve.adjustment, factor: Math.max(0.25, 4 * t * (1 - t)), target: event.currentTarget, pointerId: event.pointerId, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: React.PointerEvent<SVGElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    const position = point(event);
    if (!current.moved && Math.hypot(position.x - current.start.x, position.y - current.start.y) < 2) return;
    current.moved = true;
    current.latest = adjusted(current.kind, position, current.base, current.start, current.factor);
    onChange(current.latest);
  }
  function finish(event: React.PointerEvent<SVGElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation(); drag.current = null; release(current);
    if (current.moved) void persist(current.latest, current.previous);
  }
  function nudge(kind: Handle, event: React.KeyboardEvent<SVGCircleElement>) {
    const vectors: Record<string, Point> = { ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }, ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 } };
    const vector = vectors[event.key];
    if (!vector) return;
    event.preventDefault(); event.stopPropagation();
    if (busy.current || drag.current) return;
    const start = kind === "source" ? curve.start : kind === "target" ? curve.end : midpoint, step = event.shiftKey ? 10 : 2;
    void persist(adjusted(kind, { x: start.x + vector.x * step, y: start.y + vector.y * step }, curve.adjustment, start), note.layout.connector);
  }
  return editing && <>
      <svg ref={svgRef} className="connector-editor connector-interaction note-theme" data-note-color={note.color} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel}>
        <path className={`connector-drag-path ${saving ? "connector-saving" : ""}`} d={curve.path} onPointerDown={(event) => begin("bend", event, true)} />
        {([["source", curve.start, "マーカー側の接続点"], ["target", curve.end, "付箋側の接続点"], ["bend", midpoint, "曲線の調整点"]] as const).map(([kind, p, label]) => <circle key={kind} className="connector-handle" data-kind={kind} cx={p.x} cy={p.y} r={kind === "bend" ? 7 : 6} role="button" tabIndex={0} aria-label={label} aria-disabled={saving} onPointerDown={(event) => begin(kind, event)} onKeyDown={(event) => nudge(kind, event)}><title>{label} · ドラッグまたは矢印キーで調整</title></circle>)}
      </svg>
      <div ref={toolbarRef} className="connector-toolbar connector-interaction" role="group" aria-label="引き出し線の調整" style={{ left: toolbarPosition.x, top: toolbarPosition.y }}>
        <span>{saving ? "保存中…" : "線と丸い点をドラッグ"}</span><button disabled={saving || !note.layout.connector} onClick={() => void persist(null, note.layout.connector)}>自動に戻す</button><button disabled={saving} onClick={onClose}>完了</button>
      </div>
  </>;
}
