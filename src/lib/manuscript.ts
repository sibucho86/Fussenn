import { diffChars } from "diff";

export const MAX_MANUSCRIPT_LENGTH = 100_000;
export type Edit = { from: number; to: number; insert: string };
export type Attachment = { from: number | null; to: number | null };
export type ApplyMode = "replace" | "before" | "after";
export function manuscriptEdits(before: string, after: string): Edit[] {
  const parts = diffChars(before, after, { timeout: 300 });
  if (!parts) return [{ from: 0, to: before.length, insert: after }];
  const edits: Edit[] = [];
  let position = 0;
  for (const part of parts) {
    if (!part.added && !part.removed) { position += part.value.length; continue; }
    let edit = edits.at(-1);
    if (!edit || edit.to !== position) { edit = { from: position, to: position, insert: "" }; edits.push(edit); }
    if (part.removed) { position += part.value.length; edit.to = position; }
    else edit.insert += part.value;
  }
  return edits;
}
export function moveAttachment(anchor: Attachment, edits: Edit[]): Attachment {
  if (anchor.from === null || anchor.to === null) return { from: null, to: null };
  let shift = 0;
  for (const edit of edits) {
    const intersects = edit.from < anchor.to && edit.to > anchor.from;
    const insertedInside = edit.from === edit.to && edit.from > anchor.from && edit.from < anchor.to;
    const cursorDeleted = anchor.from === anchor.to && edit.from <= anchor.from && edit.to > anchor.from;
    if (intersects || insertedInside || cursorDeleted) return { from: null, to: null };
    if (edit.to <= anchor.from) shift += edit.insert.length - (edit.to - edit.from);
  }
  return { from: anchor.from + shift, to: anchor.to + shift };
}
export function proposalEdit(from: number, to: number, draft: string, mode: ApplyMode): Edit {
  return { from: mode === "after" ? to : from, to: mode === "before" ? from : to, insert: draft };
}
