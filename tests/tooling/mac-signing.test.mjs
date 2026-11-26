import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { macDiskImageOptions, macEntitlements, macSigning, notarizeMacDiskImage, notaryCredentials, notarytoolCredentials } from "../../scripts/desktop-mac-signing.mjs";

const unsigned = { identity: null, hardenedRuntime: false };
const sign = { FUSSENN_MAC_SIGN: "1" }, notarize = { FUSSENN_MAC_SIGN: "1", FUSSENN_MAC_NOTARIZE: "1" };
const apiKey = { APPLE_API_KEY: "AuthKey.p8", APPLE_API_KEY_ID: "key-id", APPLE_API_ISSUER: "issuer-id" };
const appleId = { APPLE_ID: "developer@example.invalid", APPLE_APP_SPECIFIC_PASSWORD: "app-password", APPLE_TEAM_ID: "TEAMID0000" };

test("Mac builds stay unsigned unless signing is requested", () => {
  assert.deepEqual(macSigning({}, "darwin"), unsigned);
  assert.deepEqual(macSigning({ FUSSENN_MAC_SIGN: "true" }, "darwin"), unsigned);
  assert.deepEqual(macSigning({}, "win32"), unsigned);
  assert.deepEqual(macSigning({}, "linux"), unsigned);
});

test("signing uses the keychain identity, the hardened runtime and the repository entitlements", () => {
  const signed = macSigning(sign, "darwin");
  assert.equal("identity" in signed, false, "CSC_NAME or the keychain chooses the identity, never the repository");
  assert.deepEqual(signed, { forceCodeSigning: true, hardenedRuntime: true, entitlements: macEntitlements, entitlementsInherit: macEntitlements, notarize: false });
});

test("Apple credentials alone never start notarization", () => {
  assert.deepEqual(macSigning(apiKey, "darwin"), unsigned);
  assert.equal(macSigning({ ...sign, ...apiKey }, "darwin").notarize, false);
  assert.equal(macSigning({ ...sign, ...appleId }, "darwin").notarize, false);
  assert.equal(macSigning({ ...notarize, ...apiKey }, "darwin").notarize, true);
});

test("notarization needs signing and exactly one complete kind of credentials", () => {
  assert.throws(() => macSigning({ FUSSENN_MAC_NOTARIZE: "1", ...apiKey }, "darwin"), /needs FUSSENN_MAC_SIGN=1/);
  assert.throws(() => macSigning(notarize, "darwin"), /needs notarization credentials/);
  assert.throws(() => macSigning({ ...notarize, APPLE_API_KEY: "AuthKey.p8", APPLE_API_KEY_ID: "key-id" }, "darwin"), /also needs APPLE_API_ISSUER/);
  // electron-builder would take the Apple ID route here, so a partial or complete Apple ID cannot sit beside a key.
  assert.throws(() => macSigning({ ...notarize, ...apiKey, APPLE_ID: "developer@example.invalid" }, "darwin"), /more than one kind/);
  assert.throws(() => macSigning({ ...notarize, ...apiKey, ...appleId }, "darwin"), /more than one kind/);
  assert.throws(() => macSigning({ ...notarize, ...apiKey, APPLE_KEYCHAIN_PROFILE: "profile" }, "darwin"), /more than one kind/);
});

test("names the credentials electron-builder will use", () => {
  assert.equal(notaryCredentials(apiKey), "an App Store Connect API key");
  // A team ID alone does not select the Apple ID route in electron-builder.
  assert.equal(notaryCredentials({ ...apiKey, APPLE_TEAM_ID: "TEAMID0000" }), "an App Store Connect API key");
  assert.equal(notaryCredentials(appleId), "an Apple ID");
  assert.equal(notaryCredentials({ APPLE_KEYCHAIN_PROFILE: "profile", APPLE_KEYCHAIN: "notary.keychain-db" }), "a notarytool keychain profile");
});

test("the disk image is notarized with the notarytool options electron-builder passes for the app", () => {
  assert.deepEqual(notarytoolCredentials(apiKey), ["--key", "AuthKey.p8", "--key-id", "key-id", "--issuer", "issuer-id"]);
  assert.deepEqual(notarytoolCredentials({ ...apiKey, APPLE_TEAM_ID: "TEAMID0000" }), ["--key", "AuthKey.p8", "--key-id", "key-id", "--issuer", "issuer-id"]);
  assert.deepEqual(notarytoolCredentials(appleId), ["--apple-id", "developer@example.invalid", "--password", "app-password", "--team-id", "TEAMID0000"]);
  assert.deepEqual(notarytoolCredentials({ APPLE_KEYCHAIN_PROFILE: "profile" }), ["--keychain-profile", "profile"]);
  assert.deepEqual(notarytoolCredentials({ APPLE_KEYCHAIN_PROFILE: "profile", APPLE_KEYCHAIN: "notary.keychain-db" }), ["--keychain-profile", "profile", "--keychain", "notary.keychain-db"]);
  assert.throws(() => notarytoolCredentials({ ...apiKey, APPLE_KEYCHAIN_PROFILE: "profile" }), /more than one kind/);
  assert.throws(() => notarytoolCredentials({ APPLE_ID: "developer@example.invalid" }), /also needs APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID/);
});

// A stand-in xcrun first on PATH records its arguments, so no request reaches Apple.
async function withFakeXcrun(script, run) {
  const bin = mkdtempSync(join(tmpdir(), "fussenn-xcrun-")), path = process.env.PATH;
  writeFileSync(join(bin, "xcrun"), `#!/bin/sh\necho "$@" >> "$(dirname "$0")/calls"\n${script}\n`, { mode: 0o755 });
  process.env.PATH = `${bin}${delimiter}${path}`;
  try {
    await run(() => readFileSync(join(bin, "calls"), "utf8").trim().split("\n"));
  } finally {
    process.env.PATH = path;
    rmSync(bin, { recursive: true, force: true });
  }
}
const unixOnly = { skip: process.platform === "win32" && "the stand-in xcrun is a shell script" };

test("an accepted disk image is stapled after notarytool waits for Apple's verdict", unixOnly, async () => {
  await withFakeXcrun(`[ "$1" = notarytool ] && echo '{"status":"Accepted","id":"2f9e8c1a-1b2c-4d5e-8f90-123456789abc"}'; exit 0`, async (calls) => {
    await notarizeMacDiskImage("Fussenn.dmg", apiKey);
    assert.deepEqual(calls(), ["notarytool submit Fussenn.dmg --key AuthKey.p8 --key-id key-id --issuer issuer-id --wait --output-format json", "stapler staple Fussenn.dmg"]);
  });
});

test("a refused disk image reports notarytool's output without credentials or submission IDs", unixOnly, async () => {
  const leak = "echo 'Error: 401 for AuthKey.p8 key-id issuer-id app-password developer@example.invalid TEAMID0000 2f9e8c1a-1b2c-4d5e-8f90-123456789abc' >&2";
  await withFakeXcrun(`${leak}; echo '{"status":"Invalid"}'; exit 1`, async (calls) => {
    await assert.rejects(notarizeMacDiskImage("Fussenn.dmg", apiKey), (error) => {
      assert.match(error.message, /did not accept the disk image \(Invalid\)[\s\S]*Error: 401 for <credential> <credential> <credential>/);
      assert.doesNotMatch(error.message, /AuthKey\.p8|key-id|issuer-id|2f9e8c1a/);
      return true;
    });
    await assert.rejects(notarizeMacDiskImage("Fussenn.dmg", appleId), (error) => {
      assert.doesNotMatch(error.message, /app-password|developer@example\.invalid|TEAMID0000|2f9e8c1a/);
      return true;
    });
    assert.equal(calls().filter((call) => call.startsWith("stapler")).length, 0, "nothing is stapled after a refusal");
  });
  await withFakeXcrun("exit 69", async () => {
    await assert.rejects(notarizeMacDiskImage("Fussenn.dmg", apiKey), /did not accept the disk image\. [\s\S]*notarytool exited with 69/);
  });
});

test("signed builds leave out the disk image blockmap, which signing and stapling the image would make stale", () => {
  assert.deepEqual(macDiskImageOptions(macSigning({}, "darwin")), {});
  assert.deepEqual(macDiskImageOptions(macSigning({}, "win32")), {});
  assert.deepEqual(macDiskImageOptions(macSigning(sign, "darwin")), { writeUpdateInfo: false });
  assert.deepEqual(macDiskImageOptions(macSigning({ ...notarize, ...apiKey }, "darwin")), { writeUpdateInfo: false });
});

test("signing is refused outside a Mac instead of breaking another platform's build", () => {
  assert.throws(() => macSigning(sign, "win32"), /Mac builds made on a Mac/);
  assert.throws(() => macSigning({ ...notarize, ...apiKey }, "linux"), /Mac builds made on a Mac/);
});

test("signed builds are granted only JIT compilation", () => {
  const keys = [...readFileSync(macEntitlements, "utf8").matchAll(/<key>([^<]+)<\/key>/g)].map((match) => match[1]);
  assert.deepEqual(keys, ["com.apple.security.cs.allow-jit"]);
});
