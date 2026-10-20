# DB・マイグレーション

[設計索引](../README.md) / 対応: 原Plan §6–7、追加A-02/A-03

## 共通契約 R-DB

SQLiteはuserData内の固定ファイル `store-inventory.sqlite` に保存し、アプリ更新と分離する。Phase 0の検証DBは `phase0-validation/persistence.sqlite` に置き、製品DBから分離する。IDはUUID形式のテキスト、日時はMainが生成するUTC ISO 8601、真偽値は0/1。外部キーを有効化し、busy timeoutは初期案5秒とする。整数在庫は0〜2,147,483,647とし、DTO検証とDB CHECKの両方で範囲を制約する。これはJavaScriptとSQLite間の数量精度を明確にする設計上限である。

## スキーマ定義

以下のPKはPRIMARY KEY、NNはNOT NULL。原Planのスキーマに、再設定と復元検証に必要な補足を加える。

| テーブル | カラム・制約 |
| --- | --- |
| `app_meta` | `key TEXT PK`, `value TEXT NN`。セットアップ完了、アプリ種別、インストールID。秘密を保存しない |
| `users` | `id TEXT PK`, `login_name TEXT NN`, `display_name TEXT NN`, `password_hash TEXT NN`, `role TEXT NN CHECK(ADMIN/STAFF)`, `is_active INTEGER NN DEFAULT 1 CHECK(0/1)`, `must_change_password INTEGER NN DEFAULT 0 CHECK(0/1)`, `failed_login_count INTEGER NN DEFAULT 0 CHECK(>=0)`, `locked_until TEXT NULL`, `created_at/updated_at TEXT NN`, `last_login_at TEXT NULL`。`UNIQUE(login_name COLLATE NOCASE)` |
| `password_reset_codes` | `id TEXT PK`, `user_id TEXT NN REFERENCES users(id) ON DELETE RESTRICT`, `code_hash TEXT NN`, `expires_at TEXT NN`, `failed_attempt_count INTEGER NN DEFAULT 0 CHECK(>=0)`, `consumed_at/revoked_at TEXT NULL`, `created_at TEXT NN`, `issuer_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL`, `issuer_kind TEXT NN CHECK(ADMIN/OFFLINE_RECOVERY)`。ユーザーごとに未消費・未失効コードは最大1件（部分一意索引） |
| `categories` | `id TEXT PK`, `name TEXT NN UNIQUE COLLATE NOCASE`, `name_key TEXT NN UNIQUE`, `is_active INTEGER NN DEFAULT 1 CHECK(0/1)`, `created_at/updated_at TEXT NN` |
| `products` | `id TEXT PK`, `sku TEXT NN`, `name TEXT NN`, `name_search_key TEXT NN`, `category_id TEXT NULL REFERENCES categories(id) ON DELETE RESTRICT`, `unit TEXT NN`, `current_stock INTEGER NN DEFAULT 0 CHECK(0〜上限)`, `reorder_level INTEGER NN DEFAULT 0 CHECK(0〜上限)`, `note TEXT NULL`, `is_active INTEGER NN DEFAULT 1 CHECK(0/1)`, `created_at/updated_at TEXT NN`。`UNIQUE(sku COLLATE NOCASE)` |
| `stock_movements` | `id TEXT PK`, `product_id TEXT NN REFERENCES products(id) ON DELETE RESTRICT`, `movement_type TEXT NN CHECK(OPENING/RECEIPT/ISSUE/ADJUSTMENT)`, `quantity_delta INTEGER NN`, `stock_before/stock_after INTEGER NN CHECK(0〜上限)`, `reason_code TEXT NN`, `note TEXT NULL`, `actor_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL`, `actor_login_snapshot/actor_name_snapshot TEXT NN`, `created_at TEXT NN`。`CHECK(stock_after = stock_before + quantity_delta)` |
| `audit_logs` | `id TEXT PK`, `actor_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL`, `actor_login_snapshot/actor_name_snapshot/actor_role_snapshot TEXT NULL`, `action TEXT NN`, `entity_type/entity_id/details_json TEXT NULL`, `created_at TEXT NN` |
| `app_settings` | `key TEXT PK`, `value TEXT NN`, `updated_at TEXT NN`。店舗名と無操作ロック時間などを型付きサービス経由で保存 |
| `schema_migrations` | `version INTEGER PK`, `applied_at TEXT NN`。番号付き移行の適用記録。未来バージョンのDBは開かない |

`name_key` はカテゴリ名をtrimしてJavaScriptの `toLowerCase()` で正規化した値。Unicodeの大文字小文字をSQLiteのNOCASEだけに依存しないための補足であり、表示名を保持する。ログインIDもtrim+同じ小文字化を保存前・検索前に行う。Unicodeの完全なcase foldingやNFKC同一視までは提供しない。SKUはASCII限定かつtrim+小文字化したキーで比較する。

商品名の `name_search_key` もtrim+同じ小文字化で作り、名称変更と同時に更新する。表示はname、部分一致は検索キーに対して行う。日本語を含む文字列も保存前と検索時で同じ正規化を使う。

### 索引

- products: `name`, `category_id`, `is_active`。
- stock_movements: `(product_id, created_at DESC)`, `(created_at DESC)`, `(actor_user_id, created_at DESC)`。
- audit_logs: `(created_at DESC)`, `(entity_type, entity_id, created_at DESC)`, `(actor_user_id, created_at DESC)`。
- password_reset_codes: `user_id`、有効コードの部分一意索引。

## マイグレーションと復元

適用済みファイルは書き換えず、新しい番号を追加する。新規DBと旧版DBの両方をテストする。既存DBの移行前には一貫性のあるバックアップを取り、移行失敗時は通常起動せず原本を保持する。復元候補はコピー上で検証・必要な対応済み移行を済ませ、未来版・別アプリ・破損DBを拒否する。

初期マイグレーションはPhase 1でapp_meta/users/reset/audit/settingsを作り、Phase 2でcategories/products、Phase 3でstock_movementsを追加する。各段階の番号はPhase 0後に実装者が確定し、後続フェーズは既適用番号を変更しない。

## トランザクションと不変条件

商品・カテゴリ・ユーザーの変更と監査、初期セットアップ全体、コード失効/発行、再設定完了と失敗制御更新は、それぞれ同一トランザクションにする。最後の有効ADMIN保護とセットアップ再実行拒否は同じ書込みトランザクションで再確認する。

在庫サービスでは書込み権を確保してから現在庫を読み、更新・movement・auditを一括確定する。推奨はIMMEDIATEトランザクション。読取後の古い値を別トランザクションで上書きしない。失敗は全体をロールバックし、busy timeout超過は `DATABASE_BUSY` に変換する。

## 受け入れ条件

R-DB-01: 新規/既存DBの移行、再実行、未来版拒否、foreign keys、重複制約を一時DBで検証する。

R-DB-02: 監査挿入を故意に失敗させても業務更新が残らず、最後のADMIN保護とセットアップ一回制約が競合時にも維持される。

R-DB-03: 現在庫は在庫サービス以外から変更されず、再設定コードは平文でDBに残らない。
