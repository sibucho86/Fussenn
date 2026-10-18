import type { StreamEvent } from "@/lib/types";

export async function readEventStream(body: ReadableStream<Uint8Array>, onEvent: (event: StreamEvent) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let finished = false;
  function line(value: string) {
    if (!value.trim()) return;
    const event = JSON.parse(value) as StreamEvent;
    if (event.type === "completed" || event.type === "error") finished = true;
    onEvent(event);
  }
  try {
    for (;;) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const value of lines) line(value);
      if (done) break;
    }
    if (pending) line(pending);
    if (!finished) throw new Error("接続が途切れました。保存された履歴を再読み込みしてください。");
  } finally { reader.releaseLock(); }
}
