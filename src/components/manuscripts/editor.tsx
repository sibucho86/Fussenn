"use client";
import { useEffect, useImperativeHandle, useRef } from "react";
import { Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import type { Edit } from "@/lib/manuscript";

export type EditorHandle = {
  selection: () => { from: number; to: number; rect: DOMRect } | null;
  rects: (from: number | null, to: number | null) => DOMRect[];
  replace: (content: string) => void; reveal: (from: number, focus?: boolean) => void; composing: () => boolean;
  position: () => number; measure: () => void;
};
export function ManuscriptEditor({ ref, initial, locked, onChange, onGeometry, onSelection }: {
  ref: React.Ref<EditorHandle>; initial: string; locked: boolean;
  onChange: (content: string, edits: Edit[]) => void; onGeometry: () => void; onSelection: (characters: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null), view = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onGeometry, onSelection });
  useEffect(() => { callbacks.current = { onChange, onGeometry, onSelection }; });
  const editable = useRef(new Compartment());
  useEffect(() => {
    const editor = new EditorView({ parent: container.current!, state: EditorState.create({ doc: initial, extensions: [
      history(), keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]), markdown(), EditorView.lineWrapping,
      placeholder("ここから書き始める。文章を選んで付箋で推敲できます。"),
      EditorView.contentAttributes.of({ "aria-label": "原稿本文", role: "textbox", "aria-multiline": "true", spellcheck: "false" }),
      editable.current.of([EditorState.readOnly.of(false), EditorView.editable.of(true)]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !update.transactions.every((t) => t.annotation(Transaction.userEvent) === "fussenn.load")) {
          const edits: Edit[] = [];
          update.changes.iterChanges((from, to, _fromB, _toB, inserted) => edits.push({ from, to, insert: inserted.toString() }));
          callbacks.current.onChange(update.state.doc.toString(), edits);
        }
        if (update.docChanged || update.geometryChanged || update.viewportChanged) callbacks.current.onGeometry();
        if (update.docChanged || update.selectionSet) {
          const { from, to } = update.state.selection.main;
          callbacks.current.onSelection(Array.from(update.state.sliceDoc(from, to)).length);
        }
      }),
    ] }) });
    view.current = editor; callbacks.current.onGeometry();
    return () => { view.current = null; editor.destroy(); };
    // A document mounts once; replacements are explicit editor transactions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { view.current?.dispatch({ effects: editable.current.reconfigure([EditorState.readOnly.of(locked), EditorView.editable.of(!locked)]) }); }, [locked]);
  function rects(from: number | null, to: number | null) {
    const editor = view.current;
    if (!editor || !editor.dom.getClientRects().length || from === null || to === null || from < 0 || to > editor.state.doc.length) return [];
    if (from === to) {
      const r = editor.coordsAtPos(from);
      return r ? [new DOMRect(r.left, r.top, 8, r.bottom - r.top)] : [];
    }
    const result: DOMRect[] = [];
    for (const visible of editor.visibleRanges) {
      const start = Math.max(from, visible.from), end = Math.min(to, visible.to);
      if (start >= end) continue;
      const a = editor.domAtPos(start, 1), b = editor.domAtPos(end, -1);
      const range = document.createRange(); range.setStart(a.node, a.offset); range.setEnd(b.node, b.offset);
      result.push(...Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0));
    }
    const bounds = editor.scrollDOM.getBoundingClientRect();
    return result.flatMap((r) => {
      const left = Math.max(r.left, bounds.left), top = Math.max(r.top, bounds.top), right = Math.min(r.right, bounds.right), bottom = Math.min(r.bottom, bounds.bottom);
      return right > left && bottom > top ? [new DOMRect(left, top, right - left, bottom - top)] : [];
    });
  }
  useImperativeHandle(ref, () => ({
    rects,
    selection: () => {
      const editor = view.current;
      if (!editor) return null;
      const selection = editor.state.selection.main;
      const rect = rects(selection.from, selection.to)[0];
      return rect ? { from: selection.from, to: selection.to, rect } : null;
    },
    replace: (content) => {
      const editor = view.current;
      if (editor && content !== editor.state.doc.toString()) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: content }, annotations: Transaction.userEvent.of("fussenn.load") });
    },
    reveal: (from, focus = false) => {
      const editor = view.current;
      if (!editor) return;
      const anchor = Math.max(0, Math.min(from, editor.state.doc.length));
      editor.dispatch({ ...(focus ? { selection: { anchor } } : {}), effects: EditorView.scrollIntoView(anchor, { y: "center" }) });
      if (focus) editor.focus();
    },
    position: () => view.current?.state.selection.main.head ?? 0,
    measure: () => view.current?.requestMeasure(),
    composing: () => view.current?.compositionStarted ?? false,
  }));
  return <div ref={container} className="manuscript-editor" data-testid="manuscript-editor" />;
}
