# 技術構成・プロセス境界

[設計索引](../README.md) / 対応: 原Plan §5、§9、§14

## 要求・採用構成 R-PLATFORM

TypeScript、React、Electron、electron-vite、better-sqlite3、Argon2idライブラリ、electron-builder、Vitest、Playwrightを使用する。Windows x64のNSISインストーラーを標準配布物とする。具体的なバージョン、Node/npmの組合せ、KDF実装とパラメータはPhase 0で公式資料とWindows実行結果を確認し、lockfileとREADMEに固定する。現段階で互換性が確認済みとはしない。

## 責務と想定配置

| 配置 | 責務 |
| --- | --- |
| `src/main/index.ts`、`windows/` | 起動、単一起動制御、ウィンドウ、終了・再起動 |
| `src/main/ipc/` | 発信元検証、認証・認可、DTO検証、エラー変換 |
| `src/main/auth/` | Argon2id、ログイン制御、Mainメモリ内セッション、再設定 |
| `src/main/services/` | 業務ユースケース、トランザクション、ファイルダイアログ |
| `src/main/db/connection.ts`、`migrations/`、`repositories/` | SQLite接続、番号付き移行、SQLアクセス |
| `src/preload/index.ts` | 限定した型付きAPI、非公開トークン、操作通知 |
| `src/renderer/app/`、`components/`、`features/`、`styles/` | Reactレイアウトと機能別画面。SQL・Node・ファイル操作禁止 |
| `src/shared/contracts/`、`domain/`、`validation/` | 公開DTO、純粋な在庫計算、入力スキーマ。Main用秘密型を混ぜない |
| `src/recovery/` | Windows管理者向けの明示的なオフライン復旧ツール |
| `tests/unit/`、`integration/`、`e2e/` | 単体、一時SQLite、隔離Electron E2E |

原Planの `doc/plan.md` は推奨例として扱い、既存の `docs/plans/` を使用する。設定ファイル名はelectron-vite/electron-builderの採用バージョンで確定する。まだ存在しないコードやnpm scriptsを既存扱いしない。

## 起動・終了

1. アプリ識別子とuserDataを確定し、同一データ領域のアプリ/復旧ツールによる同時起動を拒否するロックを獲得する。
2. DB接続、foreign keys、busy timeout、移行を実行する。移行失敗時は通常業務を開始せず、データを保持したエラーにする。
3. 許可URLと設定を用いて単一BrowserWindowを生成する。セットアップ済みなら未認証状態から始める。
4. 終了時は新規処理を受け付けず、実行中のDB処理を完了/中断して接続・セッション・ロックを閉じる。

復元と復旧ツールは共通の保守サービスを利用し、DBファイルの検証・退避・適用・ロールバックを重複実装しない。Main処理を長時間ブロックする場合は、DB所有を一か所に保った専用処理系を選び、ビルドとセッション失効の挙動をPhase 0で記録する。

## 受け入れ条件

R-PLATFORM-01: 開発版とWindowsパッケージ版で起動、SQLite保存・再読込、Argon2id照合が動く。

R-PLATFORM-02: ネイティブ依存をElectron ABIへ再ビルドでき、配布物で必要なバイナリが読める。

R-PLATFORM-03: アプリと復旧ツールが同一DBを同時変更できず、実データを消さずに終了・再起動できる。
