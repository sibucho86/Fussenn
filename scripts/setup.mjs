import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this script with npm run setup.");
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) throw new Error("Node.js 22.13 or newer is required.");
async function npm(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [npmCli, ...args], { cwd: root, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Setup failed: npm ${args.join(" ")} (${code}).`)));
  });
}

// npm can infer an unnecessary node-gyp build for better-sqlite3 13 even
// though its package contains N-API binaries and declares gypfile:false.
// Install the locked packages first, then run only the required tool setup.
// https://github.com/WiseLibs/better-sqlite3/issues/1516
await npm(["ci", "--ignore-scripts", "--no-audit", "--no-fund"]);
await npm(["rebuild", "esbuild", "unrs-resolver", "electron-winstaller", "fsevents", "--ignore-scripts=false"]);

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const database = new Database(":memory:");
try {
  const result = database.prepare("SELECT 1 AS ready").get();
  if (result.ready !== 1) throw new Error("SQLite prebuilt binary failed its startup check.");
} finally { database.close(); }
require("esbuild").transformSync("const ready: boolean = true", { loader: "ts" });
console.log("Setup complete. SQLite and the build tool run without compiling SQLite locally.");
