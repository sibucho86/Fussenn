import { readFileSync, readdirSync, readlinkSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join, posix, relative, win32 } from "node:path";

// next build records the folder it ran in, as absolute paths in the standalone server's config. On the
// build computer that folder is usually in the home folder, which names the account; on every other
// computer it does not exist. Next's production server never reads these paths, so the staged copy
// points them at the server directory, where server.js runs.
export function scrubNextBuildPaths(server) {
  const manifest = join(server, ".next-desktop", "required-server-files.json");
  const { appDir, config } = JSON.parse(readFileSync(manifest, "utf8"));
  const recorded = [...new Set([appDir, config.outputFileTracingRoot, config.repoRoot, config.turbopack?.root])]
    .filter((path) => typeof path === "string" && (posix.isAbsolute(path) || win32.isAbsolute(path)));
  for (const file of [manifest, join(server, "server.js")]) {
    // Whole JSON strings only. A longer path that starts with one stays, for the home path check to report.
    const text = readFileSync(file, "utf8");
    writeFileSync(file, recorded.reduce((result, path) => result.replaceAll(JSON.stringify(path), JSON.stringify(".")), text));
  }
  return recorded;
}

export function homeFolders() {
  const folders = [homedir()];
  // HOME can point elsewhere; the account database names the real home folder.
  try { folders.push(userInfo().homedir); } catch { /* Some containers have no account entry. */ }
  return [...new Set(folders)];
}

// Native executables and libraries (Mach-O, universal Mach-O, ELF; PE starts with "MZ") and WebAssembly.
const compiledMagic = new Set(["feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe", "bebafeca", "cafebabf", "bfbafeca", "7f454c46", "0061736d"]);
const compiled = (content) => content.length >= 4 && (compiledMagic.has(content.toString("hex", 0, 4)) || content.toString("latin1", 0, 2) === "MZ");

// A path as files may spell it: as is, inside JSON, with forward slashes and in a file URL, with either
// case of a Windows drive letter.
function spellings(path) {
  const slashed = path.replaceAll("\\", "/");
  const forms = [path, JSON.stringify(path).slice(1, -1), slashed, encodeURI(slashed)];
  const drives = forms.flatMap((form) => /^[A-Za-z]:/.test(form) ? [form[0].toLowerCase() + form.slice(1), form[0].toUpperCase() + form.slice(1)] : [form]);
  return [...new Set(drives)].map((form) => Buffer.from(form));
}

// "/Users/dev" is not in "/Users/developer": a match must not continue the folder's name.
const continuesName = (byte) => byte >= 0x80 || /[\w.-]/.test(String.fromCharCode(byte));
function contains(content, needle) {
  for (let at = content.indexOf(needle); at !== -1; at = content.indexOf(needle, at + 1)) {
    if (at + needle.length === content.length || !continuesName(content[at + needle.length])) return true;
  }
  return false;
}

const comparable = (path) => path.replaceAll("\\", "/").replace(/\/+$/, "").replace(/^[A-Za-z]:/, (drive) => drive.toLowerCase());
const inside = (path, folder) => comparable(path) === comparable(folder) || comparable(path).startsWith(`${comparable(folder)}/`);

// Paths in the home folder name the account that built the app, so the files that ship must hold none.
// A shallow home such as "/root" in a container names no one and would match ordinary text. Compiled code
// comes prebuilt from upstream and holds its builders' paths (the bundled Node.js has /Users/admin/...),
// so it is checked only for the project folder, when that is in the home folder.
export function findHomePaths(directory, { home = homeFolders(), project = [] } = {}) {
  const homes = home.filter((path) => path.split(/[\\/]+/).filter(Boolean).length >= 2);
  const inText = homes.flatMap(spellings);
  const inCode = project.filter((path) => homes.some((folder) => inside(path, folder))).flatMap(spellings);
  const found = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) { visit(path); continue; }
      let content, needles;
      // A link is not followed (those in an app point inside it), but where it points ships with the app.
      if (entry.isSymbolicLink()) { content = Buffer.from(readlinkSync(path).replaceAll("\\", "/")); needles = inText; }
      else if (entry.isFile()) { content = readFileSync(path); needles = compiled(content) ? inCode : inText; }
      else continue;
      if (needles.some((needle) => contains(content, needle))) found.push(relative(directory, path).replaceAll("\\", "/"));
    }
  };
  visit(directory);
  return found.sort();
}

export function assertNoHomePaths(directory, options) {
  const found = findHomePaths(directory, options);
  // Name the files only: printing the path would put the account name in the build log.
  if (found.length) throw new Error(`These desktop files contain a path in this computer's home folder, which names its account:\n  ${found.join("\n  ")}\nPrepare again with npm run desktop:prepare. If a path remains, remove it where the file is made.`);
}
