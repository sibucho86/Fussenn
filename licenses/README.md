# 配布用ライセンスの補足原文

`upstream/` はnpmパッケージに欠けているライセンス原文を補います。入手元・適用するパッケージの版・SHA-256は [sources.json](upstream/sources.json) に記録しています。文書は原文のまま、LFで保持します。ビルド時に外部からライセンス原文を取り直すことはありません。

- Drizzle ORM: `0.45.2` タグのApache-2.0原文。
- client-only: npmの `0.0.1` はMITを宣言し、Reactを上流として案内しています。ReactプロジェクトのMIT著作権表示を補います。npmパッケージと同じ版のソース一式を再収録したものではありません。
- `@next/env`: 同じ版のNext.jsのMIT原文に加え、パッケージが内包するdotenv `16.3.1`・dotenv-expand `10.0.0` のBSD原文を補います。

通常の依存はインストールされたパッケージからLICENSE・NOTICE・COPYING・COPYRIGHT・OFLなどを再帰的に収集します。Next.js内部の同梱コードやPDF.jsのフォントも含みます。新しい版に更新して原文が不足した場合は、`desktop:prepare` が停止します。確認せず汎用のMIT原文に置き換えたり、チェックを無効化したりしないでください。

詳細は [第三者ソフトウェアの説明](../THIRD_PARTY_NOTICES.md) を参照してください。
