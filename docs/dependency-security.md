# 依存のセキュリティ確認

```sh
npm run audit:dependencies
npm run test:tooling
```

`audit:dependencies` は、`npm audit` を本番依存だけと開発用を含む全依存の2通りで実行し、次の基準で判定します。PR用CIにも組み込んでいます。結果は実行時点のnpmのアドバイザリ情報に依存します。

- 本番依存は、重要度にかかわらず指摘が1件でもあれば失敗します。例外は認めません。
- Electronは開発用の依存として入りますが、デスクトップ版の実行環境として配布物にそのまま含まれます。そのため本番依存と同じく扱い、指摘が1件でもあれば失敗します。例外としても記録できません。
- 開発・ビルド専用の依存は、次の3点を確認した指摘だけを [scripts/audit-exceptions.json](../scripts/audit-exceptions.json) に記録して許可します。記録には理由・依存経路・再確認の期限を書きます。
  - 上流に修正版がない
  - 配布物に含まれない
  - 外部からの入力を処理しない
- 記録のない指摘、期限切れの記録、指摘が解消して不要になった記録は、いずれも失敗にします。期限が来たら修正版の有無を確認し、依存を更新するか記録を見直します。

判定ロジックは `scripts/audit-policy.mjs` にあり、`npm run test:tooling` で検証します。

デスクトップ版に同梱するNode.jsは `npm audit` の対象外です。ビルドに使ったNode.jsと同じ版を同梱するため、Node.jsのセキュリティリリースが出たら、CIの `node-version` と検証基準を更新します。

## 2026-11-07の更新

2026-10-18の確認後に公表されたアドバイザリにより、本番依存に12件（critical 2・high 6・moderate 4）、開発用の依存に17件の指摘が出ました。CIの依存監査が失敗し、Dependabotの更新PRもすべてこの段階で止まっていました。本番依存で対象になったのは次の3つです。

| 依存 | 更新 | 主な指摘 |
| --- | --- | --- |
| next | 16.3.8 → 16.4.5 | ・画像最適化API（SVG使用時）の遠隔コード実行（critical）<br>・`use cache` 関数の遠隔コード実行（critical）<br>・Server Actionsによるサービス拒否（high） |
| undici | 7.29.1 → 7.30.2 | TLS証明書の検証の回避、リダイレクトによるキャッシュ汚染、サービス拒否など8件（high 4・moderate 4） |
| zod | 4.6.1 → 4.6.7 | 大きな集合の検証でメモリを使い切る（high） |

Fussennは画像最適化を無効にし（`images.unoptimized`）、`use cache` とServer Actionsを使いません。サーバーは `127.0.0.1` で待ち受けます。実際に影響するかは検証していませんが、既知の指摘を残さないよう修正版へ更新しました。zodはバックアップファイルの検証に使っているため、細工したファイルを読み込む経路が該当しうるとして更新しました。

Electronは44.3.0から44.10.2へ更新しました。侵害されたeMudhraの中間証明書への対処（high）ほか3件の指摘があります。Electronは配布物の実行環境そのものなので、今回から本番依存と同じ扱いにしました。デスクトップ版に同梱するNode.jsも24.15.0から24.22.2へ更新しました。24.22.1はセキュリティリリースです。CIの `node-version` と、検証基準の記載も合わせています。

その他の更新は次のとおりです。

- React 19.3.1、Drizzle ORM 0.45.4とDrizzle Kit 0.31.11、OpenAI SDK 7.53.0、PDF.js 6.5.438、CodeMirror、electron-builder 26.18.0、Playwright 1.65.0、Vitest 5.1.0、`@types/node` 24.19.2。`eslint-config-next` はNext.jsと同じ16.4.5にそろえました。
- 開発用の指摘は、Vitestの更新で `@vitest/mocker` が、semverの範囲内の更新でvite 8.3.6・fast-uri 3.1.9・node-gyp配下のundici 6.29.1が修正版になりました。
- TypeScript 7、ESLint 10、jsdom 31、lucide-react 1、resedit 3、Electron 45などのメジャー更新は、今回は見送りました。

更新後、本番依存とElectronの指摘は0件です。開発用の指摘は1件で、例外として記録しました。再確認の期限は2027-02-07です。2026-10-15に記録したbraces・sprintf-jsの2件は報告されなくなったため、記録を削除しました。

| アドバイザリ | 経路 | 許可した理由 |
| --- | --- | --- |
| [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)（minimatch、moderate） | electron-builder → app-builder-lib（→ @electron/universal）→ minimatch 9.0.9・10.2.6<br>eslint-config-next → @typescript-eslint/typescript-estree → minimatch 10.2.6 | パッケージ作成と開発時のESLintが、設定にある固定のglobパターンを展開するためだけに使う。配布物に含まれない。修正版は11.0.1以降のメジャー版だけで、これらの依存が受け付ける範囲（^9・^10）にない |

## 2026-10-15の更新

旧名称SideNote AIのときの判断・検証記録です。

2026-09-22の確認後に公表されたアドバイザリにより、`npm audit` の指摘が19件（critical 1・high 9・moderate 9）になりました。本番依存で対象になったのは次の3つです。

| 依存 | 更新 | 主な指摘 |
| --- | --- | --- |
| next | 16.3.4 → 16.3.8 | 次の7件<br>・next/ogのリモートコード実行<br>・画像最適化のSSRF<br>・SSG/ISRのキャッシュ汚染<br>・開発サーバーのMCPエンドポイントからの情報漏えい<br>・ほか3件 |
| sharp | 0.35.4 → 0.35.5 | 同梱するlibrsvgの脆弱性 |
| source-map-js | 1.2.1 → 1.2.2 | 細工したsource mapによるサービス拒否 |

SideNoteは、next/og・画像最適化（`images.unoptimized`）・ISR・メタデータ画像のルートを使いません。サーバーは `127.0.0.1` で待ち受けます。そのため実際に影響する経路は限られますが、既知の指摘を残したまま公開しないよう、同じ16.3系の修正版へ更新しました。

その他の更新は次のとおりです。

- `eslint-config-next` を、Next.jsと同じ16.3.8にそろえました。
- sharpはアイコン生成に使う開発依存です。デスクトップの配布物には含めません。
- 開発用の依存のbrace-expansion・fast-uri・http-cache-semanticsを、semverの範囲内の修正版へ更新しました。

更新後、本番依存の指摘は0件です。残る2件は上流に修正版がない開発専用の指摘で、例外として記録しました。再確認の期限は2027-01-15です。

| アドバイザリ | 経路 | 許可した理由 |
| --- | --- | --- |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)（braces、high） | eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces 3.0.3 | 開発時のESLintが、ESLint設定の固定パターンを展開するためだけに使う。配布物に含まれない |
| [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)（sprintf-js、moderate） | electron-builder → app-builder-lib → @electron/get → global-agent → roarr → sprintf-js 1.1.3 | パッケージ作成時のElectron取得で、`ELECTRON_GET_USE_PROXY` を設定した場合だけ読み込まれる。配布物に含まれない |

`npm audit fix --force` は、eslint-config-next 14系とelectron-builder 26.5.0への変更を提示します。どちらも古い版へ戻す変更で、Next.js 16やパッケージ作成の検証済みの構成から外れるため、適用していません。

## esbuildの修正

旧名称SideNote AIのときの判断・検証記録です。

2026-09-22の確認では、中程度の指摘が4件ありました。根本原因は1件で、`drizzle-kit → @esbuild-kit/esm-loader → @esbuild-kit/core-utils → esbuild 0.18.20` という開発用依存です。[上流のアドバイザリ](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99) はesbuildの開発サーバーが別サイトから応答を読める問題を説明し、`0.25.0` 以降を修正版としています。SideNoteの通常起動・配布版がこの開発サーバーを使用するという検出ではありません。

`package.json` の `overrides` で、`@esbuild-kit/core-utils@3.3.2` が使うesbuildだけを `0.25.12` に固定しました。他のesbuild利用者やDBの実行ライブラリは変更していません。`npm audit fix --force` が提示する古いDrizzle Kitへのダウングレードは適用していません。

互換性は、旧ローダー経由の同期・非同期TypeScript変換と、Drizzle CLIによるTypeScript設定・スキーマの読み込み、隔離フォルダへのマイグレーション生成で検証します。利用中のDBは開きません。上流が旧ローダーを外した時は、このoverrideと検証を見直します。

2026-09-22の修正後の `npm audit --include=dev` は0件でした。既知の指摘がないことを示す結果であり、ソース全体や依存バイナリに未知の問題がないことを保証するものではありません。
