import type { ChatProvider, GenerationRequest, GenerationEvent } from "../provider";

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener("abort", stop); resolve(); }, ms);
    const stop = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
    if (signal?.aborted) stop(); else signal?.addEventListener("abort", stop, { once: true });
  });
}
export class MockProvider implements ChatProvider {
  constructor(private delay = 16) {}
  async generate(request: GenerationRequest, emit: (event: GenerationEvent) => void) {
    let text: string;
    emit({ type: "activity", activity: { kind: "thinking" } });
    // "[slow]" holds the answer back for a few seconds, so the progress line can be tried and tested.
    if (request.userText.startsWith("[slow]")) {
      await wait(1500, request.signal);
      if (request.webSearch) emit({ type: "activity", activity: { kind: "searching", detail: "Fussenn デモの検索" } });
      await wait(2500, request.signal);
    } else if (request.webSearch) emit({ type: "activity", activity: { kind: "searching", detail: "Fussenn デモの検索" } });
    if (request.userText === "[context]") {
      text = JSON.stringify(request.messages);
    } else if (request.userText === "[options]") {
      text = JSON.stringify({ effort: request.effort ?? null, webSearch: request.webSearch === true });
    } else if (request.ownerType === "side_note") {
      const reference = request.messages.find((m) => m.content.includes("[SELECTED TEXT]"))?.content ?? "";
      const selected = reference.split("[SELECTED TEXT]\n")[1]?.split("\n[END SELECTED TEXT]")[0] ?? "選択した文章";
      text = `**${selected}** について、この会話の文脈で考えてみましょう。\n\nResource は、AIが参照できる「情報」です。たとえば設計仕様書やデータベースの内容がこれにあたります。\n\n一方、Tool は「処理を実行する機能」です。本棚の資料が Resource、資料を探す作業が Tool、と考えると違いが分かります。\n\n> これは Mock Provider のデモ回答です。実際のAI推論は行っていません。`;
    } else {
      text = `## 知識を、少しずつつなげる\n\n「${request.userText}」について、まずは全体像を見てみましょう。\n\nMCP（Model Context Protocol）は、AIアプリケーションと外部のデータや機能をつなぐための共通プロトコルです。主に、次の3つの要素があります。\n\n- **Tool** — 検索や計算など、処理を実行する機能\n- **Resource** — ドキュメントやデータなど、参照できる情報\n- **Prompt** — よく使うやり取りをまとめたテンプレート\n\n### たとえば、本を読むように\n\nResource は本に書かれた情報、Tool はその情報を使って何かをする手段です。気になる言葉を選択して付箋を貼ると、本題を保ったまま理解を深められます。\n\n\`\`\`typescript\nconst note = { selectedText: "Resource", memo: "これって何？" };\n\`\`\`\n\n> これは Mock Provider のデモ回答です。設定から実際のAIに接続できます。`;
    }
    let result = "";
    for (const chunk of text.match(/.{1,14}|\n/g) ?? []) {
      request.signal?.throwIfAborted();
      if (this.delay) await new Promise((resolve) => setTimeout(resolve, this.delay));
      result += chunk;
      emit({ type: "text_delta", text: chunk });
    }
    return { text: result };
  }
}
