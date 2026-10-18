import type { DocumentFormat } from "./types";
export const MAX_DOCUMENT_CHARACTERS = 100_000;
export const MAX_DOCUMENT_BYTES = 1_048_576;
export const MAX_PDF_BYTES = 10 * 1_048_576;
export const MAX_PDF_PAGES = 200;
export type ImportedFile = { fileName: string; format: DocumentFormat; content: string; pageCount?: number; emptyPages?: number[] };

export function documentFormat(fileName: string, allowPdf = false): DocumentFormat {
  if (/\.(md|markdown)$/i.test(fileName)) return "markdown";
  if (/\.txt$/i.test(fileName)) return "text";
  if (allowPdf && /\.pdf$/i.test(fileName)) return "pdf";
  throw new Error(allowPdf ? ".md・.markdown・.txt・.pdf のファイルを選んでください。" : ".md・.markdown・.txt のファイルを選んでください。");
}
export function validateDocument(fileName: string, content: string, allowPdf = false) {
  const format = documentFormat(fileName, allowPdf);
  if (!fileName.trim() || fileName.length > 255 || /[/\\]/.test(fileName) || Array.from(fileName).some((c) => c.charCodeAt(0) < 32)) throw new Error("ファイル名を確認してください。");
  if (!content.trim()) throw new Error("ファイルに本文がありません。");
  if (content.length > MAX_DOCUMENT_CHARACTERS) throw new Error("資料は10万文字以内にしてください。");
  if (Array.from(content).some((c) => c.charCodeAt(0) < 32 && !"\n\r\t".includes(c))) throw new Error("テキストとして読み込めないデータが含まれています。");
  return format;
}
export async function readDocumentFile(file: File, options: { allowPdf?: boolean; signal?: AbortSignal; onProgress?: (page: number, total: number) => void } = {}): Promise<ImportedFile> {
  const kind = documentFormat(file.name, options.allowPdf);
  if (kind === "pdf") {
    if (file.size > MAX_PDF_BYTES) throw new Error("PDFは10MB以内にしてください。");
    const { readPdfFile } = await import("./pdf-import");
    return readPdfFile(file, options);
  }
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error("ファイルは1MB以内にしてください。");
  let content: string;
  try { content = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()); }
  catch { throw new Error("UTF-8のテキストとして読み込めませんでした。文字コードをUTF-8にして保存し直してください。"); }
  const format = validateDocument(file.name, content);
  return { fileName: file.name, format, content };
}
