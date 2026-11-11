import { build, Platform, Arch } from "electron-builder";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyDesktopLicenses } from "./desktop-licenses.mjs";
import { verifyIcons } from "./icons.mjs";
import { verifyWindowsBranding } from "./desktop-branding.mjs";
import { windowsInstallerOptions } from "./desktop-installer-options.mjs";
import { macDiskImageOptions, macSigning, notarizeMacDiskImage, notaryCredentials, signMacDiskImage, verifyMacDiskImage, verifyMacSignature } from "./desktop-mac-signing.mjs";
import { assertNoHomePaths } from "./desktop-build-paths.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const icons = join(root, "desktop", "icons");
const macSign = macSigning(process.env, process.platform);
if (macSign.notarize) console.log(`Notarization will upload the app and its disk image to Apple, authenticated with ${notaryCredentials(process.env)}.`);
let macSignatureVerified = false, signedMacApp;
// electron-builder can skip signing with only a warning, for example in a pull-request build. The afterSign
// check then fails; this guard also stops the build before any installer if a version skips afterSign too.
const requireMacSignature = () => { if (macSign.forceCodeSigning && !macSignatureVerified) throw new Error("FUSSENN_MAC_SIGN=1 was set, but electron-builder did not sign the app. See its log above."); };
verifyIcons();
const info = JSON.parse(readFileSync(join(root, ".desktop", "build-info.json"), "utf8"));
if (info.platform !== process.platform || info.arch !== process.arch) throw new Error("Prepare and package on the same OS/CPU.");
const prepared = JSON.parse(readFileSync(join(root, ".desktop", "app", "package.json"), "utf8"));
for (const field of ["name", "version", "productName", "author", "description"]) {
  if (prepared[field] !== pkg[field]) throw new Error(`Prepared app metadata changed (${field}). Run npm run desktop:prepare.`);
}
// Packaging takes the dependencies and runtime staged by prepare, so refuse them once the lockfile changed.
const lockfile = createHash("sha256").update(readFileSync(join(root, "package-lock.json"))).digest("hex");
if (info.lockfile !== lockfile || info.electron !== pkg.devDependencies.electron) throw new Error("Dependencies changed since npm run desktop:prepare. Run it again.");
for (const file of ["fussenn.png", "fussenn.ico", "fussenn.icns"]) {
  if (!readFileSync(join(root, ".desktop", "app", "desktop", "icons", file)).equals(readFileSync(join(icons, file)))) throw new Error("Prepared app icon changed. Run npm run desktop:prepare.");
}
verifyDesktopLicenses(join(root, ".desktop"));
const platform = { win32: Platform.WINDOWS, darwin: Platform.MAC, linux: Platform.LINUX }[process.platform];
const target = process.argv.includes("--dir") ? ["dir"] : process.platform === "win32" ? ["nsis"] : process.platform === "darwin" ? ["dmg", "zip"] : ["AppImage"];
await build({ targets: platform.createTarget(target, Arch[process.arch]), publish: "never", config: {
  appId: "app.fussenn.desktop", productName: pkg.productName, electronVersion: info.electron,
  copyright: `Copyright © 2026 ${pkg.author}`,
  directories: { app: join(root, ".desktop", "app"), output: join(root, "release") },
  files: ["package.json", "desktop/**/*", "!node_modules/**/*"], asar: true,
  // The standalone server already contains its Node dependencies. Returning
  // false also prevents builder from collecting the checkout's dependencies.
  beforeBuild: async () => false,
  // Builder excludes a source directory's root node_modules even for extraResources.
  // Map the traced modules separately so the installed app is self-contained.
  extraResources: [{ from: join(root, ".desktop", "server"), to: "server" }, { from: join(root, ".desktop", "server", "node_modules"), to: "server/node_modules" }, { from: join(root, ".desktop", "runtime"), to: "runtime" }, { from: join(root, ".desktop", "licenses"), to: "licenses" }, { from: join(root, ".desktop", "build-info.json"), to: "build-info.json" }],
  afterPack: async (context) => {
    const resources = context.packager.getResourcesDir(context.appOutDir);
    verifyDesktopLicenses(resources);
    for (const file of ["server/server.js", "server/node_modules/next/dist/server/lib/start-server.js", `server/node_modules/better-sqlite3/prebuilds/${info.platform}-${info.arch}.node`, "runtime/server-bootstrap.cjs", `runtime/${info.platform === "win32" ? "node.exe" : "node"}`]) {
      if (!existsSync(join(resources, file))) throw new Error(`Required runtime file was not packaged: ${file}`);
    }
    // The whole app before signing, including files staged by a prepare that predates the scrub.
    assertNoHomePaths(context.appOutDir, { project: [root, realpathSync(root)] });
  },
  afterSign: async (context) => {
    if (process.platform === "win32") verifyWindowsBranding(join(context.appOutDir, `${pkg.productName}.exe`), join(icons, "fussenn.ico"), pkg);
    if (process.platform === "darwin" && macSign.forceCodeSigning) {
      signedMacApp = join(context.appOutDir, `${pkg.productName}.app`);
      const files = verifyMacSignature(signedMacApp, { notarized: macSign.notarize });
      macSignatureVerified = true;
      console.log(`Verified the signature of the app and its ${files} Mach-O files.`);
    }
  },
  artifactBuildStarted: async () => requireMacSignature(),
  artifactBuildCompleted: async (artifact) => {
    if (process.platform === "win32" && artifact.file?.endsWith(".exe")) verifyWindowsBranding(artifact.file, join(icons, "fussenn.ico"), pkg, "installer");
    if (process.platform === "darwin" && macSign.forceCodeSigning && artifact.file?.endsWith(".dmg")) {
      // A temporary keychain exists only when electron-builder imported the certificate from CSC_LINK.
      const keychain = (await artifact.packager?.codeSigningInfo?.value)?.keychainFile;
      signMacDiskImage(artifact.file, signedMacApp, keychain);
      verifyMacDiskImage(artifact.file, signedMacApp);
      if (macSign.notarize) {
        console.log("Notarizing the disk image: uploading it to Apple and waiting for the result.");
        await notarizeMacDiskImage(artifact.file, process.env);
        verifyMacDiskImage(artifact.file, signedMacApp, { notarized: true });
        console.log("The disk image is notarized, stapled and accepted by Gatekeeper.");
      } else console.log("Signed the disk image with the app's certificate.");
    }
  },
  // No version in the name: links to the latest release stay the same (see release-assets.mjs).
  artifactName: "Fussenn-${os}-${arch}.${ext}",
  win: { target: "nsis", icon: join(icons, "fussenn.ico"), signExecutable: false },
  nsis: windowsInstallerOptions(icons),
  mac: { category: "public.app-category.productivity", target: ["dmg", "zip"], icon: join(icons, "fussenn.icns"), ...macSign },
  dmg: macDiskImageOptions(macSign),
  linux: { target: "AppImage", category: "Office", icon: join(icons, "fussenn.png") },
} });
requireMacSignature();
