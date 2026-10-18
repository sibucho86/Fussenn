"use client";
import { useEffect, useRef, useState } from "react";
import { FileText, LoaderCircle, Upload, X } from "lucide-react";
import { readDocumentFile } from "@/lib/document-import";
import { api } from "@/lib/api";
import type { ConversationDetail } from "@/lib/types";

export function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: (document: ConversationDetail) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const reading = useRef<AbortController | null>(null);
  const saving = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [document, setDocument] = useState<Awaited<ReturnType<typeof readDocumentFile>> | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => { reading.current?.abort(); element.close(); }; }, []);
  function close() { if (!saving.current) { reading.current?.abort(); dialog.current?.close(); onClose(); } }
  async function choose(files: FileList | null) {
    if (pending.current || !files?.length) return;
    setDocument(null); setError("");
    if (files.length !== 1) { setError("資料は1ファイルずつ取り込んでください。"); return; }
    pending.current = true; setWorking(true);
    const abort = new AbortController(); reading.current = abort; setProgress("ファイルを読み込んでいます…");
    try { setDocument(await readDocumentFile(files[0], { allowPdf: true, signal: abort.signal, onProgress: (page, total) => setProgress(`PDFから本文を抽出中… ${page} / ${total} ページ`) })); }
    catch (error) { if (!abort.signal.aborted) setError(error instanceof Error ? error.message : "ファイルを読み込めませんでした。"); }
    finally { pending.current = false; reading.current = null; setWorking(false); setProgress(""); }
  }
  async function importFile() {
    if (!document || pending.current) return;
    pending.current = true; saving.current = true; setWorking(true); setError("");
    try {
      const row = await api<ConversationDetail>("documents", { method: "POST", body: JSON.stringify({ fileName: document.fileName, content: document.content }) });
      dialog.current?.close(); onImported(row);
    } catch (error) { setError(error instanceof Error ? error.message : "資料を保存できませんでした。もう一度お試しください。"); }
    finally { pending.current = false; saving.current = false; setWorking(false); }
  }
  return <dialog ref={dialog} className="organization-dialog document-import-dialog" aria-labelledby="document-import-title" onCancel={(event) => { event.preventDefault(); close(); }}>
    <form onSubmit={(event) => { event.preventDefault(); void importFile(); }}>
      <div className="organization-heading"><span className="organization-icon"><FileText size={19} /></span><h2 id="document-import-title">資料を開く</h2><button type="button" className="icon-button" aria-label="資料の取り込みを閉じる" disabled={working && !progress} onClick={close}><X size={17} /></button></div>
      <p className="organization-description">手元の資料を読みながら、気になる言葉に付箋を貼れます。取り込んだ本文は読み取り専用で保存します。</p>
      <div className="document-drop" onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }} onDrop={(event) => { event.preventDefault(); void choose(event.dataTransfer.files); }}>
        <Upload size={24} /><strong>Markdown・テキスト・PDFをここにドロップ</strong>
        <button type="button" className="secondary-button" disabled={working} onClick={() => fileInput.current?.click()}>{document ? "別のファイルを選ぶ" : "ファイルを選ぶ"}</button>
        <input ref={fileInput} hidden type="file" aria-label="取り込む資料ファイル" accept=".md,.markdown,.txt,.pdf,text/markdown,text/plain,application/pdf" disabled={working} onChange={(event) => { void choose(event.target.files); event.target.value = ""; }} />
        <small>MD / TXT：UTF-8・1MBまで　PDF：10MB・200ページまで<br />本文10万文字まで · 1ファイルずつ</small>
      </div>
      {progress && <p role="status" className="document-import-hint">{progress}</p>}
      {document && <div className="document-import-preview"><strong>{document.fileName}</strong><span>{document.format === "pdf" ? `PDF · ${document.pageCount}ページ` : document.format === "markdown" ? "Markdown" : "テキスト"} · {document.content.length.toLocaleString("ja-JP")}文字</span><pre>{document.content.slice(0, 400)}{document.content.length > 400 ? "…" : ""}</pre></div>}
      {document?.format === "pdf" && <p className="document-import-hint">PDFから抽出した本文とページ番号を保存します。画像・元のレイアウト・PDFファイル本体は保存しません。段組みや表は順序が崩れる場合があるため、プレビューを確認してください。{document.emptyPages?.length ? ` 文字を抽出できないページ：${document.emptyPages.join("、")}。画像のページにはOCRが必要です。` : ""}</p>}
      <p className="document-import-hint">取り込みだけではAIに送信しません。付箋から質問したときに、この資料の全文と選択箇所を参照します。</p>
      {error && <p className="organization-error" role="alert">{error}</p>}
      <div className="organization-footer"><div className="organization-buttons"><button type="button" className="secondary-button" disabled={working && !progress} onClick={close}>キャンセル</button><button type="submit" className="primary-button" disabled={working || !document}>{working ? <><LoaderCircle size={13} className="spin" />{progress ? "読み込み中…" : "保存中…"}</> : "資料を取り込む"}</button></div></div>
    </form>
  </dialog>;
}
