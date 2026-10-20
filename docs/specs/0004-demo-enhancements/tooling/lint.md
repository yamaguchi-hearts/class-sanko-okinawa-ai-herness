# linterの追加

[索引](../README.md) / 要求 R-LINT

## 採用と対象

設計判断としてESLint、`@eslint/js`、`typescript-eslint`、`eslint-plugin-react-hooks`、`globals` を開発依存に採用し、互換版を固定する。`typescript-eslint@8.71.2` の公式対応範囲はTypeScript `>=4.8.4 <6.1.0` であるため、TypeScriptは `6.0.3` に固定する。TypeScriptの機能互換性は型検査・テスト・ビルドで確認する。

`eslint.config.mjs` のflat configを定義元とし、Main/Preload/Renderer/共有コード/復旧ツール/テスト/TS設定ファイルを対象にする。`node_modules`, `out`, `release`, `coverage`, `test-results`, `playwright-report` を除外する。

## ルールと責務

- JavaScript推奨ルールとTypeScript推奨ルールを適用する。TSと重複するno-unused-vars等はTS側を使用する。
- Rendererはブラウザー、Main/Preload/復旧/設定はNode、テストは実際のVitest/Playwright設定に合わせる。全領域へNode globalsを一括付与しない。
- Reactへrules-of-hooksとexhaustive-depsを適用し、採用版の他の推奨ルールも適合を確認する。依存配列を誤魔化したり、動作を変える自動修正を一括実行しない。
- Rendererから `node:*`、electron、better-sqlite3、argon2、Main/復旧専用モジュールへの直接importを制限する。lintはIPCの実行時認可の代わりにはしない。
- 既存コードの違反は必要な範囲で直し、全体ignore、広域disable、TSのstrict無効化で合格させない。限定例外は理由と範囲を記載する。
- フォーマッター導入や全コードの整形は今回の必須に含めない。

## scripts

`lint` は `eslint . --max-warnings 0`、`lint:fix` は同じ範囲へ `--fix` を付ける。通常検証ではfixなしを使う。`check` はlint→typecheck→単体/DBテストを実行し、途中失敗で非ゼロ終了する。E2Eと配布確認は別に実施する。

## 受け入れ条件 AC-LINT

pnpmからlintが警告なしで成功し、ルール違反では非ゼロ終了する。React Hooks違反とRendererの禁止importを検出できることを一時的な変更で確認し、確認用の違反コードは残さない。型検査・既存テストも成功し、生成物や依存配下を検査しない。

## 根拠

[ESLint flat config](https://eslint.org/docs/latest/use/configure/configuration-files)、[typescript-eslint導入](https://typescript-eslint.io/getting-started/)、[React Hooks公式ルール](https://react.dev/reference/eslint-plugin-react-hooks) を基準とする。
