import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, lstatSync, openSync, readFileSync, readSync, readdirSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

export const macEntitlements = join(dirname(fileURLToPath(import.meta.url)), "desktop-entitlements.mac.plist");
// electron-builder notarizes with the first kind of credentials that has any variable set, and fails only
// after signing if that kind is incomplete, so exactly one complete kind must be present.
const notaryKinds = [
  { name: "an Apple ID", present: ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD"], required: ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"] },
  { name: "an App Store Connect API key", present: ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"], required: ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"] },
  { name: "a notarytool keychain profile", present: ["APPLE_KEYCHAIN_PROFILE"], required: ["APPLE_KEYCHAIN_PROFILE"] },
];
export function notaryCredentials(env) {
  const kinds = notaryKinds.filter((kind) => kind.present.some((name) => env[name]));
  if (kinds.length === 0) throw new Error("FUSSENN_MAC_NOTARIZE=1 needs notarization credentials: APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER (see docs/desktop.md).");
  if (kinds.length > 1) throw new Error(`Notarization credentials of more than one kind are set (${kinds.map((kind) => kind.name).join(", ")}). Unset all but one.`);
  const missing = kinds[0].required.filter((name) => !env[name]);
  if (missing.length) throw new Error(`Notarization with ${kinds[0].name} also needs ${missing.join(", ")}.`);
  return kinds[0].name;
}

// Mac builds stay unsigned unless FUSSENN_MAC_SIGN=1, so contributors and CI need no certificate.
// Signing takes the Developer ID Application identity from the keychain (CSC_NAME picks one of
// several), so no identity or team is written in the repository. Notarization uploads the app to
// Apple, so it runs only with FUSSENN_MAC_NOTARIZE=1, even when Apple credentials are set.
export function macSigning(env, platform) {
  const sign = env.FUSSENN_MAC_SIGN === "1", notarize = env.FUSSENN_MAC_NOTARIZE === "1";
  if ((sign || notarize) && platform !== "darwin") throw new Error("FUSSENN_MAC_SIGN and FUSSENN_MAC_NOTARIZE apply to Mac builds made on a Mac.");
  if (notarize && !sign) throw new Error("FUSSENN_MAC_NOTARIZE=1 needs FUSSENN_MAC_SIGN=1.");
  if (notarize) notaryCredentials(env);
  if (!sign) return { identity: null, hardenedRuntime: false };
  return { forceCodeSigning: true, hardenedRuntime: true, entitlements: macEntitlements, entitlementsInherit: macEntitlements, notarize };
}

const thinMagic = new Set(["feedface", "feedfacf", "cefaedfe", "cffaedfe"]), fatMagic = new Set(["cafebabe", "bebafeca", "cafebabf", "bfbafeca"]);
// Every Mach-O in the app, found by content: executables, helpers, frameworks, libraries, and the
// bundled Node.js and native modules in Resources. Symlinks are skipped; the framework links point inside.
function machOFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name), stat = lstatSync(path);
    if (stat.isDirectory()) return machOFiles(path);
    if (!stat.isFile() || stat.size < 4) return [];
    const magic = Buffer.alloc(4), fd = openSync(path, "r");
    try { readSync(fd, magic, 0, 4, 0); } finally { closeSync(fd); }
    if (thinMagic.has(magic.toString("hex"))) return [{ path, architectures: [undefined] }];
    // A universal binary carries one signature per architecture.
    if (fatMagic.has(magic.toString("hex"))) return [{ path, architectures: execFileSync("lipo", ["-archs", path], { encoding: "utf8" }).trim().split(/\s+/) }];
    return [];
  });
}
const parsePlist = (xml) => xml.trim() ? JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", "-"], { input: xml, encoding: "utf8" })) : {};
// codesign prints the signer only to this process; the checks below never echo it.
function signature(path, architecture) {
  const only = architecture ? ["--arch", architecture] : [];
  const details = spawnSync("codesign", ["-dvvv", ...only, path], { encoding: "utf8" });
  const entitlements = spawnSync("codesign", ["-d", "--entitlements", "-", "--xml", ...only, path], { encoding: "utf8" });
  if (details.status !== 0 || entitlements.status !== 0) return {};
  return {
    developerId: /^Authority=Developer ID Application: /m.test(details.stderr),
    team: /^TeamIdentifier=([A-Z0-9]+)$/m.exec(details.stderr)?.[1],
    timestamp: /^Timestamp=/m.test(details.stderr),
    runtime: /^CodeDirectory .*flags=0x[0-9a-f]+\([^)]*\bruntime\b/m.test(details.stderr),
    entitlements: parsePlist(entitlements.stdout),
  };
}

// Notarization rejects code without a timestamped Developer ID signature and the hardened runtime, and
// entitlements such as get-task-allow. The deep check covers the bundles' seals; each Mach-O is then
// inspected, because the bundled Node.js and native modules sit in Resources, where it compares only contents.
export function verifyMacSignature(app, { notarized = false } = {}) {
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "pipe" });
  const expected = parsePlist(readFileSync(macEntitlements, "utf8")), main = signature(app);
  if (!main.developerId || !main.team || !main.timestamp || !main.runtime) throw new Error("The app lacks a timestamped Developer ID Application signature with the hardened runtime.");
  const code = machOFiles(join(app, "Contents"));
  for (const { path, architectures } of code) {
    execFileSync("codesign", ["--verify", "--strict", "--all-architectures", path], { stdio: "pipe" });
    for (const architecture of architectures) {
      const found = signature(path, architecture);
      if (!found.developerId || found.team !== main.team || !found.timestamp || !found.runtime) throw new Error(`Code is not signed like the app: ${relative(app, path)}`);
      if (!Object.entries(found.entitlements).every(([key, value]) => isDeepStrictEqual(expected[key], value))) throw new Error(`Code has entitlements outside scripts/desktop-entitlements.mac.plist: ${relative(app, path)}`);
    }
  }
  // V8 needs JIT in the app, its helpers and the bundled Node.js that runs the server.
  const frameworks = join(app, "Contents", "Frameworks"), runtime = join(app, "Contents", "Resources", "runtime", "node");
  if (!code.some(({ path }) => path === runtime)) throw new Error("The bundled Node.js runtime was not found in the app.");
  for (const path of [app, runtime, ...readdirSync(frameworks).filter((name) => name.endsWith(".app")).map((name) => join(frameworks, name))]) {
    if (!isDeepStrictEqual(signature(path).entitlements, expected)) throw new Error(`Code lacks the entitlements in scripts/desktop-entitlements.mac.plist: ${relative(app, path) || basename(app)}`);
  }
  if (notarized) {
    execFileSync("xcrun", ["stapler", "validate", app], { stdio: "pipe" });
    execFileSync("spctl", ["--assess", "--type", "execute", app], { stdio: "pipe" });
  }
  return code.length;
}
