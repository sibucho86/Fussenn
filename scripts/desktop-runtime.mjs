import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { EnvHttpProxyAgent, fetch } from "undici";

// Download official, self-contained Node binaries. Copying a Homebrew binary
// would leave a Mac application dependent on libraries outside its bundle.
export async function prepareRuntime(root, destination) {
  const version = `v${process.versions.node}`;
  const platform = process.platform;
  const arch = process.arch;
  const filename = platform === "win32" ? `win-${arch}/node.exe` : `node-${version}-${platform}-${arch}.tar.gz`;
  const dispatcher = new EnvHttpProxyAgent();
  async function download(url) {
    const response = await fetch(url, { dispatcher, signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Runtime download failed: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  try {
    const sums = (await download(`https://nodejs.org/dist/${version}/SHASUMS256.txt`)).toString();
    const expected = sums.split("\n").map((line) => line.trim().split(/\s+/)).find(([, name]) => name === filename)?.[0];
    if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error("Official Node runtime checksum is missing");
    const cache = join(root, ".tmp", "desktop-runtime", `${version}-${platform}-${arch}`);
    mkdirSync(cache, { recursive: true });
    const archive = join(cache, platform === "win32" ? "node.exe" : "node.tar.gz");
    let bytes = existsSync(archive) ? readFileSync(archive) : undefined;
    if (!bytes || createHash("sha256").update(bytes).digest("hex") !== expected) {
      bytes = await download(`https://nodejs.org/dist/${version}/${filename}`);
      if (createHash("sha256").update(bytes).digest("hex") !== expected) throw new Error("Node runtime checksum mismatch");
      writeFileSync(archive, bytes);
    }
    mkdirSync(destination, { recursive: true });
    if (platform === "win32") {
      copyFileSync(archive, join(destination, "node.exe"));
      const license = await download(`https://raw.githubusercontent.com/nodejs/node/${version}/LICENSE`);
      writeFileSync(join(destination, "LICENSE.node.txt"), license);
    } else {
      const entry = `node-${version}-${platform}-${arch}`;
      await new Promise((resolve, reject) => {
        const child = spawn("tar", ["-xzf", archive, "-C", cache, `${entry}/bin/node`, `${entry}/LICENSE`], { stdio: "inherit" });
        child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error("Unable to unpack official Node runtime")));
      });
      copyFileSync(join(cache, entry, "bin", "node"), join(destination, "node"));
      chmodSync(join(destination, "node"), 0o755);
      copyFileSync(join(cache, entry, "LICENSE"), join(destination, "LICENSE.node.txt"));
    }
  } finally { await dispatcher.close(); }
}
