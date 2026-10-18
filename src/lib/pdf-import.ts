import { MAX_DOCUMENT_CHARACTERS, MAX_PDF_PAGES, validateDocument, type ImportedFile } from "./document-import";

// PDF.js is loaded only in the browser. Binary PDFs are never uploaded to a service.
export async function readPdfFile(file: File, options: { signal?: AbortSignal; onProgress?: (page: number, total: number) => void }): Promise<ImportedFile> {
  options.signal?.throwIfAborted();
  const { getDocument, PDFWorker } = await import("pdfjs-dist");
  const data = new Uint8Array(await file.arrayBuffer());
  options.signal?.throwIfAborted();
  const assets = new URL("/pdfjs/", window.location.href).href;
  // An explicit port also works on the desktop's custom origin without a blob worker.
  const port = new Worker(`${assets}pdf.worker.min.mjs`, { type: "module" });
  const worker = PDFWorker.create({ port });
  const task = getDocument({ data, worker, cMapUrl: `${assets}cmaps/`, cMapPacked: true, standardFontDataUrl: `${assets}standard_fonts/`, useWorkerFetch: true, useWasm: false, disableFontFace: true, stopAtErrors: true });
  let interrupt: (error: Error) => void = () => {};
  let stopped = false;
  const interrupted = new Promise<never>((_resolve, reject) => { interrupt = reject; });
  const stop = (message: string) => { stopped = true; interrupt(new Error(message)); };
  const abort = () => stop("PDFの読み込みを中止しました。");
  options.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => stop("PDFの解析に時間がかかっています。ページを分割して取り込んでください。"), 60_000);
  try {
    return await Promise.race([(async () => {
      const pdf = await task.promise;
      if (pdf.numPages > MAX_PDF_PAGES) throw new Error("PDFは200ページ以内に分割して取り込んでください。");
      const pages: string[] = [], emptyPages: number[] = [];
      let length = 0, hasText = false;
      for (let number = 1; number <= pdf.numPages; number++) {
        options.signal?.throwIfAborted(); options.onProgress?.(number, pdf.numPages);
        const page = await pdf.getPage(number), text = await page.getTextContent();
        let body = "", previous: { x: number; y: number; width: number; height: number; str: string } | null = null;
        for (const item of text.items) {
          if (!("str" in item)) continue;
          const x = item.transform[4], y = item.transform[5];
          if (previous && item.str) {
            if (Math.abs(y - previous.y) > Math.max(2, Math.min(previous.height, item.height) * 0.5)) body += "\n";
            else if (!/\s$/.test(body) && !/^\s/.test(item.str) && x - previous.x - previous.width > Math.max(1, item.height * 0.15)) body += " ";
          }
          body += item.str.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
          previous = { x, y, width: item.width, height: item.height, str: item.str };
          if (item.hasEOL) { body += "\n"; previous = null; }
          if (length + body.length > MAX_DOCUMENT_CHARACTERS) throw new Error("抽出した本文が10万文字を超えています。PDFを分割して取り込んでください。");
        }
        body = body.trim();
        if (body) hasText = true; else emptyPages.push(number);
        const section = `【PDF ${number} / ${pdf.numPages} ページ】\n${body || "（このページから文字を抽出できませんでした）"}`;
        length += section.length + (pages.length ? 2 : 0);
        if (length > MAX_DOCUMENT_CHARACTERS) throw new Error("抽出した本文が10万文字を超えています。PDFを分割して取り込んでください。");
        pages.push(section); page.cleanup();
      }
      if (!hasText) throw new Error("このPDFから文字を抽出できませんでした。スキャン画像などのPDFは、OCRで文字認識してから取り込んでください。");
      const content = pages.join("\n\n");
      validateDocument(file.name, content, true);
      return { fileName: file.name, format: "pdf" as const, content, pageCount: pdf.numPages, emptyPages };
    })(), interrupted]);
  } catch (error) {
    if ((error as Error).name === "PasswordException") throw new Error("パスワードで保護されたPDFには対応していません。保護を解除したファイルを選んでください。");
    if ((error as Error).name === "InvalidPDFException") throw new Error("PDFを読み込めませんでした。ファイルが壊れていないか確認してください。");
    if (error instanceof Error && /[ぁ-んァ-ヶ一-龠]/.test(error.message)) throw error;
    throw new Error("PDFを解析できませんでした。別のPDFとして保存し直すか、ページを分割してお試しください。");
  } finally {
    clearTimeout(timeout); options.signal?.removeEventListener("abort", abort);
    const cleanup = task.destroy().catch(() => {});
    // A busy or unresponsive parser cannot acknowledge destroy. Always terminate
    // the dedicated worker, including while it is loading fonts or its module.
    if (!stopped) {
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([cleanup, new Promise<void>((resolve) => { cleanupTimer = setTimeout(resolve, 1000); })]);
      clearTimeout(cleanupTimer);
    }
    worker.destroy(); port.terminate();
  }
}
