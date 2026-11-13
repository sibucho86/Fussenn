import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { APPEARANCE_SCRIPT, DEFAULT_APPEARANCE, parseAppearance, TEXT_SIZES } from "@/lib/appearance";

// Runs the head script against a stand-in document and storage, as a browser would before the first paint.
function boot(saved: Record<string, string> | "blocked") {
  const style: Record<string, string> = {};
  const root = { dataset: {} as Record<string, string>, style: { setProperty: (name: string, value: string) => { style[name] = value; } } };
  const localStorage = { getItem: (key: string) => { if (saved === "blocked") throw new Error("SecurityError"); return saved[key] ?? null; } };
  runInNewContext(APPEARANCE_SCRIPT, { document: { documentElement: root }, localStorage, String });
  return { theme: root.dataset.theme, scale: style["--text-scale"] };
}
describe("appearance", () => {
  it("reads only known values", () => {
    expect(parseAppearance("dark", "larger")).toEqual({ theme: "dark", textSize: "larger" });
    expect(parseAppearance("sepia", "huge")).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance(null, null)).toEqual({ theme: "system", textSize: "standard" });
  });
  it("applies the saved look before the page renders", () => {
    expect(boot({ "fussenn:theme": "dark", "fussenn:text-size": "largest" })).toEqual({ theme: "dark", scale: "1.5" });
    expect(boot({ "fussenn:theme": "light", "fussenn:text-size": "large" })).toEqual({ theme: "light", scale: "1.15" });
    expect(boot({})).toEqual({ theme: "system", scale: "1" });
    expect(boot({ "fussenn:theme": "<img>", "fussenn:text-size": "toString" })).toEqual({ theme: "system", scale: "1" });
    expect(boot("blocked")).toEqual({ theme: "system", scale: "1" });
  });
  it("keeps the text sizes in increasing order from the standard size", () => {
    expect(TEXT_SIZES[0]).toMatchObject({ value: "standard", scale: 1 });
    const scales = TEXT_SIZES.map((option) => option.scale);
    expect([...scales].sort((a, b) => a - b)).toEqual(scales);
  });
});
