# リリースとダウンロードページ

配布する版の作り方と、ダウンロードページの仕組みです。

## 配布するファイル

| ファイル | 中身 |
| --- | --- |
| `Fussenn-mac-arm64.dmg` | Apple Silicon Mac用。Developer IDで署名し、Appleの公証を受けたもの |
| `Fussenn-win-x64.exe` | Windows（x64）用のインストーラー。署名なし（[理由](desktop.md#windowsで使う)） |
| `SHA256SUMS.txt` | 上の2つのSHA-256 |

ファイル名には版番号を入れません。最新のリリースを指すリンク（`…/releases/latest/download/<ファイル名>`）が、版を重ねても変わらないようにするためです。版は、リリースの名前と、アプリの「Fussennについて」で確かめられます。Intel Mac用とLinux用は、今は配りません。

## ダウンロードページ

`https://fussenn.omoshironics.com/` に、GitHub Pagesで公開します。合同会社オモシロニクスのドメインのサブドメインです。

- 元のファイルは `site/` にあります。外部のフォント・スクリプト・アクセス解析は使いません。ほかのサイトから何かを読み込む記述があると、組み立てが止まります。
- `scripts/site-build.mjs` が、リポジトリの場所と、最新リリースの版・公開日・ファイルサイズ・SHA-256を書き込みます。リリースに配布ファイルかSHA-256が欠けていれば、組み立てを止めます。
- `.github/workflows/site.yml` が、リリースの公開、`main` への `site/` などの変更、手動実行のときに、組み立てて公開します。GitHub Freeでは、GitHub Pagesとリリースの公開ダウンロードに公開リポジトリが必要なため、非公開の間は動きません。
- 画像は `npm run site:images` で撮り直します。アプリをビルドし、空の一時フォルダとMock Providerで作ったデモ用のデータを撮るので、普段のデータやAIには触れません。

公開前に手元で確かめるときは、リリースなしで組み立て（`--preview`）、ローカルのWebサーバーで開きます。ページはCSPで自分のファイルだけを読み込むため、`file://` で開くとスタイルとスクリプトが読み込まれません。

```sh
npm run site:build -- --out .tmp/site --repo <owner>/<repo> --preview
python3 -m http.server --directory .tmp/site --bind 127.0.0.1 8000
```

## リリースの手順

1. 版を決めます。`npm version <版> --no-git-tag-version` で `package.json` を更新し、`CHANGELOG.md` の「未リリース」を版と日付の見出しにします。版の上2桁が変わるときは、サイドバーの版表示（`src/components/conversations/sidebar.tsx`）と [セキュリティ](../SECURITY.md) の保守対象も変えます。
2. Windows版は、GitHub Actionsの「Desktop applications」を手動で実行して作ります。成果物 `Fussenn-Windows-x64` から `Fussenn-win-x64.exe` を取り出し、`release/` に置きます（`gh run download <実行のID> -n Fussenn-Windows-x64 -D release`）。成果物は3日で消えます。初めて配る前と、インストーラーを変えたときは、使い捨てのWindowsで、ウィザードでのインストール・ショートカット・起動を確かめます。
3. Mac版は、証明書と公証の認証情報が入ったMacで、署名・公証つきで作ります（[Macの署名と公証](desktop.md#macの署名と公証)）。アプリとDMGをAppleへ送ります。公証ツールは画面のロック中にキーチェーンを読めないため、終わるまで画面をロックしないでください。
4. `npm run release:checksums` で `release/SHA256SUMS.txt` を作ります。2つの配布ファイルがそろっていなければ止まります。
5. リリースを作ります。公開すると、ダウンロードページも新しい版に変わります。

   ```sh
   gh release create v<版> --title "Fussenn <版>" --notes-file <説明のファイル> release/Fussenn-mac-arm64.dmg release/Fussenn-win-x64.exe release/SHA256SUMS.txt
   ```

6. ページの版・サイズ・SHA-256を確かめ、ページから実際にダウンロードして、インストールと起動を確かめます。

## 初めて公開するとき

1. リポジトリを公開に切り替えます。
2. リポジトリの Settings → Pages で、Source を「GitHub Actions」にします。
3. 同じ画面の Custom domain に `fussenn.omoshironics.com` を入れます。DNSより先に設定し、ほかの人に同じドメイン名を使われないようにします。アカウントの Settings → Pages でドメインを確認しておくと、さらに安全です。
4. `omoshironics.com` のDNSに、CNAMEレコードを追加します。名前は `fussenn`、値は `<owner>.github.io` です。
5. 証明書ができたら、Settings → Pages で「Enforce HTTPS」をオンにします。
6. 最初のリリースを、上の手順で作ります。リリースを公開すると、ページも公開されます。
7. 会社のホームページから、ダウンロードページへリンクします。
8. README・[セキュリティ](../SECURITY.md)・[公開準備と残作業](open-source-readiness.md) の「まだ公開していません」という記述を更新します。
