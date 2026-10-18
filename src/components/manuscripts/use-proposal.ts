"use client";
import { useEffect, useRef, useState } from "react";
import type { SideNote } from "@/lib/types";
import { api } from "@/lib/api";
import { registerDesktopSave } from "@/lib/desktop";

export function useProposal(note: SideNote, onChange: (patch: Partial<SideNote>) => void) {
  const value = useRef(note.manuscript?.draft ?? ""), version = useRef(note.manuscript?.draftRevision ?? 0);
  const dirty = useRef(false), queue = useRef<Promise<boolean>>(Promise.resolve(true));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState(""), [state, setState] = useState("保存済み");
  const current = useRef(note);
  useEffect(() => { current.current = note; });
  useEffect(() => {
    // A new round of revision starts from the saved manuscript, with a new draft version.
    if (!dirty.current && note.manuscript) {
      value.current = note.manuscript.draft;
      version.current = note.manuscript.draftRevision;
    }
  }, [note.manuscript]);
  async function save() {
    if (timer.current) clearTimeout(timer.current);
    const task = queue.current.then(async () => {
      if (!dirty.current) return true;
      const draft = value.current;
      setState("保存中…");
      try {
        const saved = await api<SideNote>(`manuscripts/notes/${note.id}/draft`, { method: "POST", body: JSON.stringify({ draft, expected: version.current }) });
        version.current = saved.manuscript!.draftRevision;
        dirty.current = value.current !== draft;
        onChange({ manuscript: { ...current.current.manuscript!, draft: value.current, draftRevision: version.current } });
        setError(""); setState(dirty.current ? "編集中…" : "保存済み"); return !dirty.current;
      } catch (e) { setError((e as Error).message); setState("未保存"); return false; }
    });
    queue.current = task;
    return task;
  }
  useEffect(() => note.manuscript ? registerDesktopSave(save) : undefined);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", unload);
    return () => { window.removeEventListener("beforeunload", unload); if (timer.current) clearTimeout(timer.current); };
  }, []);
  function change(draft: string) {
    value.current = draft; dirty.current = true; setState("編集中…");
    onChange({ manuscript: { ...note.manuscript!, draft, draftRevision: version.current } });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 700);
  }
  return { change, save, error, state };
}
