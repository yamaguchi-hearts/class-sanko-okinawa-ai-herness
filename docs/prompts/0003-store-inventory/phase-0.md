# Phase 0: 技術検証とアプリ骨格

GPT6-Luna［High］の実装者として、[共通指示](README.md) を読んでから本フェーズを実行してください。

## 参照資料

- `AGENTS.md`、`docs/plans/0003-store-inventory.md`、同 `-decisions.md`。
- `docs/specs/0003-store-inventory/README.md`。
- 同設計配下 `architecture/platform.md`、`architecture/database.md`、`architecture/ipc.md`、`requirements/security.md`、`delivery/decisions.md`、`delivery/verification.md`。

## 作業範囲

現在は設計文書のみです。TypeScript + React + Electron + electron-viteの起動骨格、SQLite/Argon2idの最小検証、electron-builderによるWindows x64 NSIS試作までを実装してください。業務機能を先行実装しないでください。

1. Windows、Node/npm、既存の指示とファイルを確認する。採用バージョンの公式資料を参照し、互換性を検証して依存とlockfileを固定する。
2. Main/Preload/Rendererのビルドを分離し、sandbox、contextIsolation、nodeIntegration無効、許可URL、CSP、外部遷移/新規ウィンドウ拒否を設定する。
3. better-sqlite3とArgon2idのElectron ABI再ビルド、実行、配布物への同梱を検証する。KDFパラメータと実測を記録する。
4. 専用の検証データ領域にSQLiteを書き、終了・再起動で読めることを確認する。本番向けに匿名のDB読書きAPIや開発用認証バックドアを残さない。
5. NSISを生成し、パッケージ版で起動・SQLite再読込・KDF照合を確認する。
6. Vitest/Playwrightの設定、隔離userData、実際の開発/ビルド/型検査/テストscriptsを定義する。アプリ識別子、データ領域ロック、復旧ツール配布方式、内部トークン受渡しとMain内期限管理の方針を記録する。
7. 共有契約とマイグレーションの定義元を確定し、READMEと設計判断を更新する。

## 検証と完了

型検査・ビルド・最小テストを実行し、開発版とWindowsパッケージ版でネイティブ依存と永続読書きを確認してください。セキュアな骨格、固定された依存、lockfile、再現手順、検証結果がそろえば完了です。

実機やWindowsビルドが使えない場合は未検証として報告し、Phase 0完了としないでください。原Planの技術構成を変更する必要があれば管理者に確認してください。今回の変更を日本語で自動コミットし、IDと残る課題を報告してください。
