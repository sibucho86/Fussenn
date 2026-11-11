import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { formatChecksums, writeChecksums } from "../../scripts/release-checksums.mjs";
import { checksumsName, releaseAssets } from "../../scripts/release-assets.mjs";
import { assertLocalOnly, buildSite, formatDate, parseChecksums, releaseValues, selectBlocks } from "../../scripts/site-build.mjs";

const hash = (seed) => seed.repeat(64).slice(0, 64);
const release = (overrides = {}) => ({
  tagName: "v0.3.0", publishedAt: "2026-11-19T16:30:00Z",
  assets: [{ name: "Fussenn-mac-arm64.dmg", size: 180_191_277 }, { name: "Fussenn-win-x64.exe", size: 131_234_567 }, { name: checksumsName, size: 180 }],
  ...overrides,
});
const sums = () => parseChecksums(formatChecksums([{ name: "Fussenn-mac-arm64.dmg", sha256: hash("a") }, { name: "Fussenn-win-x64.exe", sha256: hash("b") }]));
const temporary = () => mkdtempSync(join(tmpdir(), "fussenn-site-test-"));

test("fills the page with the repository and the latest release, and loads nothing from other sites", () => {
  const out = temporary();
  try {
    buildSite({ out, repo: "owner/Fussenn", release: release(), sums: sums() });
    const html = readFileSync(join(out, "index.html"), "utf8");
    assert.doesNotMatch(html, /\{\{|\}\}/);
    assert.match(html, /バージョン\u00a00\.3\.0（2026年11月20日）/);
    assert.match(html, /180\u00a0MB/);
    assert.match(html, /131\u00a0MB/);
    assert.ok(html.includes(hash("a")) && html.includes(hash("b")));
    for (const { name } of releaseAssets) assert.ok(html.includes(`href="https://github.com/owner/Fussenn/releases/latest/download/${name}"`), name);
    assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'self'; script-src 'self';/);
    assert.match(html, /<link rel="canonical" href="https:\/\/omoshironics\.com\/fussenn\/">/);
    assert.match(html, /href="\/fussenn\/style\.css\?v=[0-9a-f]{10}"/);
    assert.match(html, /src="\/fussenn\/images\/hero\.webp"/);
    assert.doesNotMatch(html, /<!--\/?(?:release|coming-soon)-->|準備中/);
    for (const file of ["icon.svg", "favicon.ico", "apple-touch-icon.png", "og.png", "style.css", "main.js", "images/hero.webp"]) assert.ok(readFileSync(join(out, file)).length > 0, file);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("before the first release, offers no downloads and no links into the private repository", () => {
  const out = temporary();
  try {
    buildSite({ out, comingSoon: true });
    const html = readFileSync(join(out, "index.html"), "utf8");
    assert.doesNotMatch(html, /\{\{|\}\}|<!--\/?(?:release|coming-soon)-->/);
    assert.doesNotMatch(html, /github\.com|releases\/latest\/download|SHA-256で確かめる/);
    assert.match(html, /ダウンロードは準備中です。/);
    assert.match(html, /<a class="org" href="https:\/\/omoshironics\.com\/">合同会社オモシロニクス<\/a>/);
    assert.throws(() => buildSite({ out, comingSoon: true, release: release(), sums: sums() }), /--coming-soon is for before the first release/);
    assert.throws(() => buildSite({ out, comingSoon: true, base: "fussenn" }), /--base must be a path/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("keeps one kind of block and stops at a marker without its pair", () => {
  const template = "a<!--release-->R<!--/release-->b<!--coming-soon-->C<!--/coming-soon-->c";
  assert.equal(selectBlocks(template, false), "aRbc");
  assert.equal(selectBlocks(template, true), "abCc");
  assert.throws(() => selectBlocks("a<!--release-->R", false), /unmatched <!--release-->/);
});

test("dates the release in Japan time", () => {
  assert.equal(formatDate("2026-11-19T16:30:00Z"), "2026年11月20日");
  assert.equal(formatDate("2026-11-19T14:59:00Z"), "2026年11月19日");
});

test("refuses a release that lacks a download or its checksum, and a build with no release", () => {
  assert.throws(() => releaseValues(release({ assets: release().assets.filter(({ name }) => name !== "Fussenn-win-x64.exe") }), sums()), /has no Fussenn-win-x64\.exe/);
  assert.throws(() => releaseValues(release(), parseChecksums(`${hash("a")}  Fussenn-mac-arm64.dmg\n`)), /no line for Fussenn-win-x64\.exe/);
  assert.throws(() => releaseValues(release({ tagName: "0.3.0" }), sums()), /must look like v1\.2\.3/);
  assert.throws(() => parseChecksums("not a checksum line\n"), /not "<SHA-256>  <file>"/);
  assert.throws(() => buildSite({ out: join(tmpdir(), "fussenn-site-unused"), repo: "owner/Fussenn" }), /No release to show/);
  assert.throws(() => buildSite({ out: join(tmpdir(), "fussenn-site-unused"), repo: "not a repository", preview: true }), /--repo owner\/name/);
});

test("refuses a page that would load fonts, scripts, styles or images from another site", () => {
  assert.doesNotThrow(() => assertLocalOnly('<link rel="canonical" href="https://example.com/"><a href="https://example.com/">x</a><img src="images/a.webp">', "body { color: red; }"));
  assert.throws(() => assertLocalOnly('<img src="https://example.com/a.png">', ""), /another site: https:\/\/example\.com\/a\.png/);
  assert.throws(() => assertLocalOnly('<script src="//cdn.example.com/a.js"></script>', ""), /another site/);
  assert.throws(() => assertLocalOnly('<link rel="stylesheet" href="https://fonts.example.com/css">', ""), /another site/);
  assert.throws(() => assertLocalOnly("", "@import url(https://fonts.example.com/a.css);"), /another site/);
});

test("writes the release checksums only when every download is present", async () => {
  const directory = temporary();
  try {
    writeFileSync(join(directory, "Fussenn-mac-arm64.dmg"), "mac");
    await assert.rejects(writeChecksums(directory), /Missing: Fussenn-win-x64\.exe/);
    writeFileSync(join(directory, "Fussenn-win-x64.exe"), "win");
    await writeChecksums(directory);
    const written = parseChecksums(readFileSync(join(directory, checksumsName), "utf8"));
    assert.equal(written.get("Fussenn-mac-arm64.dmg"), createHash("sha256").update("mac").digest("hex"));
    assert.equal(written.get("Fussenn-win-x64.exe"), createHash("sha256").update("win").digest("hex"));
    assert.equal(written.size, 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
