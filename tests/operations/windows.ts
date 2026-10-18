import { spawn } from "node:child_process";
import { resolve } from "node:path";
export function windowsScript(script: string, port: number, directory: string) {
  return new Promise<{ code: number; output: string }>((resolveResult) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolve(`scripts/windows/${script}.ps1`), "-Port", String(port), "-Quiet", ...(script === "Launch-Fussenn" ? ["-NoBrowser"] : [])], {
      windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      // Both names, so a stale build from before the rename also uses the test data.
      env: { ...process.env, FUSSENN_DATA_DIR: directory, SIDENOTE_DATA_DIR: directory, ENABLE_MOCK_PROVIDER: "true", FUSSENN_DISABLE_AUTOMATIC_BACKUP: "false", SIDENOTE_DISABLE_AUTOMATIC_BACKUP: "false" },
    });
    let output = "", finished = false;
    child.stdout.on("data", (chunk) => { output += chunk; }); child.stderr.on("data", (chunk) => { output += chunk; });
    const timeout = setTimeout(() => { child.kill(); finish(1); }, 120_000);
    function finish(code: number) {
      if (finished) return;
      finished = true; clearTimeout(timeout); child.stdout.destroy(); child.stderr.destroy();
      resolveResult({ code, output });
    }
    child.once("error", (error) => { output += error.message; finish(1); });
    // Detached Windows descendants can retain pipe handles after PowerShell exits.
    child.once("exit", (code) => { setTimeout(() => finish(code ?? 1), 25); });
  });
}
