import { CONNECTOR_SIDES, type ConnectorAdjustment, type ConnectorAttachment, type ConnectorSide } from "./connector-types";
export type Rect = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };
export type Connector = { path: string; start: Point; end: Point; control1: Point; control2: Point; sourceSide: ConnectorSide; targetSide: ConnectorSide; adjustment: ConnectorAdjustment };
const normals: Record<ConnectorSide, Point> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const center = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const contains = (r: Rect, p: Point) => p.x > r.x && p.x < r.x + r.width && p.y > r.y && p.y < r.y + r.height;
export function padRect(r: Rect, padding: number): Rect { return { x: r.x - padding, y: r.y - padding, width: r.width + padding * 2, height: r.height + padding * 2 }; }

export function mergeLineRects(rects: Rect[]): Rect[] {
  const result: Rect[] = [];
  for (const r of [...rects].sort((a, b) => a.y - b.y || a.x - b.x)) {
    if (r.width <= 0 || r.height <= 0) continue;
    const last = result.at(-1);
    if (last && Math.abs(last.y - r.y) < 2 && Math.abs(last.height - r.height) < 3 && r.x <= last.x + last.width + 1) {
      last.width = Math.max(last.x + last.width, r.x + r.width) - last.x;
      last.height = Math.max(last.y + last.height, r.y + r.height) - last.y;
    } else result.push({ ...r });
  }
  return result;
}
function attachmentPoint(rect: Rect, attachment: ConnectorAttachment, gap = 0): Point {
  const { side, ratio } = attachment;
  const x = rect.x + rect.width * ratio, y = rect.y + rect.height * ratio;
  return side === "top" ? { x, y: rect.y - gap } : side === "bottom" ? { x, y: rect.y + rect.height + gap } : side === "left" ? { x: rect.x - gap, y } : { x: rect.x + rect.width + gap, y };
}
export function nearestAttachment(point: Point, rects: Rect[], gap = 0): ConnectorAdjustment["source"] {
  let best = { distance: Infinity, attachment: { side: "top" as ConnectorSide, ratio: 0.5, segment: 0 } };
  rects.forEach((rect, segment) => {
    for (const side of CONNECTOR_SIDES) {
      const ratio = side === "top" || side === "bottom" ? clamp((point.x - rect.x) / Math.max(1, rect.width), 0, 1) : clamp((point.y - rect.y) / Math.max(1, rect.height), 0, 1);
      const d = distance(point, attachmentPoint(rect, { side, ratio }, gap));
      if (d < best.distance) best = { distance: d, attachment: { side, ratio, segment } };
    }
  });
  return best.attachment;
}
export function curvePoint(curve: Connector, t: number): Point {
  const u = 1 - t;
  return { x: u ** 3 * curve.start.x + 3 * u * u * t * curve.control1.x + 3 * u * t * t * curve.control2.x + t ** 3 * curve.end.x, y: u ** 3 * curve.start.y + 3 * u * u * t * curve.control1.y + 3 * u * t * t * curve.control2.y + t ** 3 * curve.end.y };
}
export function closestCurveParameter(curve: Connector, point: Point): number {
  let best = { t: 0.5, distance: Infinity };
  for (let i = 3; i <= 37; i++) { const t = i / 40, d = distance(point, curvePoint(curve, t)); if (d < best.distance) best = { t, distance: d }; }
  return best.t;
}
function makeCurve(source: Rect, note: Rect, adjustment: ConnectorAdjustment): Connector {
  const start = attachmentPoint(source, adjustment.source, 3), end = attachmentPoint(note, adjustment.target);
  const reach = Math.min(120, Math.max(28, distance(start, end) * 0.35), distance(start, end) * 0.6);
  // Moving both control points by 4/3 of bend moves the curve's midpoint by exactly bend.
  const shift = { x: adjustment.bend.x * 4 / 3, y: adjustment.bend.y * 4 / 3 };
  const control1 = { x: start.x + normals[adjustment.source.side].x * reach + shift.x, y: start.y + normals[adjustment.source.side].y * reach + shift.y };
  const control2 = { x: end.x + normals[adjustment.target.side].x * reach + shift.x, y: end.y + normals[adjustment.target.side].y * reach + shift.y };
  const xy = (p: Point) => `${Number(p.x.toFixed(2))} ${Number(p.y.toFixed(2))}`;
  return { path: `M ${xy(start)} C ${xy(control1)}, ${xy(control2)}, ${xy(end)}`, start, end, control1, control2, sourceSide: adjustment.source.side, targetSide: adjustment.target.side, adjustment };
}
export function routeConnector({ anchors, note, textRects = [], otherNotes = [], adjustment = null }: {
  anchors: Rect[]; note: Rect; textRects?: Rect[]; otherNotes?: Rect[]; adjustment?: ConnectorAdjustment | null;
}): Connector | null {
  const sources = mergeLineRects(anchors);
  if (!sources.length) return null;
  if (adjustment) {
    const segment = Math.min(adjustment.source.segment, sources.length - 1);
    return makeCurve(sources[segment], note, { ...adjustment, source: { ...adjustment.source, segment } });
  }
  const textObstacles = textRects.map((r) => padRect(r, 2));
  let best: { score: number; curve: Connector } | null = null;
  for (let segment = 0; segment < sources.length; segment++) {
    const source = sources[segment];
    if (contains(note, center(source))) continue;
    for (const sourceSide of CONNECTOR_SIDES) for (const targetSide of CONNECTOR_SIDES) {
      const toward = center(source), horizontal = targetSide === "top" || targetSide === "bottom";
      const size = horizontal ? note.width : note.height;
      const ratio = clamp(horizontal ? toward.x - note.x : toward.y - note.y, Math.min(16, size / 2), size - Math.min(16, size / 2)) / Math.max(1, size);
      const curve = makeCurve(source, note, { source: { side: sourceSide, ratio: 0.5, segment }, target: { side: targetSide, ratio }, bend: { x: 0, y: 0 } });
      let length = 0, collisions = 0, blocked = false, previous = curve.start;
      for (let i = 1; i <= 32; i++) {
        const point = curvePoint(curve, i / 32), step = distance(previous, point);
        length += step; previous = point;
        if (i < 32 && (sources.some((r) => contains(r, point)) || contains(note, point))) { blocked = true; break; }
        if (textObstacles.some((r) => contains(r, point))) collisions += step * 8;
        if (otherNotes.some((r) => contains(r, point))) collisions += step * 20;
      }
      if (blocked) continue;
      const delta = { x: curve.end.x - curve.start.x, y: curve.end.y - curve.start.y }, direct = distance(curve.start, curve.end) || 1;
      const facing = (2 - (delta.x * normals[sourceSide].x + delta.y * normals[sourceSide].y) / direct + (delta.x * normals[targetSide].x + delta.y * normals[targetSide].y) / direct) * 20;
      const score = length + collisions + facing;
      if (!best || score < best.score) best = { score, curve };
    }
  }
  return best?.curve ?? null;
}
