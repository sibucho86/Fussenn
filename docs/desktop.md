# Fussenn デスクトップ版

普段の操作をFussenn専用ウィンドウで行います。会話・付箋・資料インポート・Obsidian書き出し・バックアップは既存の画面と機能を引き継ぎます。

## Windowsで使う

以下のビルド手順で生成する `release/Fussenn-0.2.4-win-x64.exe` はインストーラーです。現時点でGitHub上の配布先はありません。インストール後、デスクトップまたはスタートメニューの **Fussenn** を開いてください。管理者権限を前提としないユーザー単位のインストールで、標準のインストール先は `%LOCALAPPDATA%\Programs\Fussenn` です。

インストールせずに確認する場合は `release/win-unpacked/Fussenn.exe` を開けます。この場合は `win-unpacked` フォルダ全体が必要で、EXEだけを移動できません。

旧 **SideNote AI** は別アプリとして残ります。Fussennで保存データを確認してから旧アプリをアンインストールしてください。アンインストールしても保存データは削除しません。

- 画面の ×、メニューの「終了」、WindowsのCtrl+Q、MacのCmd+Qで終了できます。
- 閉じる前に編集中の付箋・原稿本文・原稿案を保存します。保存に失敗した場合は画面を残すので、内容とエラーを確認してもう一度終了してください。
- AIの回答やファイルの保存が進行中の場合は、完了を待ってから閉じてください。
- 起動中にもう一度アイコンを押すと、既存のウィンドウを表示します。
- Obsidian ZIP・バックアップの書き出しではOSの保存ダイアログが開きます。
- 初回のChatGPTログインはブラウザで行い、認証後にアプリへ戻ります。

現在は未署名の試作版です。Windowsインストーラーに発行元の署名はありません。自動更新はなく、新しいビルドは手動で入れ替えます。

## 保存先と認証

新規の標準保存先は `~/.fussenn/fussenn.db` です。`~/.fussenn` がなく、名称変更前の `~/.sidenote-ai` がある場合は、旧フォルダを移動せずそのまま使います。使用するフォルダ内に `fussenn.db` がなく `sidenote.db` があれば、そのDBを使います。両方のフォルダがある場合は `~/.fussenn` を使い、旧フォルダには触れません。

保存先の名前も変える場合は、`~/.fussenn` がまだないことを確認し、アプリとブラウザ版を終了してから `~/.sidenote-ai` を `~/.fussenn` に名前変更してください。コピーではなく移動し、中の `sidenote.db` はそのままで構いません。すでに両方のフォルダがある場合は、上書きせず、使うデータを確認してください。

アプリを閉じても、移動しても、アプリをアンインストールしても、保存データは削除しません。全体バックアップの書き出し・復元は設定画面から行えます。新しいバックアップは `.fussenn.json` で、名称変更前の `.sidenote.json` も復元できます。

使用中のデータディレクトリ内の `desktop/` は専用ウィンドウの設定・キャッシュ・起動ログです。新規の標準保存先では `~/.fussenn/desktop/` になります。`desktop/server.log` に内部サーバーの起動エラーを記録します。引き出し線の表示状態などブラウザ内だけに保存していた設定は、専用アプリでは別の状態として保存されます。

名称変更で独自URLが `fussenn://app/` に変わるため、デスクトップ版では引き出し線の表示切替と原稿の表示モードが一度だけ初期値に戻ります。会話や付箋の内容・配置は保持します。ブラウザ版は旧キーから表示設定を引き継ぎます。

同じ保存先をブラウザ版と専用アプリで同時に開くことはできません。データ用フォルダ内の `.runtime.db` に保持するOSの排他ロックで二重利用を防止します。通常終了・異常終了ともにロックは解放されます。

Windowsのブラウザ版は **Fussenn Browser - Stop** で終了します。専用アプリが起動中のブラウザ版を検出すると、新旧の名前に応じて **Fussenn Browser - Stop** または **SideNote AI - Stop** を案内します。ブラウザ版用ショートカットの作成・更新は [使い方](usage.md#従来のブラウザ版をwindowsのデスクトップから起動する) を参照してください。

Codex CLIの既存ログインを再利用します。Codex CLI自体はアプリに同梱していません。CLIが利用できない場合、設定画面に案内を表示します。MacのFinder起動ではHomebrew、ユーザーのnpm、Volta、nvmなどの一般的なインストール先も探します。独自の場所にある場合は `CODEX_BIN` を設定してください。

配布版のサーバー設定は、必要な場合に使用中のデータディレクトリ内の `desktop.env` へ記載します。新規の標準保存先では `~/.fussenn/desktop.env`、旧フォルダを引き継いだ場合は `~/.sidenote-ai/desktop.env` です。利用できる項目は以下の4つです。値はアプリ内のローカルサーバーだけが読みます。

```dotenv
CODEX_BIN=codex
OPENAI_API_KEY=
OPENAI_COMPAT_API_KEY=
ENABLE_MOCK_PROVIDER=false
```

開発環境では作業フォルダの `.env.local` も読みます。`desktop.env` の値が優先されます。配布物に開発環境の.env、会話DB、認証情報は含めません。保存先は環境変数 `FUSSENN_DATA_DIR` で変更できます。旧名の `SIDENOTE_DATA_DIR` も利用でき、両方を指定した場合は新名を優先します。開発用の `npm run desktop` は、`npm run dev` と同じ規則で環境変数と `.env.local` などを読み、同じ新名優先の規則で保存先を決め、相対パスは作業フォルダ基準で使います。

## 開発とパッケージ作成

Node.js 22.13以上とnpmが必要です。確認に使ったバージョンはNode.js 24.22.2です。配布版には、ビルドしたNode.jsと同じ版を同梱します。

```sh
npm run setup
npm run desktop:prepare
npm run desktop
```

配布物を作る場合は、同じOS・CPUの環境で以下を順に実行します。prepare中にpackを走らせないでください。

```sh
npm run desktop:prepare
npm run desktop:pack
npm run test:desktop:packaged
npm run desktop:dist
```

`test:desktop:packaged` はWindows・Mac・Linuxが対象です。画面のないLinux環境では `xvfb-run -a npm run test:desktop:packaged` のように仮想ディスプレイ上で実行します。Linuxでは展開したアプリ（`release/linux-unpacked`）を検証し、AppImageそのものは起動しません。Ubuntu 24.04以降の標準設定ではAppArmorが非特権ユーザー名前空間を制限し、Electronのサンドボックスが使えない場合があるため、CIではこの制限を緩めて実行しています。AppImageからの起動と、標準設定のUbuntuでの起動は確認していません。配布版を作業フォルダの外の一時ディレクトリへコピーして検証し、終了後に片付けます。開発用node_modulesが不足ファイルを補ってしまう状況を避けるためです。`test:desktop` は通常、開発用Electronを起動します。個別の配布版を検証する場合は `FUSSENN_DESKTOP_EXE` に実際の実行ファイルを指定します。

Windowsの導入・更新・アンインストールは [インストーラーの検証手順](windows-installer-test.md) を参照してください。`test:desktop:installer` は、登録情報と保存先を分けた検証専用インストーラーでデータの引き継ぎを確認します。

PowerShell:

```powershell
$env:FUSSENN_DESKTOP_EXE = (Resolve-Path 'release/win-unpacked/Fussenn.exe').Path
npm run test:desktop
```

MacのApple Silicon:

```sh
FUSSENN_DESKTOP_EXE="$PWD/release/mac-arm64/Fussenn.app/Contents/MacOS/Fussenn" npm run test:desktop
```

Intel Macでは `release/mac/Fussenn.app/Contents/MacOS/Fussenn` を指定します。

`desktop:prepare` は通常のブラウザ版 `.next` とは別に `.next-desktop` へビルドします。配布版の内部サーバーは、表示したページのキャッシュをメモリだけに置き、インストールしたアプリのファイルを変更しません。`.desktop` に配布用ファイルを集約し、`release` に成果物を作ります。いずれも生成物です。Next.jsが必要とするサーバー依存とOS/CPUに合った公式Nodeバイナリを同梱し、NodeのSHA-256を公式配布一覧と照合します。

配布物名は `Fussenn-<version>-<os>-<arch>.<ext>` です。Windowsでは `Fussenn-0.2.4-win-x64.exe`、Apple Silicon Macでは `Fussenn-0.2.4-mac-arm64.dmg` などを生成し、Macのアプリ名は `Fussenn.app` です。LinuxではAppImageの慣例に合わせ、CPU名が `x86_64` の `Fussenn-0.2.4-linux-x86_64.AppImage` になります。

アイコンは [専用の元SVG](branding.md) から生成したICO・ICNS・PNGを使います。Windowsでは署名だけを省略して製品情報を設定し、生成したEXEとインストーラーの埋め込みアイコン・製品名・バージョンを自動検査します。

## Mac対応の範囲

Apple Silicon / Intel用のビルド設定と、Finder起動時のCLI検索、Macのメニュー・キーボード操作を実装しています。`.github/workflows/desktop.yml` はWindows x64、macOS arm64、macOS x64、Linux x64の各runnerで配布版テストとパッケージ生成を行う定義です。ブラウザ版のテストは `.github/workflows/checks.yml` でWindowsとLinuxを対象にしています。2026-10-18、非公開のGitHubリポジトリで両方を実行し、すべてのジョブが成功しました。非公開リポジトリではMacのrunnerにLinuxの約10倍の料金がかかるため、非公開の間はデスクトップのビルドをプルリクエストでは行わず、手動実行時だけ行います。CIで作るテスト用の配布物（未署名）は3日で削除されます。

以下の2026-09-22〜23の結果は、旧名称SideNote AIでの検証記録です。

2026-09-22〜23、Apple Silicon・macOS 26.6.2・Node.js 24.15.0・npm 11.12.1で、新規セットアップからprepare・pack・distまで成功し、Mac arm64のDMG・ZIPを生成しました。DMGから取り出して日本語・空白を含むパスに置いたアプリで、配布版テスト全11件が成功しています。最小限のPATHでの起動、Mac編集キー・Undo/Redo、終了直前保存と再起動、Macアプリメニューからの終了も確認しました。

実機ではOSの保存ダイアログによる日本語名のZIP保存・キャンセル、Aboutのバージョン0.2.4と専用アイコン、同梱ライセンスの表示、実際のCmd+Qと再起動後の本文保持を確認しました。DMGとZIPから取り出したアプリのファイル・シンボリックリンク2,120件は内容と権限が一致しています。詳細と再現手順は [Macの検証記録](mac-validation.md) を参照してください。

2026-10-18、名称変更後のコードでIntel（x64）版を、Apple Silicon上のRosetta 2を使って検証しました。setup・check・prepare・pack・distが成功し、配布版テスト11件が成功しています。アプリ本体・同梱Node・SQLiteはx86_64です。この検証で、画面の準備前に閉じると保存の確認を待ち続けて終了できない問題を見つけ、修正しました。Rosetta 2は実機のIntel Macと同一ではありません。同日、GitHub ActionsのIntel Mac（`macos-15-intel`）でも、ビルドと配布版テストの成功を確認しました。

**Apple Developerの正式な署名・公証は未実施です。** Intel Macでの画面を使った実機操作も確認していません。現在のMac成果物にはElectron由来のad-hoc署名が残っていますが、リソースを含む厳密な署名検証とGatekeeper判定には通っていません。保護設定やquarantineは変更していません。現状のMacパッケージ設定はローカル検証用で、一般配布の準備完了とは扱いません。

## 検証状況と公開準備

WindowsとApple Silicon Macで通常テスト・ブラウザE2E・配布版テストを確認しています。GitHub Actionsでは、Windows x64・macOS arm64・macOS x64・Linux x64のビルドと配布版テストが成功しています。ライセンス原文は `resources/licenses/` に集約し、prepareとpackの前後で検査します。アプリのメニューからバージョンとライセンスを確認できます。Intel Mac・Linuxの画面を使った実機操作と、正式な署名・公証は残っています。機能の変更は [変更履歴](../CHANGELOG.md)、最新の公開準備状況は [公開準備](open-source-readiness.md) を参照してください。

## 実装の境界

画面ではNode.jsを直接利用できない設定にし、context isolation・sandboxを有効にしています。専用origin `fussenn://app/` のリクエストを、アプリが作ったloopbackサーバーへ中継します。起動ごとに作るトークンでデスクトップ版APIを保護し、トークンは画面へ渡しません。外部ページは専用ウィンドウへ読み込まず、OSのブラウザへ渡します。

サーバー起動スクリプトは通常のNodeから読める実ファイルとして同梱します。ElectronのASARはElectron内の特別なファイルシステムなので、内部サーバー用Nodeの起動ファイルをASAR内に置きません。[ElectronのASAR仕様](https://www.electronjs.org/docs/latest/tutorial/asar-archives)
