import { FileText, StickyNote } from "lucide-react";
import { Markdown } from "@/components/common/markdown";
import type { ConversationDetail } from "@/lib/types";

export function DocumentView({ detail, onEdit }: { detail: ConversationDetail; onEdit?: () => void }) {
  const source = detail.document!;
  const message = detail.messages.find((message) => message.id === source.messageId);
  return <article className="main-column document-column" aria-label="取り込んだ資料">
    <header className="document-heading"><span className="eyebrow"><FileText size={14} /> IMPORTED DOCUMENT</span><h1>{detail.title}</h1><div className="document-metadata"><span title={source.fileName}>{source.fileName}</span><span>{source.format === "pdf" ? "PDFから抽出した本文" : source.format === "markdown" ? "Markdown" : "テキスト"}</span><span>読み取り専用</span><time>{new Date(detail.createdAt).toLocaleDateString("ja-JP")} 取り込み</time></div></header>
    {onEdit && <button className="secondary-button" onClick={onEdit}>原稿として編集</button>}
    <p className="document-context">付箋AIの参照範囲：この資料の全文と選択した箇所</p>
    {message ? <div className={source.format === "markdown" ? "markdown document-body" : "document-plain document-body"} data-testid="document-body" data-message-id={message.id} data-status="complete">{source.format === "markdown" ? <Markdown>{message.content}</Markdown> : message.content}</div> : <p>資料の本文が見つかりません。</p>}
    <p className="selection-tip"><StickyNote size={13} />本文の気になる言葉を選択して、付箋を貼れます。</p>
  </article>;
}
