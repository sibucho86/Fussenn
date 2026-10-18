import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const records = new Map();
for (const [path, pkg] of Object.entries(lock.packages)) {
  if (!path || (pkg.dev && path !== "node_modules/electron")) continue;
  const name = pkg.name || path.slice(path.lastIndexOf("node_modules/") + 13);
  const record = { name, version: pkg.version, license: pkg.license || "要確認（未記載）", scope: path === "node_modules/electron" ? "デスクトップ実行環境" : "本番依存（任意・他OS向けを含む）" };
  records.set(`${name}@${pkg.version}`, record);
}
const rows = [...records.values()].sort((a, b) => a.name.localeCompare(b.name, "en") || a.version.localeCompare(b.version, "en"));
const escape = (value) => String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
const content = [
  "# 依存ライセンス一覧", "",
  "`npm run licenses:report` で `package-lock.json` から生成します。`npm run licenses:check` は一覧が固定依存と一致することを検証します。", "",
  "本番依存とElectronを対象に、任意依存・他OS向けも含めています。実際の配布物の内訳や正式なライセンス原文を保証する一覧ではありません。開発専用ツールとNode本体は対象外です。[第三者ソフトウェアの説明](../THIRD_PARTY_NOTICES.md) も確認してください。", "",
  `対象: ${rows.length} パッケージ・バージョン。`, "",
  "| パッケージ | バージョン | npm記載ライセンス | 区分 |",
  "| --- | --- | --- | --- |",
  ...rows.map((row) => `| ${escape(row.name)} | ${escape(row.version)} | ${escape(row.license)} | ${row.scope} |`), "",
].join("\n");
const target = join(root, "docs", "dependency-licenses.md");
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8").replaceAll("\r\n", "\n") !== content) throw new Error("License inventory is stale. Run npm run licenses:report and review the changes.");
  console.log(`License inventory matches the lockfile (${rows.length} package versions).`);
} else {
  writeFileSync(target, content);
  console.log(`Updated docs/dependency-licenses.md (${rows.length} package versions).`);
}
