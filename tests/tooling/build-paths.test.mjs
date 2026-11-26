import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { assertNoHomePaths, findHomePaths, scrubNextBuildPaths } from "../../scripts/desktop-build-paths.mjs";

function fixture(t) {
  const parent = realpathSync.native(tmpdir());
  const directory = realpathSync.native(mkdtempSync(join(parent, "fussenn-build-paths-")));
  t.after(() => {
    assert.equal(dirname(realpathSync.native(directory)), parent);
    rmSync(directory, { recursive: true, force: true });
  });
  const write = (path, content) => { const file = join(directory, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, content); };
  return { directory, write };
}

const mac = { home: "/Users/builder", project: "/Users/builder/develop/Fussenn" };
const windows = { home: "C:\\Users\\Build Er", project: "C:\\Users\\Build Er\\src\\Fussenn" };
const code = (magic, text) => Buffer.concat([Buffer.from(magic, "hex"), Buffer.from(text)]);

test("points the paths next build records at the staged server", (t) => {
  for (const { home, project } of [mac, windows]) {
    const { directory, write } = fixture(t);
    const config = { distDir: "./.next-desktop", outputFileTracingRoot: project, repoRoot: project, turbopack: { root: project }, cacheHandler: `${project}/cache.js` };
    write("server.js", `process.chdir(__dirname)\nconst nextConfig = ${JSON.stringify(config)}\nstartServer({ config: nextConfig })\n`);
    write(".next-desktop/required-server-files.json", JSON.stringify({ version: 1, config, appDir: project, relativeAppDir: "", files: [] }, null, 2));
    assert.deepEqual(scrubNextBuildPaths(directory), [project]);
    const scrubbed = { ...config, outputFileTracingRoot: ".", repoRoot: ".", turbopack: { root: "." } };
    assert.deepEqual(JSON.parse(readFileSync(join(directory, ".next-desktop", "required-server-files.json"), "utf8")), { version: 1, config: scrubbed, appDir: ".", relativeAppDir: "", files: [] });
    assert.equal(readFileSync(join(directory, "server.js"), "utf8"), `process.chdir(__dirname)\nconst nextConfig = ${JSON.stringify(scrubbed)}\nstartServer({ config: nextConfig })\n`);
    // A longer path is left alone, so the check stops the build instead of the scrub hiding it.
    assert.deepEqual(findHomePaths(directory, { home: [home] }), [".next-desktop/required-server-files.json", "server.js"]);
  }
});

test("finds home folder paths however shipped files spell them", (t) => {
  const { directory, write } = fixture(t);
  write("server/plain.js", `require("${mac.project}/node_modules/x")`);
  write("server/end.txt", mac.home);
  write("server/escaped.json", JSON.stringify({ root: windows.project }));
  write("server/slashed.txt", "c:/Users/Build Er/AppData/Local/x");
  write("server/url.map", `{"sources":["file:///C:/Users/Build%20Er/src/Fussenn/a.ts"]}`);
  // Folders that only begin with the same letters, and shallow container homes, are someone else's.
  write("server/others.txt", "/Users/builder2/x /Users/builder.old/x /Users/builderé/x /root/x");
  write("server/addon.node", code("cffaedfe", `${mac.project}/build/addon.cc`));
  write("server/addon.dll", Buffer.concat([Buffer.from("MZ"), Buffer.from(windows.project)]));
  const found = findHomePaths(directory, { home: [mac.home, windows.home, "/root", "/"], project: [mac.project, windows.project, "/app"] });
  assert.deepEqual(found, ["server/addon.dll", "server/addon.node", "server/end.txt", "server/escaped.json", "server/plain.js", "server/slashed.txt", "server/url.map"]);
});

test("compiled code from upstream may hold its builders' paths", (t) => {
  const { directory, write } = fixture(t);
  const builder = { home: ["/Users/admin"], project: ["/Users/admin/develop/Fussenn"] };
  // The official Node.js for Mac contains paths under /Users/admin, also a common account name here.
  write("runtime/node", code("cffaedfe", "/Users/admin/build/ws/out/Release/obj/x.cc"));
  write("server/library.so", code("7f454c46", "/Users/admin/src/x.c"));
  write("server/module.wasm", code("0061736d", "/Users/admin/.cargo/registry/x.rs"));
  assert.deepEqual(findHomePaths(directory, builder), []);
  write("runtime/server-bootstrap.cjs", "require('/Users/admin/develop/Fussenn/x')");
  assert.deepEqual(findHomePaths(directory, builder), ["runtime/server-bootstrap.cjs"]);
});

test("checks where symbolic links point without following them", (t) => {
  const { directory, write } = fixture(t);
  write("app/Versions/A/real.txt", "fine");
  try {
    symlinkSync("Versions/A/real.txt", join(directory, "app", "relative-link"));
    symlinkSync(`${mac.home}/notes.txt`, join(directory, "app", "home-link"));
  } catch (error) {
    if (process.platform === "win32") return t.skip(`creating symbolic links needs more rights on Windows (${error.code})`);
    throw error;
  }
  assert.deepEqual(findHomePaths(directory, { home: [mac.home] }), ["app/home-link"]);
});

test("the error names the files but never the path", (t) => {
  const { directory, write } = fixture(t);
  write("server/server.js", `const nextConfig = ${JSON.stringify({ outputFileTracingRoot: mac.project })}`);
  assert.throws(() => assertNoHomePaths(directory, { home: [mac.home] }), (error) => error.message.includes("\n  server/server.js\n") && !error.message.includes(mac.home));
  assert.doesNotThrow(() => assertNoHomePaths(directory, { home: ["/Users/someone-else"] }));
});
