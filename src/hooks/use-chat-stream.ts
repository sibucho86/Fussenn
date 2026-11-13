"use client";
import { useEffect, useRef, useState } from "react";
import type { ChatActivity, ChatOptions, Message, StreamEvent } from "@/lib/types";
import { activityLabel } from "@/lib/chat-options";
import { readEventStream } from "@/lib/stream/ndjson";
import { workspaceFetch } from "@/lib/workspace-request";

export function applyStreamEvent(messages: Message[], event: StreamEvent): Message[] {
  if (event.type === "started") return [...messages, event.userMessage, event.assistantMessage];
  if (event.type === "text_delta") return messages.map((m, i) => i === messages.length - 1 ? { ...m, content: m.content + event.text } : m);
  if (event.type === "activity") return messages;
  if (event.type === "completed") return messages.map((m) => m.id === event.messageId ? { ...m, content: event.text, status: "complete" } : m);
  return messages.map((m) => m.id === event.messageId ? { ...m, status: "error", ...(event.stopped ? { stopped: true } : {}) } : m);
}
/** What the pending answer is doing, and when the question was sent. */
export type PendingActivity = ChatActivity & { startedAt: number };
export function useChatStream() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activity, setActivity] = useState<PendingActivity | null>(null);
  // The answer can be stopped once the server has saved the question; before that a stop would leave
  // the question saved on the server but missing on screen.
  const [canStop, setCanStop] = useState(false);
  // Read out by a live region that stays on the page, since a region inserted with its text is often not announced.
  const [announcement, setAnnouncement] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  async function send(kind: "main" | "note", ownerId: string, text: string, onEvent: (event: StreamEvent) => void, options?: ChatOptions) {
    if (abortRef.current) return false;
    const abort = new AbortController();
    abortRef.current = abort;
    const startedAt = Date.now();
    let answerId: string | null = null;
    let finished = false;
    let writing = false;
    setBusy(true); setError(""); setActivity({ kind: "thinking", startedAt }); setAnnouncement(activityLabel("thinking"));
    try {
      const response = await workspaceFetch(`chat/${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ownerId, text, ...options }), signal: abort.signal });
      if (!response.ok) throw new Error((await response.json()).error || "送信できませんでした。");
      if (!response.body) throw new Error("ストリームを開始できませんでした。");
      await readEventStream(response.body, (event) => {
        if (event.type === "started") { answerId = event.assistantMessage.id; setCanStop(true); }
        else if (event.type === "activity") {
          writing = event.activity.kind === "writing";
          setActivity({ ...event.activity, startedAt });
          const detail = event.activity.kind === "writing" ? undefined : event.activity.detail;
          setAnnouncement(activityLabel(event.activity.kind) + (detail ? `：${detail}` : ""));
        } else if (event.type === "text_delta") {
          if (!writing) { writing = true; setActivity({ kind: "writing", startedAt }); setAnnouncement(activityLabel("writing")); }
        } else {
          finished = true;
          setAnnouncement(event.type === "completed" ? "回答が届きました。" : "回答を完了できませんでした。");
        }
        onEvent(event);
        if (event.type === "error") setError(event.message);
      });
      return true;
    } catch (error) {
      const stopped = abort.signal.aborted;
      if (!stopped) setError(error instanceof Error ? error.message : "接続できませんでした。");
      // Once the server has saved the question, the answer ends here either way, and the draft is not restored.
      if (answerId && !finished) {
        onEvent({ type: "error", message: "", messageId: answerId, stopped });
        setAnnouncement(stopped ? "回答を止めました。" : "回答を完了できませんでした。");
      }
      return answerId !== null;
    } finally { abortRef.current = null; setBusy(false); setActivity(null); setCanStop(false); }
  }
  return {
    busy, error, activity, canStop, announcement, send,
    stop: () => { if (canStop) abortRef.current?.abort(); },
    clearError: () => setError(""),
  };
}
