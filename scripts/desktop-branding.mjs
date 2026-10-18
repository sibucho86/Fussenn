import { readFileSync } from "node:fs";
import { NtExecutable, NtExecutableResource, Resource } from "resedit";

// Read the resulting PE resources, not just the builder configuration. This
// catches a skipped resource-editing step and an installer using a default icon.
export function verifyWindowsBranding(executable, iconFile, pkg, kind = "application") {
  const pe = NtExecutable.from(readFileSync(executable), { ignoreCert: true });
  const { entries } = NtExecutableResource.from(pe);
  const versions = Resource.VersionInfo.fromEntries(entries);
  if (!versions.length) throw new Error("Windows version information is missing.");
  for (const version of versions) {
    const { fileVersionMS, fileVersionLS, productVersionMS, productVersionLS } = version.fixedInfo;
    const numbers = (ms, ls) => [ms >>> 16, ms & 0xffff, ls >>> 16, ls & 0xffff].join(".");
    const expected = `${pkg.version.split("-")[0]}.0`;
    if (numbers(fileVersionMS, fileVersionLS) !== expected || numbers(productVersionMS, productVersionLS) !== expected) throw new Error(`Windows version differs from package.json: ${executable}`);
    const languages = version.getAllLanguagesForStringValues();
    if (!languages.length) throw new Error("Windows product strings are missing.");
    for (const language of languages) {
      const values = version.getStringValues(language);
      const description = kind === "installer" ? pkg.description : pkg.productName;
      if (values.ProductName !== pkg.productName || values.FileDescription !== description || values.CompanyName !== pkg.author || !values.LegalCopyright?.includes(pkg.author)) throw new Error(`Windows product information is incorrect: ${executable}`);
    }
  }
  const ico = readFileSync(iconFile);
  const expectedImages = [];
  for (let index = 0; index < ico.readUInt16LE(4); index++) {
    const entry = 6 + index * 16;
    const offset = ico.readUInt32LE(entry + 12);
    expectedImages.push(ico.subarray(offset, offset + ico.readUInt32LE(entry + 8)));
  }
  const groups = Resource.IconGroupEntry.fromEntries(entries);
  const matches = groups.some((group) => {
    const images = group.icons.map((icon) => entries.find((entry) => entry.type === 3 && entry.id === icon.iconID && entry.lang === group.lang)?.bin).filter(Boolean).map((bin) => Buffer.from(bin));
    return images.length === expectedImages.length && expectedImages.every((expected) => images.some((actual) => actual.equals(expected)));
  });
  if (!matches) throw new Error(`Fussenn's icon was not embedded correctly: ${executable}`);
  console.log(`Verified Windows product information and ${expectedImages.length} icon sizes: ${executable.split(/[\\/]/).at(-1)}`);
}
