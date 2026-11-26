"use client";
import { Check, Copy, Sparkles } from "lucide-react";
import { useState } from "react";
import type { Message } from "@/lib/types";
import type { PendingActivity } from "@/hooks/use-chat-stream";
import { Markdown } from "@/components/common/markdown";
import { AnswerProgress } from "./chat-controls";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return <button className="text-button copy-button" onClick={async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { setCopied(false); }
  }} aria-label="回答をコピー">{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "コピーしました" : "コピー"}</button>;
}
export function MessageList({ messages, onEdit, activity }: { messages: Message[]; onEdit?: (id: string) => void; activity?: PendingActivity | null }) {
  return <div className="message-list">{messages.map((message) => <article key={message.id} className={`message ${message.role}`} data-testid={`message-${message.role}`}>
    <div className="message-label">{message.role === "assistant" ? <><span className="assistant-mark"><Sparkles size={13} /></span> AI</> : "あなた"}</div>
    {message.role === "assistant" ? <>
      <div className="markdown" data-message-id={message.id} data-status={message.status}>
        <Markdown>{message.content}</Markdown>
        {!message.content && message.status === "streaming" && !activity && <span className="thinking">考えています<span>…</span></span>}
      </div>
      {message.status === "streaming" && activity && (!message.content || activity.kind !== "writing") && <AnswerProgress activity={activity} />}
      {message.status === "streaming" && message.content && (!activity || activity.kind === "writing") && <span className="stream-cursor" />}
      {message.status === "error" && (message.stopped ? <p className="inline-note">回答を止めました。{message.content ? "ここまでの文章を残しています。" : ""}</p> : <p className="inline-error">回答が中断されました。続きは新しいメッセージで質問できます。</p>)}
      {message.status !== "streaming" && message.content && <CopyButton text={message.content} />}
      {message.status === "complete" && message.content && onEdit && <button className="text-button" onClick={() => onEdit(message.id)}>原稿として編集</button>}
    </> : <div className="user-text">{message.content}</div>}
  </article>)}</div>;
}
