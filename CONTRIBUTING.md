# 開発への参加

Fussennは、会話・資料・原稿の一部に付箋を付け、AIと相談しながら読み書きするローカルアプリです。不具合の報告、使い方の改善、小さな修正から参加できます。

## 開発環境

Node.js 22.13以上とnpmを使います。検証基準はNode.js 24.22.2です。リポジトリを取得して、次を実行してください。

```sh
npm run setup
```

`.env.example` を `.env.local` にコピーし、`ENABLE_MOCK_PROVIDER=true` を指定して `npm run dev` で起動します。Mockは固定回答を返し、外部AIへの接続や利用料金は発生しません。

普段の原稿と開発データを分けるには、`.env.local` に `FUSSENN_DATA_DIR=./.tmp/development-data` を指定してください。`npm run dev` と開発用の `npm run desktop` の両方が、作業フォルダを基準にこの保存先を使います。旧名の `SIDENOTE_DATA_DIR` も受け付け、新名を優先します。既存の保存先を使う場合は、変更前にアプリからバックアップを保存します。

## 変更と確認

1. 変更用ブランチを作り、目的を一つに絞って修正します。
2. `npm run check` でlint・型検査・通常テスト・配布ツールの検査・本番ビルドを確認します。
3. 画面の動作を変えた場合は、`npx playwright install chromium` の後、関連するブラウザテストを実行します。例: `npm run test:e2e -- tests/e2e/manuscripts.spec.ts`。テストのスクリーンショットは `test-results/` に保存します。説明用の `docs/` の画像を撮り直す場合だけ `FUSSENN_UPDATE_DOCS_IMAGES=1` を指定し、コミット前にすべての画像を目視で確認してください。
4. `npm run licenses:check` と `npm run secrets:check` を実行します。依存を変更した場合は `npm run licenses:report` で一覧を更新し、`npm run audit:dependencies` で開発用も検査してください。判定基準は [依存のセキュリティ確認](docs/dependency-security.md) にあります。配布用の原文収録は `desktop:prepare`・`desktop:pack` で検査します。
5. PRには、直した問題・変更後の動作・実施した確認を記載します。未確認のOSや動作も明記してください。

通常テストとブラウザE2Eは専用の一時データを使用します。`npm run test:codex` は実際のログインと利用枠を使う任意の検証で、通常のチェックには含みません。

デスクトップ部分の変更は [ビルドと検証手順](docs/desktop.md) に従って確認してください。`desktop:prepare` とパッケージ生成・配布版テストは順番に実行します。同じ生成先を使う処理を同時に走らせないでください。

Windowsインストーラーの変更では、[導入・更新・削除の自動検証](docs/windows-installer-test.md) も使えます。検証専用のアプリ登録と架空データで実行します。

アイコンを変更する場合は [元データと生成手順](docs/branding.md) に従います。`npm run icons:check` は元SVGと生成済みファイルの一致を確認し、通常のチェックとパッケージ生成でも実行します。

## データと依存関係

- 会話・原稿・PDF・バックアップ・APIキー・認証情報・実利用のログはコミットしないでください。再現例には架空の短いデータを使います。
- DBやバックアップ形式を変える場合は、既存データの移行と復元を検証します。
- 新しい依存や素材には、入手元とライセンスを確認できる情報を残してください。第三者のコードの著作権表示を削除しないでください。
- ソースは [MITライセンス](LICENSE) です。自分が公開できる権利を持つ変更を提案してください。

セキュリティ問題の報告は [SECURITY.md](SECURITY.md) を参照してください。

## 作業フォルダの容量を減らす

アプリと開発サーバーを終了した後、`node_modules/`、`.next/`、`.next-desktop/`、`.desktop/`、`public/pdfjs/`、`*.tsbuildinfo` は削除できます。開発を再開するときは `npm run setup` を実行してください。ビルド出力とPDF用ファイルは、通常の開発・ビルド手順で再生成されます。

`release/` の配布物や検証レポートは、必要なものを作業フォルダの外へ保管できます。`.tmp/` には開発用DBやバックアップが入る場合があるため、一括削除せず中身を確認してください。`.env.local` と実利用の保存データは保持します。これらのローカルファイルと生成物はGitの対象外です。

## セットアップの仕組み

`npm run setup` は `npm ci --ignore-scripts` の後、必要なツール（esbuild、unrs-resolver、electron-winstaller、利用可能な環境のfsevents）の初期化だけを実行します。最後にメモリ上のSQLiteとesbuildが動くことを確認します。ユーザーのDBは開きません。

これは、better-sqlite3 13.0.3の同梱バイナリがある環境でもnpmが不要な `node-gyp rebuild` を呼び出す [上流の問題](https://github.com/WiseLibs/better-sqlite3/issues/1516) を避けるためです。通常の `npm ci` ではWindowsのVisual Studio Build Toolsなどを要求される場合があります。依存を追加・更新する場合は、必要なインストール処理と `scripts/setup.mjs` の対象も確認してください。Electron本体はデスクトップ起動・パッケージ生成時に取得します。
