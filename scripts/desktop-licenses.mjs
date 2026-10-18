import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

const slash = (path) => path.replaceAll("\\", "/");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const escape = (text) => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const noticeName = /^(?:licen[cs]es?|notices?|copying|copyright|authors|ofl)(?:[._-]|$)|[._-](?:licen[cs]e|notice)(?:[._-]|$)/i;

export function excludedDesktopPackage(name) {
  if (name === "sharp" || name.startsWith("@img/sharp-")) return "Unused image optimizer (images.unoptimized=true)";
  if (name.startsWith("@next/swc-")) return "Build-time compiler";
  if (name === "@napi-rs/canvas" || name.startsWith("@napi-rs/canvas-")) return "Optional Node canvas; PDF extraction runs in the browser";
  return undefined;
}

function* walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink in license input: ${path}`);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

// Nested dependencies are separate lockfile entries. Nested vendored notices
// (Next.js bundles, PDF CMaps/fonts, *.LICENSE.txt) belong to their parent.
export function licenseFiles(directory) {
  function* visit(current, inNotices = false) {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink in package: ${path}`);
      const matched = inNotices || noticeName.test(entry.name);
      if (entry.isDirectory()) yield* visit(path, matched);
      else if (entry.isFile() && matched) yield path;
    }
  }
  return [...visit(directory)];
}

export function assertDesktopContents(resources, manifest) {
  const config = JSON.parse(readFileSync(join(resources, "server", ".next-desktop", "required-server-files.json"), "utf8")).config;
  if (config.images?.unoptimized !== true) throw new Error("Desktop image optimization must stay disabled while Sharp is excluded.");
  for (const file of walk(join(resources, "server", "node_modules"))) {
    const path = slash(relative(join(resources, "server"), file));
    // Check paths as well as package.json: a native binary can be traced alone.
    let owner;
    for (const match of path.matchAll(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)/g)) {
      if (excludedDesktopPackage(match[1])) throw new Error(`Unreviewed desktop dependency: ${match[1]}`);
      owner = path.slice(0, match.index + match[0].length);
    }
    if (!manifest.packages.some((pkg) => pkg.path === owner)) throw new Error(`No license coverage for traced file: ${path}`);
  }
}

export function prepareDesktopLicenses(root, resources, electronDist) {
  const directory = join(resources, "licenses");
  if (existsSync(directory)) throw new Error("License output must be newly prepared.");
  mkdirSync(directory, { recursive: true });
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const supplements = JSON.parse(readFileSync(join(root, "licenses", "upstream", "sources.json"), "utf8"));
  const manifest = { schema: 1, packages: [], omitted: [], files: [] };
  const sections = [];
  function copy(source, path) {
    const bytes = readFileSync(source);
    if (!bytes.length) throw new Error(`Empty license: ${source}`);
    const target = join(resources, path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    return path;
  }
  const appLicense = copy(join(root, "LICENSE"), "licenses/Fussenn-LICENSE.txt");
  sections.push({ title: "Fussenn", files: [appLicense] });
  copy(join(root, "licenses", "upstream", "sources.json"), "licenses/upstream-sources.json");
  const next = JSON.parse(readFileSync(join(root, "node_modules", "next", "package.json"), "utf8"));
  for (const [path, pkg] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b, "en"))) {
    if (!path || pkg.dev) continue;
    const name = pkg.name || path.slice(path.lastIndexOf("node_modules/") + 13);
    const reason = excludedDesktopPackage(name);
    if (reason) { manifest.omitted.push({ name, version: pkg.version, reason }); continue; }
    const original = join(root, path);
    if (!existsSync(original)) {
      if (!pkg.optional) throw new Error(`Required dependency is not installed: ${path}`);
      continue;
    }
    const installed = JSON.parse(readFileSync(join(original, "package.json"), "utf8"));
    if (installed.version !== pkg.version) throw new Error(`Installed dependency differs from lockfile: ${path}`);
    const folder = `licenses/packages/${path.replaceAll("node_modules/", "")}`;
    const originals = licenseFiles(original);
    let hasPackageNotice = originals.some((file) => dirname(file) === original && /^(?:licen[cs]es?|copying)(?:[._-]|$)/i.test(basename(file)));
    const files = originals.map((file) => copy(file, `${folder}/${slash(relative(original, file))}`));
    if (name === "@next/env") {
      if (pkg.version !== next.version) throw new Error("Review the @next/env upstream license after upgrading Next.js.");
      // Next.js ships license.md; find it by name so case-sensitive file systems (Linux) match too.
      const nextLicense = readdirSync(join(root, "node_modules", "next")).find((file) => /^licen[cs]e(?:\.md|\.txt)?$/i.test(file));
      if (!nextLicense) throw new Error("Review the Next.js license file after upgrading Next.js.");
      files.push(copy(join(root, "node_modules", "next", nextLicense), `${folder}/LICENSE.next.txt`));
      hasPackageNotice = true;
      if (!supplements.some((item) => item.name === name && item.version === pkg.version)) throw new Error("Review @next/env bundled dotenv notices after upgrading.");
    }
    for (const supplement of supplements.filter((item) => item.name === name && item.version === pkg.version)) {
      const source = join(root, "licenses", "upstream", supplement.file);
      if (hash(readFileSync(source)) !== supplement.sha256) throw new Error(`Upstream license checksum mismatch: ${supplement.file}`);
      files.push(copy(source, `${folder}/${supplement.file}`));
      if (name !== "@next/env") hasPackageNotice = true;
    }
    if (!hasPackageNotice) throw new Error(`Missing package license text: ${name}@${pkg.version}. Review upstream; do not substitute a generic license.`);
    const record = { name, version: pkg.version, license: pkg.license || "See notices", path, files,
      source: typeof installed.repository === "string" ? installed.repository : installed.repository?.url || installed.homepage || `https://www.npmjs.com/package/${name}/v/${pkg.version}` };
    manifest.packages.push(record);
    sections.push({ title: `${name}@${pkg.version} — ${record.license}`, source: record.source, files });
  }
  // The marker is also vendored by Next.js; the project notice above covers it.
  // Copy runtime notices explicitly: electron-builder removes the root notices
  // when producing a Mac .app. The resources directory survives that operation.
  const electronVersion = JSON.parse(readFileSync(join(root, "node_modules", "electron", "package.json"), "utf8")).version;
  if (readFileSync(join(electronDist, "version"), "utf8").trim().replace(/^v/, "") !== electronVersion) throw new Error("Electron license distribution version mismatch.");
  const electron = copy(join(electronDist, "LICENSE"), "licenses/runtimes/LICENSE.electron.txt");
  copy(join(electronDist, "LICENSES.chromium.html"), "licenses/runtimes/LICENSES.chromium.html");
  const node = copy(join(resources, "runtime", "LICENSE.node.txt"), "licenses/runtimes/LICENSE.node.txt");
  sections.push({ title: `Electron ${electronVersion}`, files: [electron] }, { title: `Node.js ${process.versions.node}`, files: [node] });
  // Preserve notices extracted from client/server output by the bundler as well.
  const generated = licenseFiles(join(resources, "server", ".next-desktop")).map((file) => copy(file, `licenses/generated/${slash(relative(join(resources, "server", ".next-desktop"), file))}`));
  if (generated.length) sections.push({ title: "Generated bundle notices", files: generated });
  const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'"><title>Fussenn — ライセンス</title><style>body{font:16px/1.65 system-ui,sans-serif;max-width:1000px;margin:40px auto;padding:0 24px;color:#292921;background:#faf9f5}h1{font-size:28px}summary{cursor:pointer;font-weight:600}details{border-top:1px solid #ddd;padding:16px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}a{color:#38614c}small{overflow-wrap:anywhere}</style><h1>Fussenn — ライセンス</h1><p>このアプリと使用しているソフトウェアのライセンス・著作権表示です。画面に組み込まれるコードの表示も含みます。変更していない配布元の文書を掲載しています。一覧には、依存パッケージ内で実行時に使わない部分の表示も含まれます。</p><p><a href="runtimes/LICENSES.chromium.html">ChromiumとElectron内の第三者ソフトウェア</a> · <a href="manifest.json">収録ファイル一覧とSHA-256</a></p>${sections.map((section, index) => `<details${index === 0 ? " open" : ""}><summary>${escape(section.title)}</summary>${section.source ? `<small>Source: ${escape(section.source)}</small>` : ""}${section.files.map((file) => `<h3>${escape(file.slice(9))}</h3><pre>${escape(readFileSync(join(resources, file), "utf8"))}</pre>`).join("")}</details>`).join("")}</html>`;
  writeFileSync(join(directory, "index.html"), html);
  const preserved = [join(resources, "runtime", "LICENSE.node.txt"), ...licenseFiles(join(resources, "server", "public", "pdfjs"))];
  for (const file of [...walk(directory), ...preserved]) manifest.files.push({ path: slash(relative(resources, file)), sha256: hash(readFileSync(file)) });
  writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  verifyDesktopLicenses(resources);
  console.log(`Desktop licenses: ${manifest.packages.length} package entries, ${manifest.files.length} verified documents.`);
}

export function verifyDesktopLicenses(resources) {
  const manifest = JSON.parse(readFileSync(join(resources, "licenses", "manifest.json"), "utf8"));
  const required = ["licenses/index.html", "licenses/runtimes/LICENSE.electron.txt", "licenses/runtimes/LICENSES.chromium.html", "licenses/runtimes/LICENSE.node.txt", "runtime/LICENSE.node.txt", "server/public/pdfjs/LICENSE", "server/public/pdfjs/cmaps/LICENSE", "server/public/pdfjs/standard_fonts/LICENSE_FOXIT", "server/public/pdfjs/standard_fonts/LICENSE_LIBERATION"];
  for (const path of required) if (!manifest.files.some((file) => file.path === path)) throw new Error(`Required license missing from manifest: ${path}`);
  // The app's own license. Packages built before the rename from SideNote AI used the previous file name.
  if (!manifest.files.some((file) => ["licenses/Fussenn-LICENSE.txt", "licenses/SideNote-LICENSE.txt"].includes(file.path))) throw new Error("Required license missing from manifest: licenses/Fussenn-LICENSE.txt");
  for (const file of manifest.files) {
    const target = resolve(resources, file.path);
    const path = relative(resources, target);
    if (isAbsolute(path) || path.startsWith("..") || !file.path || basename(target) === "manifest.json") throw new Error("Invalid license manifest path.");
    if (hash(readFileSync(target)) !== file.sha256) throw new Error(`Packaged license checksum mismatch: ${file.path}`);
  }
  assertDesktopContents(resources, manifest);
  return manifest;
}
