import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateAudit } from "./audit-policy.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this script with npm run audit:dependencies.");
function audit(scope) {
  // npm audit exits non-zero whenever it finds an advisory; the JSON report decides the result.
  const result = spawnSync(process.execPath, [npmCli, "audit", "--json", scope], { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  let report;
  try { report = JSON.parse(result.stdout); } catch { throw new Error(`npm audit ${scope} returned no report (${result.status}). ${result.stderr.trim()}`); }
  if (report.error) throw new Error(`npm audit ${scope} failed: ${report.error.summary || report.error.code}`);
  return report;
}
const { exceptions } = JSON.parse(readFileSync(join(root, "scripts", "audit-exceptions.json"), "utf8"));
const { errors, accepted } = evaluateAudit({ production: audit("--omit=dev"), full: audit("--include=dev"), exceptions, today: new Date().toISOString().slice(0, 10) });
for (const item of accepted) console.log(`Reviewed development-only advisory (until ${item.reviewBy}): ${item.advisory} ${item.package} (${item.severity})`);
if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else console.log(`No production advisories. All ${accepted.length} development-only advisories are reviewed.`);
