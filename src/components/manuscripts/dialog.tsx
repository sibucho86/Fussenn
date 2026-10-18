"use client";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function ManuscriptDialog({ title, children, onClose, busy = false }: { title: string; children: React.ReactNode; onClose: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => { dialog.close(); }; }, []);
  return createPortal(<dialog ref={ref} className="manuscript-dialog" aria-label={title} onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}><header><h2>{title}</h2><button className="icon-button" aria-label="閉じる" disabled={busy} onClick={onClose}><X size={18} /></button></header>{children}</dialog>, document.body);
}
