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
| `npm run e2e:chrome` | 同じ E2E を、インストール済みの Google Chrome で実行(150 ページの描画は、同梱の Chromium より遅い) |
| `npm run fixtures` | テスト用 PDF を `tests/fixtures/` に手動で再生成(通常は E2E の開始時に自動で生成される) |

## E2E の成果物
- スクリーンショットは `e2e-artifacts/screenshots/<実行日時>/<テスト名>/<連番-ステップ名>.png` に保存される。新しい 10 実行分だけを残し、古いものは実行の開始時に削除される。ダウンロードした PNG も、同じディレクトリに保存される。
- 性能の実測値(A4・30 ページと A4・150 ページの、描画・列数の変更・PNG の生成にかかる時間)は `e2e-artifacts/performance/<実行日時>/<ページ数>pages.json` に保存される。記録するだけで、閾値でテストは失敗させない。
- `e2e-artifacts/`、`test-results/`、`playwright-report/` は git の追跡対象外。

## pdf.js の更新
`pdfjs-dist` は厳密なバージョンに固定している(`package.json` の `dependencies`)。ライブラリ本体、Worker、付属アセット(CMap、標準フォント、wasm、ICC プロファイル)は、同じバージョンのものが揃っている必要がある。
- 付属アセットは、`tools/pdfjs-assets.ts` の Vite プラグインが、`node_modules/pdfjs-dist/` から、開発サーバーの配信とビルドの成果物(`dist/pdfjs/`)に出力する。コピーは要らないので、`npm install --save-exact pdfjs-dist@<版>` で版を上げれば、アセットも一緒に更新される。
- 配信するフォルダは `src/pdf/asset-paths.ts` の `ASSET_FOLDERS`。新しい版でフォルダが増減したら、ここを直す。
- 更新したら、`npm run check` と `npm run e2e` を通す。特に `e2e/fonts.spec.ts`(CMap を同一オリジンから読むこと、コンソールに警告が出ないこと)と、`e2e/network-isolation.spec.ts`(通信ゼロ)を見る。
- pdf.js の内部の挙動に依存している箇所(`src/pdf/source.ts` の、作業用 canvas を経由した描画。`src/pdf/page-sizes.ts` の、壊れたページの扱い)は、更新後に E2E の `render.spec.ts` と `errors.spec.ts` で確かめる。

## テスト用 PDF
`tests/fixtures/` の PDF は、全て `tests/fixtures/build.ts` が生成した自作のもの。外部の PDF は使わない。

PDF は git の追跡対象外。E2E の開始時(`e2e/global-setup.ts`)に自動で生成され、`npm run fixtures` でも生成できる。単体テストは、ディスク上のファイルに依存せず、メモリ上に生成した結果と、一時ディレクトリへの書き出しを検証する。

## 手動で確認すること(自動化できないもの)
- **複数ファイルのダウンロードの確認**(「すべてダウンロード」)。Chrome は、1 回の操作で複数のファイルを続けて保存すると、「複数のファイルのダウンロード」の許可を求めることがある。Playwright はこの確認を経由しないので、E2E では再現できない。
  1. `npm run build && npm run preview` で配信し、Google Chrome(ウィンドウあり)で開く。
  2. 3 ページ以上の PDF を選び、区切りに `2, 3` のように入力する。
  3. 「すべてダウンロード」を押す。許可を求められたら「許可」を選び、全セグメントのファイルが保存されることを確かめる。
  4. 「ブロック」を選んだときは、後続のファイルが保存されない。アプリはそれを検知できない(ボタンの説明に、許可を選ぶよう書いてある)。Chrome の設定の「自動ダウンロード」で、そのサイトを許可に戻せる。
- ツールバーは、幅が足りないと折り返す。見た目は、E2E のスクリーンショット(`split.spec.ts` のもの)で確かめる。

## TODO
- テストの内容を理解する
- 元PDFプレビュー機能を追加する(仕様は blueprint の F11 を参照。仕様合意済み、検証設計と実装は未着手)