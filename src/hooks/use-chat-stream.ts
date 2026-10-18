"use client";
import { useEffect, useRef, useState } from "react";
import type { Message, StreamEvent } from "@/lib/types";
import { readEventStream } from "@/lib/stream/ndjson";
import { workspaceFetch } from "@/lib/workspace-request";

export function applyStreamEvent(messages: Message[], event: StreamEvent): Message[] {
  if (event.type === "started") return [...messages, event.userMessage, event.assistantMessage];
  if (event.type === "text_delta") return messages.map((m, i) => i === messages.length - 1 ? { ...m, content: m.content + event.text } : m);
  if (event.type === "completed") return messages.map((m) => m.id === event.messageId ? { ...m, content: event.text, status: "complete" } : m);
  return messages.map((m) => m.id === event.messageId ? { ...m, status: "error" } : m);
}
export function useChatStream() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  async function send(kind: "main" | "note", ownerId: string, text: string, onEvent: (event: StreamEvent) => void) {
    if (abortRef.current) return false;
    const abort = new AbortController();
    abortRef.current = abort;
    setBusy(true); setError("");
    try {
      const response = await workspaceFetch(`chat/${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ownerId, text }), signal: abort.signal });
      if (!response.ok) throw new Error((await response.json()).error || "送信できませんでした。");
      if (!response.body) throw new Error("ストリームを開始できませんでした。");
      await readEventStream(response.body, (event) => {
        onEvent(event);
        if (event.type === "error") setError(event.message);
      });
      return true;
    } catch (error) {
      if (!abort.signal.aborted) setError(error instanceof Error ? error.message : "接続できませんでした。");
      return false;
    } finally { abortRef.current = null; setBusy(false); }
  }
  return { busy, error, send, clearError: () => setError("") };
}
