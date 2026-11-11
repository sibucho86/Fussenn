// Builds the download page in site/ into a folder for GitHub Pages. It fills in the repository, the
// latest release (version, date, file sizes and SHA-256) and cache-busting hashes, copies the icons
// from public/brand, and refuses a page that would load anything from another site.
//
//   node scripts/site-build.mjs --out <dir> --release-json <file> --sums <file> [--repo <owner/name>]
//   node scripts/site-build.mjs --out <dir> --preview [--repo <owner/name>]
//
// --release-json is the output of `gh release view --json tagName,publishedAt,assets`, and --sums
// that release's SHA256SUMS.txt. --preview builds without a release, for a look before the first one.
// The repository defaults to GITHUB_REPOSITORY, which GitHub Actions sets.
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { checksumsName, releaseAssets } from "./release-assets.mjs";

export const siteUrl = "https://fussenn.omoshironics.com/";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const icons = { "icon.svg": "fussenn.svg", "favicon.ico": "favicon.ico", "apple-touch-icon.png": "fussenn-180.png" };

export function parseChecksums(text) {
  const sums = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /^([0-9a-f]{64}) [ *](\S.*)$/.exec(line);
    if (!match) throw new Error(`${checksumsName} has a line that is not "<SHA-256>  <file>": ${line.slice(0, 80)}`);
    sums.set(match[2], match[1]);
  }
  return sums;
}

export const formatSize = (bytes) => `${Math.round(bytes / 1_000_000)} MB`;

const dateFormat = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" });
export const formatDate = (iso) => dateFormat.format(new Date(iso));

// The page's values for a published release. Every file the page offers must be in the release with
// its checksum, or the build stops: a download link must never point at a missing file.
export function releaseValues(release, sums) {
  const version = /^v(\d+\.\d+\.\d+)$/.exec(release.tagName ?? "")?.[1];
  if (!version) throw new Error(`The release tag must look like v1.2.3, not ${JSON.stringify(release.tagName)}.`);
  if (Number.isNaN(Date.parse(release.publishedAt))) throw new Error(`The release ${release.tagName} has no publication date.`);
  const values = { "release.label": `バージョン ${version}（${formatDate(release.publishedAt)}）` };
  for (const { id, name } of releaseAssets) {
    const asset = (release.assets ?? []).find((item) => item.name === name);
    if (!asset || !(asset.size > 0)) throw new Error(`The release ${release.tagName} has no ${name}.`);
    if (!sums.has(name)) throw new Error(`${checksumsName} of ${release.tagName} has no line for ${name}.`);
    Object.assign(values, { [`${id}.size`]: formatSize(asset.size), [`${id}.sha256`]: sums.get(name) });
  }
  return values;
}

function previewValues() {
  const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const values = { "release.label": `バージョン ${version}（未公開）` };
  for (const { id } of releaseAssets) Object.assign(values, { [`${id}.size`]: "サイズは公開時に表示", [`${id}.sha256`]: "公開時に表示します" });
  return values;
}

// The page may link anywhere, but may load only its own files: no fonts, scripts, styles or images
// from other sites. The privacy section and the footer say so.
export function assertLocalOnly(html, css) {
  const remote = [];
  for (const [tag, name] of html.matchAll(/<(img|script|link|source|iframe|video|audio|embed|object)\b[^>]*>/gi)) {
    // A canonical or alternate link names a page; the browser does not load it.
    if (name.toLowerCase() === "link" && /\srel="(?:canonical|alternate)"/i.test(tag)) continue;
    for (const [, url] of tag.matchAll(/\s(?:src|href|srcset|data|poster)="([^"]*)"/gi)) if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url.trim())) remote.push(url);
  }
  if (/@import|url\(\s*["']?(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(css)) remote.push("a stylesheet import or remote url()");
  if (remote.length) throw new Error(`The page would load from another site: ${remote.join(", ")}`);
}

export function render(template, values) {
  const html = template.replace(/\{\{([a-z0-9.]+)\}\}/g, (token, key) => {
    if (!(key in values)) throw new Error(`site/index.html uses ${token}, which the build does not fill in.`);
    return values[key];
  });
  const left = /\{\{[^}]*\}\}/.exec(html);
  if (left) throw new Error(`site/index.html has an unfilled placeholder: ${left[0]}`);
  return html;
}

const shortHash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 10);
const escape = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildSite({ out, repo, release, sums, preview = false, source = join(root, "site") }) {
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo ?? "")) throw new Error("Pass the GitHub repository as --repo owner/name (GITHUB_REPOSITORY in GitHub Actions).");
  if (!release && !preview) throw new Error("No release to show. Publish one first, or pass --preview for a look without it.");
  const repoUrl = `https://github.com/${repo}`;
  const values = {
    ...(release ? releaseValues(release, sums) : previewValues()),
    "site.url": siteUrl,
    "repo.url": repoUrl,
    "asset.css": shortHash(join(source, "style.css")),
    "asset.js": shortHash(join(source, "main.js")),
  };
  for (const { id, name } of releaseAssets) Object.assign(values, { [`${id}.file`]: name, [`download.${id}`]: `${repoUrl}/releases/latest/download/${name}` });
  const html = render(readFileSync(join(source, "index.html"), "utf8"), Object.fromEntries(Object.entries(values).map(([key, value]) => [key, escape(value)])));
  assertLocalOnly(html, readFileSync(join(source, "style.css"), "utf8"));

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(source, out, { recursive: true, filter: (path) => !path.endsWith(".DS_Store") });
  writeFileSync(join(out, "index.html"), html);
  for (const [name, brand] of Object.entries(icons)) copyFileSync(join(root, "public", "brand", brand), join(out, name));
  return values;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values: args } = parseArgs({ options: { out: { type: "string" }, repo: { type: "string" }, "release-json": { type: "string" }, sums: { type: "string" }, preview: { type: "boolean" } } });
  try {
    if (!args.out) throw new Error("Pass --out <folder> for the built page.");
    if (Boolean(args["release-json"]) !== Boolean(args.sums)) throw new Error("Pass --release-json and --sums together.");
    const release = args["release-json"] ? JSON.parse(readFileSync(args["release-json"], "utf8")) : undefined;
    const sums = args.sums ? parseChecksums(readFileSync(args.sums, "utf8")) : undefined;
    const values = buildSite({ out: resolve(args.out), repo: args.repo ?? process.env.GITHUB_REPOSITORY, release, sums, preview: args.preview });
    console.log(`Built the download page in ${args.out}: ${values["release.label"]}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
