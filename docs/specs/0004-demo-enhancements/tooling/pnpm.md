# pnpm運用への統一

[索引](../README.md) / 要求 R-PNPM

## 目的・差分

現状の `package.json` は `packageManager: npm@11.17.0` とnpm enginesを持ち、`test:e2e` と `dist:recovery` の内部にもnpm呼出しがある。これをpnpmへ統一する。Electron/React/TypeScriptの採用構成を変更する依頼ではない。

## 設計

1. 現在のNode/依存/Windowsビルドで使えるpnpmを検証し、`packageManager` に正確な `pnpm@x.y.z` を固定する。enginesのnpm指定をpnpmへ置き換える。現行Nodeの固定値を無断で変更しない。
2. `package-lock.json` から `pnpm import` で移行を試み、直接依存の固定と解決差分を確認する。`pnpm-lock.yaml` をコミットし、移行成功後はnpm lockを削除する。二つを並行更新しない。
3. scripts内部の `npm run build` は `pnpm run build` に置換し、既存のPhase 4向けスクリプトを落とさない。READMEと現行プロンプトの運用コマンドも変更する。過去の検証記録のnpm表記は事実として残す。
4. 初回はlock生成を伴う `pnpm install`、以後の再現確認は `pnpm install --frozen-lockfile`。ローカルツールは `pnpm exec` を使い、npxによる未固定ツールの取得を運用手順に残さない。
5. pnpmのネイティブ依存ビルド許可を採用版の設定形式でリポジトリへ明示する。electron、better-sqlite3、argon2、esbuild等の実際に必要な依存を調査して許可し、全面許可にしない。既存のnpm向け `allowScripts` をそのままpnpmの許可として扱わない。
6. Electron用再ビルド、asar内のネイティブバイナリ、NSIS/復旧exeの依存収集を検証する。必要なら採用electron-builderの公式資料に従いnode linker等を調整し、理由を残す。

コマンド例は実装後の契約として以下を維持/追加する。

| 用途 | コマンド |
| --- | --- |
| 開発 | `pnpm run dev` |
| 静的解析/型検査 | `pnpm run lint` / `pnpm run typecheck` |
| 単体・DB / E2E | `pnpm run test` / `pnpm run test:e2e` |
| ビルド | `pnpm run build` |
| Windows / 復旧配布 | `pnpm run dist:win` / `pnpm run dist:recovery` |
| 配布版確認 | `pnpm run test:packaged` |

## 受け入れ条件 AC-PNPM

- 固定pnpmとlockfileからクリーン導入を再現でき、lock差分なしで再インストールできる。
- scriptsの内部と現行起動手順にnpm/npx依存がない。過去記録は除く。
- Windowsパッケージ版でSQLite保存・Argon2id照合が動き、復旧exeも生成できる。
- install時に必要なビルドを黙ってスキップして成功扱いしない。未検証なら明記する。

## 根拠

pnpmの設定先と依存ビルド許可は [公式設定](https://pnpm.io/settings) と [Build Settings](https://pnpm.io/settings/build) を確認する。設定名は採用バージョンに合わせ、未検証の最新バージョンを文書だけで固定しない。
