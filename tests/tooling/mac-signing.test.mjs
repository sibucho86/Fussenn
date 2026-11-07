import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { macEntitlements, macSigning, notaryCredentials } from "../../scripts/desktop-mac-signing.mjs";

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

test("signing is refused outside a Mac instead of breaking another platform's build", () => {
  assert.throws(() => macSigning(sign, "win32"), /Mac builds made on a Mac/);
  assert.throws(() => macSigning({ ...notarize, ...apiKey }, "linux"), /Mac builds made on a Mac/);
});

test("signed builds are granted only JIT compilation", () => {
  const keys = [...readFileSync(macEntitlements, "utf8").matchAll(/<key>([^<]+)<\/key>/g)].map((match) => match[1]);
  assert.deepEqual(keys, ["com.apple.security.cs.allow-jit"]);
});
