# pdf-aligner
渡されたPDFを整列させ、一つの巨大な画像にする

仕様は [docs/pdf-aligner-blueprint.html](docs/pdf-aligner-blueprint.html) にある。処理はブラウザ内で完結し、外部への通信は行わない。対象ブラウザは Google Chrome のみ。

## 開発環境
- Node 24 LTS。`.nvmrc` に `24` を書いてある。`.npmrc` の `engine-strict=true` により、合わない Node では `npm install` が失敗する。
- [fnm](https://github.com/Schniz/fnm) を使うなら、シェルの設定に `fnm env --use-on-cd` を入れると、このディレクトリに入ったときに自動で切り替わる。
- パッケージマネージャは npm。依存は `save-exact=true` で、厳密なバージョンに固定する。
- 初回のみ、E2E 用のブラウザを取得する: `npx playwright install chromium`

## コマンド
| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー(CSP は付かない) |
| `npm run build` | ビルド(CSP の meta タグを index.html に埋め込む) |
| `npm run preview` | ビルド成果物の配信 |
| `npm run check` | lint、型チェック、単体テストをまとめて実行 |
| `npm run e2e` | ビルドして配信し、Playwright(同梱の Chromium)で E2E を実行 |
| `npm run fixtures` | テスト用 PDF を `tests/fixtures/` に手動で再生成(通常は E2E の開始時に自動で生成される) |

## E2E の成果物
- スクリーンショットは `e2e-artifacts/screenshots/<実行日時>/<テスト名>/<連番-ステップ名>.png` に保存される。新しい 10 実行分だけを残し、古いものは実行の開始時に削除される。
- `e2e-artifacts/`、`test-results/`、`playwright-report/` は git の追跡対象外。

## テスト用 PDF
`tests/fixtures/` の PDF は、全て `tests/fixtures/build.ts` が生成した自作のもの。外部の PDF は使わない。

PDF は git の追跡対象外。E2E の開始時(`e2e/global-setup.ts`)に自動で生成され、`npm run fixtures` でも生成できる。単体テストは、ディスク上のファイルに依存せず、メモリ上に生成した結果と、一時ディレクトリへの書き出しを検証する。
