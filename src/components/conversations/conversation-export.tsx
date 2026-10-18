"use client";
import { useRef, useState } from "react";
import { Download, LoaderCircle, X } from "lucide-react";
import type { ConversationDetail } from "@/lib/types";

export function ConversationExport({ conversation, folderName, disabled }: {
  conversation: ConversationDetail | null; folderName: string | null; disabled: boolean;
}) {
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState("");
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);
  async function download() {
    if (!conversation || disabled || pending.current) return;
    pending.current = true; setExporting(true); setNotice(""); setFailed(false);
    let url: string | undefined;
    try {
      // Capture before loading the ZIP code, including memo edits that have not reached autosave yet.
      const snapshot = structuredClone(conversation);
      const exportedAt = new Date();
      const { createObsidianArchive } = await import("@/lib/obsidian-export");
      const { archiveName, data } = await createObsidianArchive(snapshot, { folderName, exportedAt });
      url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: "application/zip" }));
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = archiveName;
      document.body.appendChild(anchor);
      try { anchor.click(); } finally { anchor.remove(); }
      setNotice(`「${snapshot.title}」のZIPを用意しました。保存したZIPを展開し、フォルダをObsidianの保管庫に入れてください。`);
    } catch {
      setFailed(true); setNotice("書き出せませんでした。もう一度「MD保存」を押してください。");
    } finally {
      if (url) { const objectUrl = url; window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000); }
      pending.current = false; setExporting(false);
    }
  }
  return <div className="conversation-export">
    <button className="export-button" aria-label="Obsidian用Markdownを書き出す" aria-busy={exporting} title={`${conversation?.document ? "資料" : "会話"}と付箋を相互リンク付きMarkdownで保存（ZIP）`} disabled={disabled || !conversation || exporting} onClick={() => void download()}>
      {exporting ? <LoaderCircle size={14} className="export-spinner" /> : <Download size={14} />}<span>{exporting ? "書き出し中…" : "MD保存"}</span>
    </button>
    {notice && <div className="export-notice" data-error={failed}><p role={failed ? "alert" : "status"}>{notice}</p><button className="icon-button" aria-label="書き出しの案内を閉じる" onClick={() => setNotice("")}><X size={14} /></button></div>}
  </div>;
}
