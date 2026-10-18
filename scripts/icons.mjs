import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceFile = "public/brand/fussenn.svg";
const scriptFile = "scripts/icons.mjs";
const manifestFile = "desktop/icons/manifest.json";
const icoSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const icnsSizes = { icp4: 16, icp5: 32, icp6: 64, ic07: 128, ic08: 256, ic09: 512, ic10: 1024, ic11: 32, ic12: 64, ic13: 256, ic14: 512 };
const outputs = ["desktop/icons/fussenn.png", "desktop/icons/fussenn.ico", "desktop/icons/fussenn.icns", "public/brand/favicon.ico", "public/brand/fussenn-32.png", "public/brand/fussenn-180.png"];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
// Source archives can use CRLF on Windows. The SVG and generator describe the
// same artwork with either line ending, while generated binary bytes stay exact.
const textHash = (path) => hash(readFileSync(join(root, path), "utf8").replaceAll("\r\n", "\n"));

export function verifyIcons() {
  const manifest = JSON.parse(readFileSync(join(root, manifestFile), "utf8"));
  if (manifest.source !== textHash(sourceFile) || manifest.generator !== textHash(scriptFile)) throw new Error("Icon source changed. Run npm run icons:generate and review the results.");
  for (const path of outputs) {
    if (hash(readFileSync(join(root, path))) !== manifest.files[path]) throw new Error(`Icon is missing or changed: ${path}`);
  }
  const ico = readFileSync(join(root, "desktop/icons/fussenn.ico"));
  if (ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1 || ico.readUInt16LE(4) !== icoSizes.length) throw new Error("Invalid Windows icon directory.");
  for (const [index, size] of icoSizes.entries()) {
    const entry = 6 + index * 16;
    const offset = ico.readUInt32LE(entry + 12);
    const bytes = ico.readUInt32LE(entry + 8);
    if ((ico[entry] || 256) !== size || (ico[entry + 1] || 256) !== size || offset + bytes > ico.length || ico.readUInt32BE(offset + 16) !== size || ico.readUInt32BE(offset + 20) !== size) throw new Error(`Invalid icon size: ${size}`);
  }
  const icns = readFileSync(join(root, "desktop/icons/fussenn.icns"));
  if (icns.toString("ascii", 0, 4) !== "icns" || icns.readUInt32BE(4) !== icns.length) throw new Error("Invalid Mac icon container.");
  const found = new Set();
  for (let offset = 8; offset < icns.length;) {
    const type = icns.toString("ascii", offset, offset + 4);
    const length = icns.readUInt32BE(offset + 4);
    if (length < 32 || offset + length > icns.length || icns.readUInt32BE(offset + 24) !== icnsSizes[type] || icns.readUInt32BE(offset + 28) !== icnsSizes[type]) throw new Error(`Invalid Mac icon representation: ${type}`);
    found.add(type);
    offset += length;
  }
  if (found.size !== Object.keys(icnsSizes).length) throw new Error("Missing Mac icon representations.");
  return manifest;
}

async function generate() {
  const { default: sharp } = await import("sharp");
  const svg = Buffer.from(readFileSync(join(root, sourceFile), "utf8").replaceAll("\r\n", "\n"));
  const png = (size) => sharp(svg, { density: 288 }).resize(size, size).png().toBuffer();
  const generated = new Map();
  generated.set(outputs[0], await png(512));
  const frames = await Promise.all(icoSizes.map(png));
  const directory = Buffer.alloc(6 + frames.length * 16);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(frames.length, 4);
  let offset = directory.length;
  for (const [index, frame] of frames.entries()) {
    const entry = 6 + index * 16;
    directory[entry] = directory[entry + 1] = icoSizes[index] % 256;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(frame.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += frame.length;
  }
  const ico = Buffer.concat([directory, ...frames]);
  generated.set(outputs[1], ico);
  const elements = [];
  for (const [type, size] of Object.entries(icnsSizes)) {
    // macOS expects more space around its rounded app tile than Windows.
    const artworkSize = Math.round(size * 0.875);
    const image = await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: await png(artworkSize), gravity: "centre" }]).png().toBuffer();
    const header = Buffer.alloc(8);
    header.write(type);
    header.writeUInt32BE(image.length + 8, 4);
    elements.push(header, image);
  }
  const header = Buffer.alloc(8);
  header.write("icns");
  header.writeUInt32BE(8 + elements.reduce((total, bytes) => total + bytes.length, 0), 4);
  generated.set(outputs[2], Buffer.concat([header, ...elements]));
  generated.set(outputs[3], ico);
  generated.set(outputs[4], await png(32));
  generated.set(outputs[5], await png(180));
  const manifest = { source: textHash(sourceFile), generator: textHash(scriptFile), renderer: `sharp ${sharp.versions.sharp}`, files: {} };
  for (const [path, bytes] of generated) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), bytes);
    manifest.files[path] = hash(bytes);
  }
  writeFileSync(join(root, manifestFile), JSON.stringify(manifest, null, 2) + "\n");
  verifyIcons();
  console.log("Generated Windows, Mac, desktop and browser icons from fussenn.svg.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) { verifyIcons(); console.log("Icon assets match their source and generator."); }
  else await generate();
}
