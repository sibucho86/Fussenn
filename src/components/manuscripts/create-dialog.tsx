"use client";
import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { api } from "@/lib/api";
import { readDocumentFile } from "@/lib/document-import";
import type { ConversationDetail } from "@/lib/types";
import { ManuscriptDialog } from "./dialog";

export function CreateManuscriptDialog({ initialTitle, sourceMessageId, onClose, onCreated }: {
  initialTitle: string; sourceMessageId?: string; onClose: () => void; onCreated: (row: ConversationDetail) => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [mode, setMode] = useState<"blank" | "file">("blank");
  const [file, setFile] = useState<Awaited<ReturnType<typeof readDocumentFile>> | null>(null);
  const [working, setWorking] = useState(false), [error, setError] = useState("");
  const pending = useRef(false), titleEdited = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const importing = !sourceMessageId && mode === "file";
  async function choose(files: FileList | null) {
    if (pending.current || !files?.length) return;
    setFile(null); setError("");
    if (files.length !== 1) { setError("原稿は1ファイルずつ取り込んでください。"); return; }
    pending.current = true; setWorking(true);
    try {
      const selected = await readDocumentFile(files[0]);
      setFile(selected);
      if (!titleEdited.current) setTitle((selected.fileName.replace(/\.(md|markdown|txt)$/i, "").trim() || "新しい原稿").slice(0, 100).replace(/[\uD800-\uDBFF]$/, ""));
    } catch (e) { setError((e as Error).message); }
    finally { pending.current = false; setWorking(false); }
  }
  async function create() {
    if (pending.current || !title.trim() || (importing && !file)) return;
    pending.current = true; setWorking(true); setError("");
    try {
      const row = await api<ConversationDetail>("manuscripts", { method: "POST", body: JSON.stringify({ title, ...(sourceMessageId ? { sourceMessageId } : importing ? { file: { fileName: file!.fileName, content: file!.content } } : {}) }) });
      onCreated(row);
    } catch (e) { setError((e as Error).message); }
    finally { pending.current = false; setWorking(false); }
  }
  return <ManuscriptDialog title={sourceMessageId ? "この本文から原稿を作る" : "新しい原稿"} onClose={() => { if (!pending.current) onClose(); }} busy={working}>
    <form onSubmit={(e) => { e.preventDefault(); void create(); }}>
      {!sourceMessageId && <div className="manuscript-apply-modes" role="group" aria-label="原稿の始め方">
        <button type="button" aria-pressed={mode === "blank"} disabled={working} onClick={() => { setMode("blank"); setError(""); }}>白紙から始める</button>
        <button type="button" aria-pressed={mode === "file"} disabled={working} onClick={() => { setMode("file"); setError(""); }}>ファイルから取り込む</button>
      </div>}
      <label className="manuscript-title-input">原稿のタイトル<input aria-label="原稿のタイトル" maxLength={100} value={title} disabled={working} onChange={(e) => { titleEdited.current = true; setTitle(e.target.value); }} autoFocus /></label>
      {importing ? <>
        <p>書きかけの文章を取り込んで、編集や付箋での推敲を続けられます。</p>
        <div className="document-drop" onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = working ? "none" : "copy"; }} onDrop={(e) => { e.preventDefault(); void choose(e.dataTransfer.files); }}>
          <Upload size={24} /><strong>Markdown・テキストをここにドロップ</strong>
          <button type="button" className="secondary-button" disabled={working} onClick={() => fileInput.current?.click()}>{file ? "別のファイルを選ぶ" : "ファイルを選ぶ"}</button>
          <input ref={fileInput} hidden type="file" aria-label="取り込む原稿ファイル" accept=".md,.markdown,.txt,text/markdown,text/plain" disabled={working} onChange={(e) => { void choose(e.target.files); e.target.value = ""; }} />
          <small>UTF-8 · 1MB / 10万文字まで · 1ファイルずつ</small>
        </div>
        {file && <div className="document-import-preview"><strong>{file.fileName}</strong><span>{file.content.length.toLocaleString("ja-JP")}文字</span><pre>{file.content.slice(0, 400)}{file.content.length > 400 ? "…" : ""}</pre></div>}
        <p className="manuscript-caption">本文をFussenn内にコピーして保存します。元ファイルへの書き戻しや同期は行いません。</p>
      </> : <p>{sourceMessageId ? "本文をコピーして、編集できる原稿を作ります。元の資料・会話と付箋はそのまま残ります。" : "一章ずつ原稿を作成し、フォルダにまとめて整理できます。"}</p>}
      {error && <p role="alert" className="inline-error">{error}</p>}
      <div className="manuscript-dialog-actions"><button type="button" className="secondary-button" disabled={working} onClick={onClose}>キャンセル</button><button className="primary-button" disabled={!title.trim() || working || (importing && !file)}>{working ? "処理中…" : importing ? "原稿として取り込む" : "原稿を作成"}</button></div>
    </form>
  </ManuscriptDialog>;
}
