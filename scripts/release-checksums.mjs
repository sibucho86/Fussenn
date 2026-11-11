// Writes release/SHA256SUMS.txt for the files a release offers (see release-assets.mjs), in the
// format of `shasum -a 256` and `sha256sum`. Both installers must be in release/: the Mac disk image
// built, signed and notarized on a Mac, and the Windows installer from the Desktop applications workflow.
import { createHash } from "node:crypto";
import { createReadStream, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checksumsName, releaseAssets } from "./release-assets.mjs";

export async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export const formatChecksums = (entries) => entries.map(({ name, sha256 }) => `${sha256}  ${name}\n`).join("");

export async function writeChecksums(directory) {
  const missing = releaseAssets.filter(({ name }) => !existsSync(join(directory, name))).map(({ name }) => name);
  if (missing.length) throw new Error(`Put every release file in ${directory} first. Missing: ${missing.join(", ")}`);
  const entries = [];
  for (const { name } of releaseAssets) entries.push({ name, sha256: await sha256File(join(directory, name)) });
  writeFileSync(join(directory, checksumsName), formatChecksums(entries));
  return entries;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const directory = join(dirname(fileURLToPath(import.meta.url)), "..", "release");
  try {
    const entries = await writeChecksums(directory);
    process.stdout.write(`Wrote release/${checksumsName}:\n${formatChecksums(entries)}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
