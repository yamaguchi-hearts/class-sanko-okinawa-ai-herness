# 監査ログ

[設計索引](../README.md) / 対応: 原Plan §3.5、§6.6、§7

## 要求 F-AUDIT

在庫履歴とは別に、認証、管理変更、在庫操作、CSV、バックアップ、復元、復旧の監査を記録する。通常UI/IPCに監査の編集・削除機能を設けない。IDと実行時のログインID・表示名・ロールを保持し、無効化・改名で過去表示が変わらないようにする。

| イベント群 | 記録する非機密情報 |
| --- | --- |
| SETUP_COMPLETED | 店舗、初期ADMINのID |
| LOGIN_SUCCEEDED/LOGIN_FAILED、LOGOUT、SESSION_LOCKED/UNLOCKED | 識別できる場合の実行者、結果分類。未知IDの入力原文は保存しない |
| USER_CREATED/UPDATED/DEACTIVATED/ROLE_CHANGED | 対象ID、許可した変更前後 |
| PASSWORD_RESET_REQUESTED/COMPLETED、PASSWORD_CHANGED | 対象ID、発行者、成功/失効等の分類。秘密なし |
| PRODUCT_CREATED/UPDATED/DEACTIVATED | 商品ID、SKU/名称/カテゴリ等の許可した変更前後 |
| CATEGORY_CREATED/UPDATED/DEACTIVATED | 対象ID、名称・状態 |
| STOCK_RECORDED | movement ID、商品、種別、delta、before/after、理由 |
| PRODUCTS_CSV_EXPORTED / PRODUCTS_CSV_EXPORT_FAILED / CSV_EXPORT_CANCELLED | 種別、件数、選択条件、結果分類。全CSV内容・絶対パスは保存しない |
| SETTINGS_UPDATED | 許可設定キーと前後値 |
| DATABASE_BACKUP_CREATED / DATABASE_BACKUP_FAILED / BACKUP_CANCELLED、BACKUP_CANDIDATE_REJECTED、BACKUP_RESTORED、RESTORE_FAILED | バックアップ識別、スキーマ、結果分類 |
| ADMIN_RECOVERY_REQUESTED | `actor_kind=OFFLINE_RECOVERY`、Windows実行者、対象ADMIN、退避識別子 |

details_jsonはイベント別スキーマから構築し、入力DTOや例外を丸ごとJSON化しない。パスワード、ハッシュ、コード、トークン、DB接続情報を記録しない。通常ファイルログにも同じ除外規則を適用する。

監査主体は移行5の`actor_kind`で`USER`/`OFFLINE_RECOVERY`/`SYSTEM`を区別する。オフライン復旧exeはログインユーザーIDを捏造せず、対象ADMINはentity参照として記録する。

## 整合性と失敗

業務変更と監査は同一DBトランザクションに含める。監査保存に失敗した業務変更は確定しない。ログイン失敗の制御更新は、監査失敗でも認証を許可する方向へ倒さない。

CSV/バックアップのファイルI/OとSQLiteは単一トランザクションにできない。ファイルを一時領域で完成させ、監査と保存結果の両方を確認して初めて成功表示する。ファイル作成後に監査が失敗した場合は成功とせず「ファイルは作成されたが記録に失敗」と明示し、自動再実行しない。失敗時に他の既存ファイルを消さない。

復元成功は復元後DBへ記録する。復元前の実行者が候補DBに存在しない場合はactor_user_idをnullとし、元の実行者スナップショットを保持してFK違反を避ける。失敗時は元DBを戻してそこへ失敗イベントを記録する。復元は監査履歴も置換するため、事前バックアップで旧履歴を保管する。

## 受け入れ条件

F-AUDIT-01: 全イベント群が許可済み項目だけを保存し、秘密がログ・DB監査に現れない。

F-AUDIT-02: 業務更新の監査失敗はロールバックし、ファイルI/Oの部分完了と復元先の実行者不在は正しく扱われる。
