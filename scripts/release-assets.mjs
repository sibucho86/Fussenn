// The files a release offers for download. Their names carry no version, so links to the latest
// release (…/releases/latest/download/<name>) keep working when a new version is published.
// desktop-package.mjs names the installers this way; the version is in the release and the app.
export const releaseAssets = [
  { id: "mac", name: "Fussenn-mac-arm64.dmg" },
  { id: "win", name: "Fussenn-win-x64.exe" },
];

export const checksumsName = "SHA256SUMS.txt";
