import { expect, it } from "vitest";
import { MAX_DOCUMENT_BYTES, MAX_DOCUMENT_CHARACTERS, readDocumentFile, validateDocument } from "@/lib/document-import";

it("reads UTF-8 including a BOM and preserves Markdown, Unicode and CRLF source text", async () => {
  const content = "# 日本語の資料 📝\r\n\r\n**重要**\r\n\t  字下げを残す  \r\n";
  expect(await readDocumentFile(new File(["\uFEFF" + content], "資料.MD"))).toEqual({ fileName: "資料.MD", format: "markdown", content });
  expect(await readDocumentFile(new File([content], "資料.txt"))).toEqual({ fileName: "資料.txt", format: "text", content });
});

it("rejects unsupported, empty, binary, malformed UTF-8 and excessive input", async () => {
  await expect(readDocumentFile(new File(["本文"], "article.pdf"))).rejects.toThrow(".md");
  await expect(readDocumentFile(new File([" \r\n\t"], "empty.txt"))).rejects.toThrow("本文がありません");
  await expect(readDocumentFile(new File(["binary\0data"], "binary.txt"))).rejects.toThrow("読み込めないデータ");
  await expect(readDocumentFile(new File([new Uint8Array([0x82, 0xa0])], "shift-jis.txt"))).rejects.toThrow("UTF-8");
  await expect(readDocumentFile(new File([new Uint8Array(MAX_DOCUMENT_BYTES + 1)], "large.md"))).rejects.toThrow("1MB");
  expect(() => validateDocument("long.txt", "あ".repeat(MAX_DOCUMENT_CHARACTERS + 1))).toThrow("10万文字");
  expect(() => validateDocument("../outside.md", "本文")).toThrow("ファイル名");
  expect(validateDocument("long.markdown", "a".repeat(MAX_DOCUMENT_CHARACTERS))).toBe("markdown");
});
