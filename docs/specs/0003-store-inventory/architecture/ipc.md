# IPC・エラー契約

[設計索引](../README.md) / 対応: 原Plan §8、§5.1–5.3

## 契約 R-IPC

型は `src/shared/contracts/`、入力スキーマは `src/shared/validation/` に置く。Preloadは用途別関数のみ公開し、汎用 `send(channel, payload)`、SQL、任意ファイルパス、秘密トークンを公開しない。Mainは発信元→入力→セッション/状態→ロール→ユースケースの順で検証する。匿名APIも発信元検証と入力検証を省かない。

### APIグループ

| API | 入出力の要点 | 許可 |
| --- | --- | --- |
| `setup.isRequired` | 引数なし→boolean | 匿名可 |
| `setup.createInitialAdmin` | 店舗名、表示名、ログインID、パスワード→SessionView | 未セットアップ時のみ |
| `auth.login` | ログインID、パスワード→SessionView | 匿名可 |
| `auth.getSession` | 公開状態またはnull、秘密なし | 匿名可 |
| `auth.logout` | セッション/ロック文脈/再設定状態破棄 | 全状態。存在しなくても成功 |
| `auth.unlock` | 現在ロック本人のパスワード→SessionView | Mainのロック文脈に限定 |
| `auth.changeOwnPassword` | 現在・新パスワード→void、変更後失効 | 通常セッション本人 |
| `auth.beginPasswordReset` | ログインID、再設定コード→制限SessionView | 匿名可、専用制御 |
| `auth.completePasswordReset` | 新パスワード→void、変更後失効 | 再設定制限セッションのみ |
| `auth.reportActivity` | 引数なし、Mainの最終操作時刻更新 | 通常セッション、検証済み操作通知のみ |
| `products.list` | 検索・フィルタ・ソート・page/pageSize→Page | 両ロール |
| `products.create/update/deactivate` | 商品DTO。現在庫を受け取らない | ADMIN |
| `stock.record` | 種別、商品ID、数量または実数、理由、メモ→最新在庫・movement | 両ロール |
| `stock.list` | 商品、期間、種別、実行者、ページ→Page | 両ロール |
| `stock.getDashboard` | 集計・直近履歴→DashboardSummary | 両ロール |
| `stock.listActors` | 在庫記録に存在する操作者スナップショット候補→選択肢 | 両ロール |
| `users.list/create/update/deactivate` | UserSummaryのみ、ハッシュを返さない | ADMIN |
| `users.issuePasswordReset` | ユーザーID→一度だけ表示するコードと有効期限 | ADMIN |
| `categories.list` | 有効/全件の読取、ID・名称・状態 | 両ロール |
| `categories.create/update/deactivate` | 名称、ID、状態 | ADMIN |
| `data.exportProducts` | フィルタ条件のみ→保存結果 | 両ロール |
| `data.createBackup` | 引数なし→保存結果 | ADMIN |
| `data.restoreBackup` | ファイル選択・確認・実行の専用契約 | ADMIN |
| `settings.get/update` | 型付き設定、保存先の読取専用情報 | ADMIN |

原Planの「setup以外の保護APIは認証必須」は保護APIに適用し、ログイン・セッション確認・解除・コード検証は匿名/専用状態の例外として列挙する。Rendererが指定したuserIdやroleを実行者として信用しない。

### 公開DTOとページング

SessionViewは `user{id, loginName, displayName, role}`、`state(AUTHENTICATED/LOCKED/PASSWORD_RESET_REQUIRED)`、店舗名、公開期限を含め、token/hashを含めない。内部トークンの受渡しはMain↔Preloadだけの専用経路で完結させる。Pageは `items,total,page,pageSize`。初期pageSize=50、許可範囲1〜200とする。

ProductQueryはtrim済み検索、categoryId、低在庫/0在庫、状態（既定は有効）、許可ソートキーと方向、ページを持つ。StockMovementQueryはproductId、UTC期間の開始以上/終了未満、種別、actorUserId、ページを持つ。

RecordStockMovementInputはRECEIPT/ISSUEなら正の `quantity`、ADJUSTMENTなら非負の `countedStock` の判別共用体とし、両方同時指定や未知フィールドによる在庫上書きを拒否する。OPENINGを追加する場合は管理者専用導線として別途契約を定める。初期版は作成時在庫0のみ。

### 保守・ファイル操作

パスはMainのネイティブダイアログで選ぶ。復元は選択→候補検査→Main内の一時選択ID発行→UI確認→再認可→適用とし、RendererはIDと確認意図だけを返す。適用直前に候補内容を再検証し、差替えを防ぐ。キャンセルは正常な `cancelled` 結果とする。生の絶対パスを任意入力させない。

### 結果とエラー

公開結果は `ok:true,value` または `ok:false,error{code,message,fieldErrors?}` の判別共用体とする。スタック・SQL・秘密は渡さない。コード一覧:

`VALIDATION_ERROR`, `AUTH_REQUIRED`, `AUTH_FAILED`, `SESSION_EXPIRED`, `ACCOUNT_LOCKED`, `FORBIDDEN`, `DUPLICATE_LOGIN`, `DUPLICATE_SKU`, `DUPLICATE_CATEGORY`, `NOT_FOUND`, `INACTIVE_ENTITY`, `INSUFFICIENT_STOCK`, `LAST_ADMIN_REQUIRED`, `DATABASE_BUSY`, `DATABASE_ERROR`, `BACKUP_INVALID`, `BACKUP_FAILED`, `RESTORE_FAILED`。

`ACCOUNT_LOCKED` は既知の本人のロック文脈など存在を明かしてよい状態に限る。匿名ログインのクールダウンは未知IDを含めた共通の `AUTH_FAILED` と同じ待機表示にし、アカウント有無をコードで漏らさない。コード再設定の失敗も同じ扱いとする。

## 受け入れ条件

R-IPC-01: 許可されない発信元・未認証・異常DTO・権限不足を、業務サービス実行前に拒否する。

R-IPC-02: Rendererに生のトークン・ハッシュ・DBハンドル・汎用IPC・任意パス指定を公開しない。

R-IPC-03: 通常、ロック、再設定の状態ごとのAPI許可を統合テストし、キャンセルをエラー表示しない。
