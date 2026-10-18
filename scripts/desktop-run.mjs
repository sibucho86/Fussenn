import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const prepared = join(root, ".desktop", "app", "package.json");
if (!existsSync(prepared)) throw new Error("Run npm run desktop:prepare first.");
// A prepared app from an older checkout (for example before the rename) may read other
// settings. Refuse it instead of opening everyday data with outdated code.
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")), app = JSON.parse(readFileSync(prepared, "utf8"));
if (["name", "productName", "version"].some((field) => app[field] !== pkg[field])) throw new Error("The prepared desktop app is out of date. Run npm run desktop:prepare.");
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
// Read the data folder exactly as npm run dev does (Next.js env files, expansion and
// precedence), so the development window uses the same separate data, not everyday data.
// SIDENOTE_DATA_DIR is the name from before the rename to Fussenn; both are passed on.
const { loadEnvConfig } = createRequire(require.resolve("next/package.json"))("@next/env");
const { combinedEnv } = loadEnvConfig(root, true, { info() {}, error() {} });
const dataDirectory = combinedEnv.FUSSENN_DATA_DIR || combinedEnv.SIDENOTE_DATA_DIR;
if (dataDirectory) env.FUSSENN_DATA_DIR = env.SIDENOTE_DATA_DIR = resolve(root, dataDirectory);
const child = spawn(require("electron"), [join(root, ".desktop", "app")], { cwd: root, stdio: "inherit", windowsHide: true, env });
child.once("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.once("exit", (code) => { process.exitCode = code ?? 1; });
