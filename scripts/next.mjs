import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { preparePdfAssets } from "./pdf-assets.mjs";

const require = createRequire(import.meta.url);
if (["dev", "build"].includes(process.argv[2])) preparePdfAssets();
const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), ...process.argv.slice(2)], {
  stdio: "inherit", windowsHide: true,
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", FUSSENN_SERVER_RUNNING: ["dev", "start"].includes(process.argv[2]) ? "true" : "false" },
});
child.on("exit", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
