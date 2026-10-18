import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const arm = process.arch === "arm64";
// electron-builder's unpacked output and executable for each OS. Linux names
// the executable after the package name rather than the product name.
const layouts = {
  darwin: { source: arm ? "mac-arm64" : "mac", executables: [join(`${pkg.productName}.app`, "Contents", "MacOS", pkg.productName)] },
  win32: { source: arm ? "win-arm64-unpacked" : "win-unpacked", executables: [`${pkg.productName}.exe`] },
  linux: { source: arm ? "linux-arm64-unpacked" : "linux-unpacked", executables: [pkg.name, pkg.productName.toLowerCase()] },
};
const layout = layouts[process.platform];
if (!layout) throw new Error("Packaged tests target Windows, Mac and Linux");
const source = join(root, "release", layout.source);
if (!existsSync(source)) throw new Error("Run npm run desktop:pack first");
const tempRoot = realpathSync(tmpdir());
const temporary = mkdtempSync(join(tempRoot, "fussenn-packaged-test-"));
try {
  // Outside the checkout: Node must not accidentally resolve missing bundled
  // dependencies from the developer's node_modules in an ancestor directory.
  cpSync(source, temporary, { recursive: true, verbatimSymlinks: true });
  const executable = layout.executables.map((name) => join(temporary, name)).find((path) => existsSync(path));
  if (!executable) throw new Error(`Packaged executable not found in release/${layout.source}`);
  const env = { ...process.env, FUSSENN_DESKTOP_EXE: executable };
  delete env.NODE_PATH; delete env.ELECTRON_RUN_AS_NODE;
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [require.resolve("@playwright/test/cli"), "test", "--config", "playwright.desktop.config.ts"], { cwd: root, env, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) => { process.exitCode = code ?? 1; resolve(); });
  });
} finally {
  if (dirname(realpathSync(temporary)) !== tempRoot || !basename(temporary).startsWith("fussenn-packaged-test-")) throw new Error("Unsafe cleanup path");
  rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
