"use client";
import { Check, Copy, Sparkles } from "lucide-react";
import { useState } from "react";
import type { Message } from "@/lib/types";
import { Markdown } from "@/components/common/markdown";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return <button className="text-button copy-button" onClick={async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { setCopied(false); }
  }} aria-label="回答をコピー">{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "コピーしました" : "コピー"}</button>;
}
export function MessageList({ messages, onEdit }: { messages: Message[]; onEdit?: (id: string) => void }) {
  return <div className="message-list">{messages.map((message) => <article key={message.id} className={`message ${message.role}`} data-testid={`message-${message.role}`}>
    <div className="message-label">{message.role === "assistant" ? <><span className="assistant-mark"><Sparkles size={13} /></span> AI</> : "あなた"}</div>
    {message.role === "assistant" ? <>
      <div className="markdown" data-message-id={message.id} data-status={message.status}>
        <Markdown>{message.content}</Markdown>
        {!message.content && message.status === "streaming" && <span className="thinking">考えています<span>…</span></span>}
      </div>
      {message.status === "streaming" && message.content && <span className="stream-cursor" />}
      {message.status === "error" && <p className="inline-error">回答が中断されました。続きは新しいメッセージで質問できます。</p>}
      {message.status !== "streaming" && message.content && <CopyButton text={message.content} />}
      {message.status === "complete" && message.content && onEdit && <button className="text-button" onClick={() => onEdit(message.id)}>原稿として編集</button>}
    </> : <div className="user-text">{message.content}</div>}
  </article>)}</div>;
}
