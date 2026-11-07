import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = realpathSync(join(dirname(fileURLToPath(import.meta.url)), ".."));
const output = join(root, ".tmp", "open-source");
mkdirSync(output, { recursive: true });
if (realpathSync(output) !== output) throw new Error("Refusing a redirected scan directory.");
const version = "8.30.1";
const platforms = {
  "win32-x64": ["windows_x64.zip", "d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e"],
  "win32-arm64": ["windows_arm64.zip", "b95f5e4f5c425cedca7ee203d9afd29597e692c4924a12ed42f970537c72cc0f"],
  "linux-x64": ["linux_x64.tar.gz", "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"],
  "linux-arm64": ["linux_arm64.tar.gz", "e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080"],
  "darwin-x64": ["darwin_x64.tar.gz", "dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709"],
  "darwin-arm64": ["darwin_arm64.tar.gz", "b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5"],
};
const platform = platforms[`${process.platform}-${process.arch}`];
if (!platform) throw new Error("Unsupported scanner platform. Use Windows, macOS or Linux on x64/arm64.");
const [suffix, expectedHash] = platform;
const archive = join(output, `gitleaks_${version}_${suffix}`);
if (!existsSync(archive)) {
  const response = await fetch(`https://github.com/gitleaks/gitleaks/releases/download/v${version}/gitleaks_${version}_${suffix}`, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Gitleaks download failed (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== expectedHash) throw new Error("Gitleaks download checksum mismatch.");
  writeFileSync(archive, bytes);
}
if (createHash("sha256").update(readFileSync(archive)).digest("hex") !== expectedHash) throw new Error("Cached Gitleaks checksum mismatch. Remove the cached archive and retry.");

// A fresh extraction prevents a modified cached executable from bypassing verification.
const scratch = mkdtempSync(join(output, "scan-"));
try {
  const binaryDir = join(scratch, "tool");
  mkdirSync(binaryDir);
  execFileSync("tar", ["-xf", archive, "-C", binaryDir], { windowsHide: true });
  const scanner = join(binaryDir, process.platform === "win32" ? "gitleaks.exe" : "gitleaks");
  function scan(mode, target, name, extra = []) {
    const report = join(output, `${name}-secrets.json`);
    const result = spawnSync(scanner, [mode, target, ...extra, "--redact=100", "--no-banner", "--report-format=json", `--report-path=${report}`], { cwd: scratch, encoding: "utf8", windowsHide: true });
    // The redacted full output stays local; do not print matched lines to CI logs.
    writeFileSync(join(output, `${name}-scan.log`), (result.stdout || "") + (result.stderr || ""));
    if (result.error || result.status !== 0) throw new Error(`Secret scan failed (${name}, exit ${result.status}). Review the redacted report in .tmp/open-source locally.`);
    const findings = JSON.parse(readFileSync(report, "utf8"));
    if (findings.length !== 0) throw new Error(`Secret findings in ${name}.`);
    console.log(`${name}: 0 secret findings.`);
  }
  if (process.argv.includes("--self-test")) {
    const fixture = join(scratch, "fixture");
    mkdirSync(fixture);
    // Deliberately fake, assembled at runtime so the fixture is never committed.
    writeFileSync(join(fixture, "example.txt"), `token=${["ghp", randomBytes(18).toString("hex")].join("_")}\n`);
    const result = spawnSync(scanner, ["dir", fixture, "--redact=100", "--no-banner"], { cwd: scratch, encoding: "utf8", windowsHide: true });
    writeFileSync(join(output, "self-test-scan.log"), (result.stdout || "") + (result.stderr || ""));
    if (result.error || result.status !== 1) throw new Error("Scanner self-test failed to detect the synthetic token.");
    console.log("Scanner self-test detected the synthetic token.");
  }
  const snapshot = join(scratch, "files");
  mkdirSync(snapshot);
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
  if (git(["ls-files", "--cached", "--ignored", "--exclude-standard", "-z"]).length) throw new Error("Private/generated file matched by .gitignore is tracked. Review git ls-files --cached --ignored --exclude-standard.");
  const files = new Set(git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean));
  for (const file of files) {
    if (file.split("/").some((part) => part === ".." || part === ".git") || isAbsolute(file)) throw new Error("Unsafe tracked path.");
    if (file !== ".env.example" && /(?:^|\/)(?:\.env[^/]*|desktop\.env|auth\.json|node_modules|\.tmp|\.desktop|\.next(?:-desktop)?|\.fussenn|\.sidenote-ai|\.codex|release|out|coverage|test-results|playwright-report|data)(?:\/|$)|\.(?:db(?:-shm|-wal)?|sqlite3?(?:-shm|-wal)?|(?:fussenn|sidenote)\.json(?:\.partial)?|pem|key|p12|pfx|p8|cer|certSigningRequest|log)$/i.test(file)) throw new Error(`Private/generated file is a publication candidate: ${file}`);
    const source = resolve(root, file);
    if (!existsSync(source)) continue; // A deletion awaiting commit has no worktree content.
    const path = relative(root, realpathSync(source));
    if (path.startsWith("..") || isAbsolute(path) || !lstatSync(source).isFile()) throw new Error("Only regular files inside the checkout may be scanned.");
    const target = join(snapshot, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
  scan("dir", snapshot, "worktree");
  scan("git", root, "history", ["--log-opts=--all"]);
} finally {
  // Delete only the newly created directory, after checking its resolved boundary.
  if (dirname(scratch) !== output || realpathSync(scratch) !== scratch) throw new Error("Unsafe scanner cleanup path.");
  rmSync(scratch, { recursive: true });
}
