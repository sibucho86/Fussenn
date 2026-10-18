import { expect, it } from "vitest";
import { readEventStream } from "@/lib/stream/ndjson";
import type { StreamEvent } from "@/lib/types";

it("parses UTF-8 and JSON split at every byte boundary", async () => {
  const bytes = new TextEncoder().encode('{"type":"text_delta","text":"付箋📝"}\n{"type":"completed","messageId":"1","text":"付箋📝"}');
  const body = new ReadableStream<Uint8Array>({ start(c) { for (const byte of bytes) c.enqueue(Uint8Array.of(byte)); c.close(); } });
  const events: StreamEvent[] = [];
  await readEventStream(body, (e) => events.push(e));
  expect(events).toHaveLength(2); expect(events[0]).toEqual({ type: "text_delta", text: "付箋📝" });
});
it("detects a disconnected stream with no terminal event", async () => {
  const body = new Response('{"type":"text_delta","text":"partial"}\n').body!;
  await expect(readEventStream(body, () => {})).rejects.toThrow("接続が途切れ");
});
