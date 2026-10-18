# 第三者のソフトウェア・素材

Fussenn自身のソースコードは [MIT](LICENSE) です。依存ソフトウェアにはそれぞれのライセンスが適用されます。

## ソースからの利用

依存の固定バージョンは `package-lock.json`、ライセンス識別子の一覧は [依存ライセンス一覧](docs/dependency-licenses.md) を参照してください。一覧はnpmメタデータから生成した調査用資料です。正式な条件・著作権表示は各パッケージのLICENSE・NOTICEなどを確認します。

ソースアーカイブに `node_modules`、生成したPDF.jsアセット、Node・Electronバイナリは含めません。`npm run setup` とビルド時に取得・生成します。開発専用ツールは一覧の対象外ですが、Electronは配布時に含むため別枠で記載しています。

## デスクトップバイナリを配布する場合

`npm run desktop:prepare` は `resources/licenses/` に次の原文と閲覧用の `index.html` を用意します。アプリの **ヘルプ → ライセンスを開く** から「Fussenn — ライセンス」を、ネット接続なしで閲覧できます。

- Fussenn自身のMIT原文。
- インストール済みの本番依存のLICENSE・NOTICE等。サーバーの追跡対象だけでなく、画面へ組み込まれるCodeMirror・React・Markdown・アイコン等も対象です。Next.js内部の同梱コード、PDF.jsのCMap・標準フォントの文書を再帰的に収録します。依存パッケージ内の使わない部分の表示も含めるため、実行コードだけを列挙したSBOMではありません。
- npm配布物に原文がないものの [上流文書](licenses/README.md)。版とSHA-256を固定し、取得元も同梱します。
- 使用するNodeのLICENSE、同じ版・OSのElectron配布物のLICENSEと `LICENSES.chromium.html`。Macのパッケージ生成で元のルート文書が削除されても、resources内の文書が残る構成です。

PDF.jsの元の `public/pdfjs/LICENSE`、`cmaps/LICENSE`、`standard_fonts/LICENSE_FOXIT`・`LICENSE_LIBERATION` とNodeの元のLICENSEも保持します。`manifest.json` に収録ファイルとSHA-256を記録し、ステージング時・パッケージ生成の前後で欠落や改変を検査します。未収録のサーバー依存が追加された場合も停止します。Apple Silicon Macでは、旧名称SideNote AIの時点で174パッケージ・342文書の収録とチェックサムを確認しました。詳しくは [Macの検証記録](docs/mac-validation.md) を参照してください。

## 画像変換バイナリの扱い

FussennのMarkdown画像はブラウザが直接表示し、Next.jsの画像変換を使いません。[公式の `images.unoptimized` 設定](https://nextjs.org/docs/app/api-reference/components/image#unoptimized) を有効にし、デスクトップの追跡出力から `sharp`・`@img/sharp-*` を除外しています。ビルド時のSWCと、ブラウザでのPDF抽出には使わない任意のNode canvasも、デスクトップの同梱対象外として検査します。

Sharp/libvipsは開発環境のnpm依存と [調査一覧](docs/dependency-licenses.md) には残りますが、新しいデスクトップ配布物へ入ると検査が失敗します。今後画像変換を有効にする場合は、この除外と検査を見直し、[Sharpの配布構成](https://sharp.pixelplumbing.com/install/) と [libvipsビルド元](https://github.com/lovell/sharp-libvips) から実際に含める版の条件・ソース提供等を確認してください。この変更より前に作ったインストーラーには遡って適用されません。

依存・素材・対象OSを変更した場合は原文と実際の配布物を再確認します。自動検査は文書の収録・整合性を確認するもので、あらゆる法的条件を判定するものではありません。

## 文書と画像

`public/brand/fussenn.svg` とそこから生成するアプリアイコンはFussenn用のオリジナル図形で、FussennのMITライセンスに含みます。[アイコンの元データと生成手順](docs/branding.md) を参照してください。

`docs/` の画像はFussennの機能紹介用スクリーンショットです。旧名称SideNote AIでの公開準備では24枚を目視確認し、バックアップ画面の画像はデモ用データと汎用の保存先で撮り直しました。実利用の会話・原稿・認証画面を追加する場合は、公開してよい内容かを確認してください。外部サービスの名称は、その接続先や互換性を説明するために使用しています。
