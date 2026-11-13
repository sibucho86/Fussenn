import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The dark theme and the text-size setting depend on every stylesheet rule taking part.
const files = ["src/app/globals.css", "src/components/manuscripts/manuscripts.css"];
function withoutLightDark(css) {
  let out = "", index = 0;
  for (;;) {
    const start = css.indexOf("light-dark(", index);
    if (start < 0) return out + css.slice(index);
    out += css.slice(index, start);
    let depth = 0, end = start + "light-dark".length;
    for (; end < css.length; end++) {
      if (css[end] === "(") depth++;
      else if (css[end] === ")" && --depth === 0) break;
    }
    index = end + 1;
  }
}
test("every color in the app styles has a dark counterpart", () => {
  for (const file of files) {
    const leftovers = withoutLightDark(readFileSync(file, "utf8")).match(/#[0-9a-fA-F]{3,8}\b|\b(?:white|black)\b(?!-)/g) ?? [];
    assert.deepEqual(leftovers, [], `${file}: write these colors as light-dark(light, dark)`);
  }
});
test("text sizes follow the text-size setting", () => {
  for (const file of files) {
    const fixed = readFileSync(file, "utf8").match(/font(?:-size)?:\s*\d+(?:\.\d+)?px/g) ?? [];
    assert.deepEqual(fixed, [], `${file}: write font sizes as calc(<size>px * var(--text-scale))`);
  }
});
