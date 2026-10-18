"use client";
import { useId } from "react";
import { padRect, type Connector, type Rect } from "@/lib/connector";
import type { SideNote } from "@/lib/types";

export function ConnectorLayer({ notes, curves, activeId, textRects }: {
  notes: SideNote[]; curves: ReadonlyMap<string, Connector>; activeId: string | null; textRects: Rect[];
}) {
  const maskId = `connector-${useId().replaceAll(":", "")}`;
  return <svg id="note-connector-layer" className="connector-layer" aria-hidden="true">
    <defs><mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%" style={{ maskType: "luminance" }}><rect width="100%" height="100%" fill="white" />{textRects.map((r, i) => <rect key={i} {...padRect(r, 2)} fill="black" />)}</mask></defs>
    {notes.map((note) => {
      const curve = curves.get(note.id);
      if (!curve) return null;
      return <g key={note.id} className="note-connectors note-theme" data-note-id={note.id} data-note-color={note.color} data-active={note.id === activeId} data-source-side={curve.sourceSide} data-target-side={curve.targetSide}>
        <g mask={`url(#${maskId})`}><path data-testid="connector-curve" d={curve.path} /><circle cx={curve.start.x} cy={curve.start.y} r="2" /></g>
      </g>;
    })}
  </svg>;
}
