import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareRuntime } from "./desktop-runtime.mjs";
import { prepareDesktopLicenses } from "./desktop-licenses.mjs";
import { assertNoHomePaths, scrubNextBuildPaths } from "./desktop-build-paths.mjs";
import { verifyIcons } from "./icons.mjs";

const require = createRequire(import.meta.url);
const root = realpathSync(join(dirname(fileURLToPath(import.meta.url)), ".."));
const stage = join(root, ".desktop");
verifyIcons();
if (!['win32', 'darwin', 'linux'].includes(process.platform)) throw new Error("Unsupported desktop platform");
// The desktop app bundles the Node.js that runs this script, so building it needs the patched 24 line
// it is tested with. Raise this together with the CI node-version after a Node.js security release.
const desktopNode = [24, 22, 2], running = process.versions.node.split(".").map(Number);
if (running[0] !== desktopNode[0] || running[1] < desktopNode[1] || (running[1] === desktopNode[1] && running[2] < desktopNode[2])) {
  throw new Error(`The desktop app bundles the Node.js that builds it. Use Node.js ${desktopNode.join(".")} or a newer 24.x release (running ${process.versions.node}).`);
}
// next build rewrites next-env.d.ts for its output directory. Keep the committed
// browser-build version, so a desktop build does not leave a source change behind.
const nextEnv = join(root, "next-env.d.ts");
const committedNextEnv = existsSync(nextEnv) ? readFileSync(nextEnv) : undefined;
if (!process.argv.includes("--skip-build")) try {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, "scripts", "next.mjs"), "build"], { cwd: root, stdio: "inherit", windowsHide: true, env: { ...process.env, FUSSENN_DESKTOP_BUILD: "true" } });
    child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Desktop build failed (${code})`)));
  });
} finally { if (committedNextEnv) writeFileSync(nextEnv, committedNextEnv); }

// Only this fixed, generated staging directory may be replaced. Refuse symlinks
// or junctions pointing elsewhere before any recursive filesystem operation.
if (existsSync(stage)) {
  if (realpathSync(stage) !== stage || dirname(resolve(stage)) !== root || basename(stage) !== ".desktop") throw new Error("Unsafe staging directory");
  rmSync(stage, { recursive: true });
}
mkdirSync(stage, { recursive: true });
const standalone = join(root, ".next-desktop", "standalone");
const server = join(stage, "server");
cpSync(standalone, server, { recursive: true, dereference: true, filter: (source) => {
  const path = relative(standalone, source).replaceAll("\\", "/");
  return !path.split("/").some((part) => part.startsWith(".env") || [".git", "cache"].includes(part)) && !/\.(?:db(?:-wal|-shm)?|log|(?:fussenn|sidenote)\.json)$/.test(path);
} });
// next build records this checkout's folder in the server config, where it would name the builder's account.
const recordedPaths = scrubNextBuildPaths(server);
cpSync(join(root, ".next-desktop", "static"), join(server, ".next-desktop", "static"), { recursive: true });
if (existsSync(join(root, "public"))) cpSync(join(root, "public"), join(server, "public"), { recursive: true });
// better-sqlite3 13 ships an N-API prebuild for each supported OS/CPU.
const sqliteRoot = dirname(require.resolve("better-sqlite3/package.json"));
mkdirSync(join(server, "node_modules", "better-sqlite3", "prebuilds"), { recursive: true });
const bindingName = `${process.platform}-${process.arch}.node`;
copyFileSync(join(sqliteRoot, "prebuilds", bindingName), join(server, "node_modules", "better-sqlite3", "prebuilds", bindingName));
// Output tracing includes executable files, but may omit license notices.
for (const file of [...walk(server)]) {
  if (basename(file) !== "package.json") continue;
  const path = relative(server, file);
  if (!path.startsWith("node_modules")) continue;
  const original = dirname(join(root, path));
  if (!existsSync(original)) continue;
  for (const entry of readdirSync(original, { withFileTypes: true })) {
    if (entry.isFile() && /^(?:LICEN[CS]E|NOTICE|COPYING)(?:[.\-].*)?$/i.test(entry.name)) copyFileSync(join(original, entry.name), join(dirname(file), entry.name));
  }
}
const runtimeDirectory = join(stage, "runtime");
await prepareRuntime(root, runtimeDirectory);
// Standard Node cannot read Electron's app.asar virtual filesystem.
copyFileSync(join(root, "desktop", "server-bootstrap.cjs"), join(runtimeDirectory, "server-bootstrap.cjs"));
// Resolve Electron's official distribution (downloads it if absent), then copy
// its exact-version notices before the packager can discard platform files.
require("electron");
prepareDesktopLicenses(root, stage, join(dirname(require.resolve("electron/package.json")), "dist"));

const application = join(stage, "app");
mkdirSync(application);
cpSync(join(root, "desktop"), join(application, "desktop"), { recursive: true });
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
writeFileSync(join(application, "package.json"), JSON.stringify({ name: pkg.name, productName: pkg.productName, version: pkg.version, private: true, license: pkg.license, description: pkg.description, author: pkg.author, main: "desktop/main.mjs", type: "module" }, null, 2));
// A reproducible build must use a runner matching the desired OS and CPU.
const lockfile = createHash("sha256").update(readFileSync(join(root, "package-lock.json"))).digest("hex");
writeFileSync(join(stage, "build-info.json"), JSON.stringify({ platform: process.platform, arch: process.arch, node: process.versions.node, electron: pkg.devDependencies.electron, version: pkg.version, lockfile }, null, 2));
for (const file of walk(stage)) {
  const path = relative(stage, file);
  if (isAbsolute(path) || path.startsWith("..") || basename(file).startsWith(".env") || /\.(?:db|(?:fussenn|sidenote)\.json)$/.test(file)) throw new Error("Unexpected private file in desktop bundle");
}
assertNoHomePaths(stage, { project: [root, ...recordedPaths] });
console.log(`Desktop prepared: ${process.platform}/${process.arch}, Node ${process.versions.node}`);
function* walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path); else yield path;
  }
}
