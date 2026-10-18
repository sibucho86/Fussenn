import { describe, expect, it } from "vitest";
import { curvePoint, mergeLineRects, nearestAttachment, routeConnector, type Point, type Rect } from "@/lib/connector";

const anchor = { x: 400, y: 400, width: 80, height: 20 };
function crosses(points: Point[], r: Rect) {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], length = Math.hypot(b.x - a.x, b.y - a.y);
    for (let step = 0; step <= Math.ceil(length); step++) {
      const t = length ? step / Math.ceil(length) : 0;
      const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      if (x > r.x && x < r.x + r.width && y > r.y && y < r.y + r.height) return true;
    }
  }
  return false;
}
describe("position-aware note connectors", () => {
  it.each([
    ["top", "bottom", { x: 320, y: 200, width: 240, height: 150 }],
    ["bottom", "top", { x: 320, y: 470, width: 240, height: 150 }],
    ["left", "right", { x: 80, y: 330, width: 240, height: 150 }],
    ["right", "left", { x: 560, y: 330, width: 240, height: 150 }],
  ] as const)("leaves the %s of the marker and enters the %s of the note", (sourceSide, targetSide, note) => {
    const route = routeConnector({ anchors: [anchor], note })!;
    expect(route).toMatchObject({ sourceSide, targetSide });
    const points = Array.from({ length: 101 }, (_, i) => curvePoint(route, i / 100));
    expect(crosses(points, anchor)).toBe(false);
    expect(crosses(points, note)).toBe(false);
    expect(route.path).toMatch(/^M .+ C /);
    expect(route.path).not.toMatch(/[LQ]/);
    expect(route.path).not.toMatch(/NaN|Infinity/);
  });
  it("moves the middle of the curve with the drag while keeping both ends attached", () => {
    const input = { anchors: [anchor], note: { x: 760, y: 350, width: 240, height: 180 } };
    const automatic = routeConnector(input)!;
    const bent = routeConnector({ ...input, adjustment: { ...automatic.adjustment, bend: { x: 60, y: -50 } } })!;
    expect(bent.start).toEqual(automatic.start);
    expect(bent.end).toEqual(automatic.end);
    expect(curvePoint(bent, 0.5).x - curvePoint(automatic, 0.5).x).toBeCloseTo(60);
    expect(curvePoint(bent, 0.5).y - curvePoint(automatic, 0.5).y).toBeCloseTo(-50);
    expect(routeConnector({ ...input, adjustment: null })).toEqual(automatic);
  });
  it("keeps manually selected edges and ratios as the note moves, resizes and collapses", () => {
    const adjustment = { source: { side: "top" as const, ratio: 0.25, segment: 0 }, target: { side: "right" as const, ratio: 0.75 }, bend: { x: 10, y: -40 } };
    const input = { anchors: [anchor], adjustment };
    const normal = routeConnector({ ...input, note: { x: 600, y: 120, width: 320, height: 300 } })!;
    const moved = routeConnector({ ...input, note: { x: 750, y: 200, width: 400, height: 42 } })!;
    expect(normal.start).toEqual({ x: 420, y: 397 });
    expect(moved.start).toEqual(normal.start);
    expect(normal.end).toEqual({ x: 920, y: 345 });
    expect(moved.end).toEqual({ x: 1150, y: 231.5 });
    expect(moved.adjustment).toEqual(adjustment);
  });
  it("snaps endpoints to the nearest edge and preserves an attachment when text reflows", () => {
    const secondLine = { ...anchor, y: 435, width: 45 };
    const source = nearestAttachment({ x: 411.25, y: 430 }, [anchor, secondLine], 3);
    expect(source).toEqual({ side: "top", ratio: 0.25, segment: 1 });
    const route = routeConnector({ anchors: [anchor], note: { x: 600, y: 200, width: 320, height: 300 }, adjustment: { source, target: { side: "left", ratio: 0.5 }, bend: { x: 0, y: 0 } } })!;
    expect(route.start).toEqual({ x: 420, y: 397 });
    expect(route.adjustment.source.segment).toBe(0);
  });
  it("uses the nearest exposed line of a wrapped selection and handles collapsed notes", () => {
    const lastLine = { x: 400, y: 435, width: 45, height: 20 };
    const note = { x: 350, y: 500, width: 240, height: 42 };
    const route = routeConnector({ anchors: [anchor, { ...anchor }, lastLine], note })!;
    expect(route.sourceSide).toBe("bottom");
    expect(route.start.y).toBe(lastLine.y + lastLine.height + 3);
    expect(route.end.y).toBe(note.y);
    expect(mergeLineRects([anchor, { ...anchor }, lastLine])).toHaveLength(2);
  });
  it("omits a line when its marker is covered by the note or unavailable", () => {
    expect(routeConnector({ anchors: [anchor], note: { x: 390, y: 380, width: 240, height: 150 } })).toBeNull();
    expect(routeConnector({ anchors: [], note: anchor })).toBeNull();
  });
});
