# Phase 4: CSV・設定・バックアップ/復元・管理者復旧

GPT6-Luna［High］の実装者として、[共通指示](README.md) とPhase 3の成果を確認してください。

## 参照資料

- `docs/specs/0003-store-inventory/README.md`。
- 同配下 `requirements/security.md`、`architecture/platform.md`、`architecture/database.md`、`architecture/ipc.md`。
- 同配下 `features/csv.md`、`features/settings-and-backup.md`、`features/users-and-recovery.md`、`features/audit.md`、`delivery/operations.md`、`delivery/verification.md`。
- `docs/plans/0003-store-inventory-decisions.md` のA-03（初期版の復旧ツール）。

## 実装

1. フィルタ一致全商品のBOM付きCSVを固定列で出力する。式の先頭/空白/制御文字、引用符、改行を安全化し、Mainダイアログと監査を使う。
2. ADMIN専用の設定、ロック時間の範囲/既定値/短縮時再評価、DB保存先表示を作る。
3. backup API等で一貫したSQLiteファイルを作り、userDataの使用中DBを単純コピーしない。
4. 復元候補検査→強い確認→再認可→現DB自動バックアップ→接続停止/退避→候補入替→再検査/監査→再起動と再ログインを実装する。
5. 適用段階のマーカー、失敗ロールバック、強制終了後の回復を実装する。安全に元DBへ戻れなければ業務再開を拒否する。
6. Windows管理者昇格、アプリ停止とデータ領域排他、対象確認、事前バックアップを必須にしたオフライン復旧ツールを実装する。既存の有効ADMINへのコード発行と、DB破損時の検証付き復元を共通サービスで扱う。
7. 正常系/失敗系の監査、秘密除外、バックアップ/復旧の利用手順を更新する。

## 検証と完了

F-CSV/F-SETTINGS/F-BACKUP/F-RESTORE/F-RECOVERYを単体/DB/IPC/E2EとWindowsツール実行で検証してください。STAFF拒否、ダイアログ取消、不正/未来/別アプリDB、事前バックアップ失敗、接続/監査失敗、途中終了、非昇格、同時起動拒否を含めます。

復元で現DBを失わず、正常終了後は旧セッション/コードを使えず、復旧ツールから本人再設定→通常ログインまで動けば完了です。実機未検証を完了扱いせず、文書を更新し、日本語で自動コミットしてください。
