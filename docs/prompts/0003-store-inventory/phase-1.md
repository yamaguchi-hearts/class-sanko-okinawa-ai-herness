# Phase 1: DB・IPC・認証・再設定基盤

GPT6-Luna［High］の実装者として、[共通指示](README.md) とPhase 0の記録を読んで実行してください。前段のWindows/ネイティブ検証と共有契約が前提です。

## 参照資料

- `docs/specs/0003-store-inventory/README.md`。
- 同配下 `requirements/scope-and-roles.md`、`requirements/security.md`、`requirements/user-interface.md`。
- 同配下 `architecture/database.md`、`architecture/ipc.md`、`features/authentication.md`、`features/users-and-recovery.md`、`features/audit.md`、`delivery/verification.md`。
- `docs/plans/0003-store-inventory-decisions.md` の再設定コードの決定。

## 実装

1. SQLite接続、foreign keys、busy timeout、番号付き移行を実装する。app_meta/users/reset/audit/settingsを作り、新規・既適用DB・未来版拒否をテストする。
2. 発信元・フレーム・URL・DTO・状態・ロールをMainで検証する共通IPC境界を作る。匿名/専用状態APIの例外を列挙し、任意チャンネルを公開しない。
3. 一度だけの初期セットアップ、Argon2id、ログイン/ログアウト、5回失敗からの段階待機、DB永続化、共通エラー、セッション失効、Main基準の無操作ロックと本人解除を実装する。
4. 初期画面、ログイン/ロック、自分のパスワード変更、共通レイアウトを作る。ポーリング・処理完了は本人操作に数えない。
5. ユーザー作成・最後のADMIN保護・ロール/無効化による失効、コード発行・検証・消費・制限セッション・本人の新パスワード設定をサービスと最小UIで縦断させる。新規ユーザーもコード方式にする。
6. 認証/ユーザー変更の監査と秘密除外を実装する。オフライン復旧ツールはPhase 4へ残し、コード発行・再設定の共通サービスを用意する。

## 検証と完了

F-AUTH、F-USERSのサービス、F-RESET、R-SEC/R-IPC/R-DBの本フェーズ対象をVitest/DB統合と最小E2Eで検証してください。特にセットアップ競合、最後のADMIN保護、旧トークン拒否、ロック文脈、コード期限・再発行・一度限り・業務API拒否を確認します。

初回セットアップ→ADMINセッション→終了→再ログイン、STAFF作成→本人のコード設定→ログインが動き、未認証と権限不足をMainで拒否できれば完了です。検証結果を記録し、日本語で自動コミットしてください。
