import { expect, it } from "vitest";
import { analyzeManuscript } from "@/lib/manuscript-preview";

it("finds real Markdown headings and their source positions, including duplicates and setext", () => {
  const source = "# 第一章 **猫**\n\n```md\n# これはコード\n```\n\n第二章\n---\n\n## 同じ見出し\n\n## 同じ見出し\n\n> ### 引用内の見出し";
  expect(analyzeManuscript(source).headings).toEqual([
    { from: 0, depth: 1, title: "第一章 猫" },
    { from: source.indexOf("第二章"), depth: 2, title: "第二章" },
    { from: source.indexOf("## 同じ"), depth: 2, title: "同じ見出し" },
    { from: source.lastIndexOf("## 同じ"), depth: 2, title: "同じ見出し" },
    { from: source.indexOf("### 引用"), depth: 3, title: "引用内の見出し" },
  ]);
});
it("counts visible Unicode characters without Markdown syntax, destinations or whitespace", () => {
  expect(analyzeManuscript("# 猫🐈\n\n**文章** と [資料](https://example.com) &amp; `code`\n\n[参照]: https://example.org").characters).toBe(Array.from("猫🐈文章と資料&code").length);
  expect(analyzeManuscript(" \n")).toEqual({ headings: [], characters: 0 });
});
