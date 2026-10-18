// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { canonicalText, captureAnchor, restoreAnchor, resolveOffsets } from "@/lib/anchor";

function fixture() {
  const root = document.createElement("div");
  const paragraph = document.createElement("p");
  paragraph.append("MCPでは ");
  const bold = document.createElement("strong"); bold.textContent = "Resource";
  paragraph.append(bold, " を参照します。");
  const code = document.createElement("code"); code.textContent = "Tool";
  root.append(paragraph, code);
  return { root, bold, code };
}
describe("rendered text anchors", () => {
  it("restores a selection spanning markdown text nodes after reload", () => {
    const { root, bold, code } = fixture();
    const range = document.createRange(); range.setStart(bold.firstChild!, 0); range.setEnd(code.firstChild!, 4);
    const anchor = captureAnchor(root, range);
    expect(anchor.selectedText).toBe("Resource を参照します。Tool");
    expect(canonicalText(root)).not.toContain("**");
    expect(restoreAnchor(fixture().root, anchor)?.toString()).toBe(anchor.selectedText);
  });
  it("uses surrounding text to disambiguate repeated words after offsets shift", () => {
    const { root, bold } = fixture();
    const range = document.createRange(); range.selectNodeContents(bold);
    const anchor = captureAnchor(root, range);
    const updated = document.createElement("div"); updated.textContent = "Resource という見出し。" + canonicalText(root);
    const found = restoreAnchor(updated, anchor)!;
    expect(found.toString()).toBe("Resource");
    expect(resolveOffsets(updated.textContent, anchor)?.start).toBe(updated.textContent.lastIndexOf("Resource"));
  });
  it("does not silently pick an ambiguous or missing anchor", () => {
    const anchor = { selectedText: "Resource", anchorStart: 99, anchorEnd: 107, anchorPrefix: "", anchorSuffix: "", anchorVersion: 1 };
    expect(resolveOffsets("Resource / Resource", anchor)).toBeNull();
    expect(resolveOffsets("Nothing", anchor)).toBeNull();
  });
  it("rejects cross-message and oversized selections", () => {
    const { root, bold } = fixture();
    const other = document.createTextNode("outside"); const container = document.createElement("div"); container.append(root, other);
    const range = document.createRange(); range.setStart(bold.firstChild!, 0); range.setEnd(other, 3);
    expect(() => captureAnchor(root, range)).toThrow("一つのAI回答");
    root.textContent = "あ".repeat(501); range.selectNodeContents(root);
    expect(() => captureAnchor(root, range)).toThrow("500文字");
  });
});
