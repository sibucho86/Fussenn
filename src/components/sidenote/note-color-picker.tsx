"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Palette } from "lucide-react";
import { NOTE_COLORS, NOTE_COLOR_LABELS, type NoteColor } from "@/lib/note-colors";
import { api } from "@/lib/api";

export function NoteColorPicker({ noteId, color, onChange }: {
  noteId: string; color: NoteColor; onChange: (color: NoteColor) => void;
}) {
  const picker = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (picker.current && !picker.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  async function choose(next: NoteColor) {
    if (saving) return;
    if (next === color) { setOpen(false); trigger.current?.focus(); return; }
    const previous = color;
    setSaving(true); setError(""); onChange(next);
    try {
      await api(`notes/${noteId}`, { method: "PATCH", body: JSON.stringify({ color: next }), keepalive: true });
      setOpen(false);
      if (picker.current?.contains(document.activeElement)) trigger.current?.focus();
    } catch {
      onChange(previous); setError("色を保存できませんでした。もう一度選んでください。");
      setOpen(true);
    } finally { setSaving(false); }
  }
  return <div ref={picker} className="note-color-picker note-no-drag" onKeyDown={(event) => {
    if (event.key === "Escape") {
      setOpen(false); trigger.current?.focus(); event.stopPropagation();
    }
  }}>
    <button ref={trigger} type="button" className="icon-button" aria-label="付箋の色を変更" aria-expanded={open} aria-controls={`note-colors-${noteId}`} title={`色を変更 · ${NOTE_COLOR_LABELS[color]}`} onClick={() => setOpen((value) => !value)}><Palette size={14} /></button>
    {open && <div id={`note-colors-${noteId}`} className="note-color-popover" role="group" aria-label="付箋の色">
      <span className="note-color-caption">{saving ? "保存中…" : "付箋の色"}</span>
      <div className="note-color-swatches">{NOTE_COLORS.map((value) => <button key={value} type="button" className="note-color-swatch note-theme" data-note-color={value} aria-label={NOTE_COLOR_LABELS[value]} aria-pressed={color === value} title={NOTE_COLOR_LABELS[value]} disabled={saving} onClick={() => void choose(value)}>{color === value && <Check size={13} />}</button>)}</div>
      {error && <span className="note-color-error" role="alert">{error}</span>}
    </div>}
  </div>;
}
