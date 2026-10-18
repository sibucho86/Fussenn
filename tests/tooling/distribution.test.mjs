import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { licenseFiles, prepareDesktopLicenses, verifyDesktopLicenses } from "../../scripts/desktop-licenses.mjs";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
function fixture(t) {
  const parent = realpathSync.native(tmpdir());
  const directory = realpathSync.native(mkdtempSync(join(parent, "fussenn-licenses-")));
  t.after(() => {
    assert.equal(dirname(realpathSync.native(directory)), parent);
    rmSync(directory, { recursive: true, force: true });
  });
  const write = (path, text = "fixture license") => { const file = join(directory, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
  return { directory, write };
}

test("collects nested vendor/font notices and license directories without swallowing dependencies", (t) => {
  const { directory, write } = fixture(t);
  const included = ["LICENSE", "fonts/LICENSE_FOXIT", "vendor/thing/NOTICE.txt", "dist/chunk.js.LICENSE.txt", "licenses/third-party.txt", "fonts/OFL.txt"];
  for (const file of [...included, "node_modules/other/LICENSE", "src/main.js", "README.md"]) write(file);
  assert.deepEqual(licenseFiles(directory).map((file) => relative(directory, file).replaceAll("\\", "/")).sort(), included.sort());
});

test("a vendored dependency notice cannot replace a missing package's own license", (t) => {
  const { directory, write } = fixture(t);
  write("LICENSE");
  write("licenses/upstream/sources.json", "[]");
  write("package-lock.json", JSON.stringify({ packages: { "node_modules/next": { version: "1.0.0", license: "MIT" } } }));
  write("node_modules/next/package.json", JSON.stringify({ name: "next", version: "1.0.0" }));
  write("node_modules/next/vendor/other/LICENSE");
  assert.throws(() => prepareDesktopLicenses(directory, join(directory, "output"), "unused"), /Missing package license text: next@1.0.0/);
});

function packagedFixture(t) {
  const result = fixture(t);
  const { directory, write } = result;
  const files = ["licenses/index.html", "licenses/Fussenn-LICENSE.txt", "licenses/runtimes/LICENSE.electron.txt", "licenses/runtimes/LICENSES.chromium.html", "licenses/runtimes/LICENSE.node.txt", "runtime/LICENSE.node.txt", "server/public/pdfjs/LICENSE", "server/public/pdfjs/cmaps/LICENSE", "server/public/pdfjs/standard_fonts/LICENSE_FOXIT", "server/public/pdfjs/standard_fonts/LICENSE_LIBERATION"];
  files.forEach((file) => write(file));
  write("server/.next-desktop/required-server-files.json", JSON.stringify({ config: { images: { unoptimized: true } } }));
  write("server/node_modules/next/index.js", "// fixture");
  write("licenses/manifest.json", JSON.stringify({ schema: 1, packages: [{ path: "node_modules/next" }], files: files.map((path) => ({ path, sha256: createHash("sha256").update(readFileSync(join(directory, path))).digest("hex") })) }));
  return result;
}

test("package check rejects lost or altered license text", (t) => {
  const { directory, write } = packagedFixture(t);
  assert.doesNotThrow(() => verifyDesktopLicenses(directory));
  write("server/public/pdfjs/standard_fonts/LICENSE_FOXIT", "altered");
  assert.throws(() => verifyDesktopLicenses(directory), /checksum mismatch/);
});

test("package check rejects unused native libraries even when traced without package metadata", (t) => {
  const { directory, write } = packagedFixture(t);
  write("server/node_modules/@img/sharp-win32-x64/lib/sharp.node", "fixture");
  assert.throws(() => verifyDesktopLicenses(directory), /Unreviewed desktop dependency/);
});

test("package check rejects an unlicensed traced dependency", (t) => {
  const { directory, write } = packagedFixture(t);
  write("server/node_modules/new-library/index.js", "fixture");
  assert.throws(() => verifyDesktopLicenses(directory), /No license coverage/);
});

test("a parent notice does not cover a new nested dependency", (t) => {
  const { directory, write } = packagedFixture(t);
  write("server/node_modules/next/node_modules/new-library/index.js", "fixture");
  assert.throws(() => verifyDesktopLicenses(directory), /No license coverage/);
});

test("patched esbuild works through the legacy loader's async and sync transforms", async () => {
  const loaderRequire = createRequire(require.resolve("@esbuild-kit/core-utils"));
  assert.equal(loaderRequire("esbuild/package.json").version, "0.25.12");
  const loader = require("@esbuild-kit/core-utils");
  const source = 'const answer: number = 42; console.log(answer);';
  for (const transformed of [loader.transformSync(source, "fixture.ts"), await loader.transform(source, "fixture.ts")]) {
    assert.equal(execFileSync(process.execPath, ["-e", transformed.code], { encoding: "utf8", windowsHide: true }).trim(), "42");
    assert.ok(transformed.map);
  }
});

test("Drizzle CLI loads a TypeScript configuration and generates a migration without opening user data", (t) => {
  const { directory, write } = fixture(t);
  const schemaModule = require.resolve("drizzle-orm/sqlite-core").replaceAll("\\", "/");
  const schema = join(directory, "schema.ts").replaceAll("\\", "/");
  const output = join(directory, "migrations").replaceAll("\\", "/");
  write("schema.ts", `import { sqliteTable, text } from ${JSON.stringify(schemaModule)}; export const books = sqliteTable("books", { title: text("title").notNull() });`);
  write("drizzle.config.ts", `export default { dialect: "sqlite", schema: ${JSON.stringify(schema)}, out: ${JSON.stringify(output)} };`);
  execFileSync(process.execPath, [join(dirname(require.resolve("drizzle-kit")), "bin.cjs"), "generate", "--config", join(directory, "drizzle.config.ts")], { cwd: root, encoding: "utf8", windowsHide: true, env: { ...process.env, FUSSENN_DATA_DIR: directory, SIDENOTE_DATA_DIR: directory } });
  assert.ok(existsSync(join(output, "meta", "_journal.json")));
  assert.equal(existsSync(join(directory, "fussenn.db")), false);
});
