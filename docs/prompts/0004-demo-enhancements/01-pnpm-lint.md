# 01: pnpm移行とESLint

GPT6-Luna［High］の実装者として [共通指示](README.md) に従う。

## 参照

- `docs/specs/0004-demo-enhancements/tooling/pnpm.md`
- `docs/specs/0004-demo-enhancements/tooling/lint.md`
- `package.json`、`package-lock.json`、既存electron-builder設定、`tsconfig.json`、README。

## 実装範囲

1. 最新のGit状態とNode/依存を確認し、pnpmとESLint/parserの互換性を公式資料と実行結果で確認する。既存TypeScriptの無断降格はしない。
2. packageManager/enginesをpnpmへ変更する。`pnpm import` による移行、lock検証後にpnpm-lockを採用し、npm lockを削除する。必要な依存ビルドだけ許可する設定をコミットする。
3. 内部npm呼出しをpnpmへ替え、E2E、ビルド、NSIS、復旧exeの既存機能を落とさない。
4. ESLint flat config、TypeScriptとReact Hooksルール、環境別globals、Rendererの禁止import、生成物除外を設定する。
5. lint/lint:fix/check scriptsを追加する。既存コードの違反は最小限修正し、全体ignoreや広域disableで隠さない。formatterの一括導入はしない。
6. 現行の開発手順をpnpmへ更新する。過去検証のnpmコマンドは履歴として保持する。

## 検証・完了

固定pnpmのfrozen-lockfile導入、lint、型検査、単体/DB、ビルド、E2Eを実行する。WindowsでNSISと復旧exeを生成し、配布版でSQLite/Argon2idが動くことを確認する。依存ビルドがスキップされていないことを確認する。

AC-PNPM/AC-LINTを満たすことで完了。lintが違反時に失敗することも一時的な検証で確かめる。未検証と成功を区別して記録し、対象変更を日本語で自動コミットして報告する。
