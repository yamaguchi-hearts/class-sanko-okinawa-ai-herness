# 店舗向け商品在庫管理デスクトップアプリ 実装設計書

## 1. 文書の目的と実装担当への指示

この文書を、実装の基準となる要件・設計・作業分割として扱う。実装担当エージェントは、この文書を最初に読み、すでに存在するコードや規約との衝突を確認すること。仕様の不足を見つけた場合は、影響範囲を限定できる既定案を採用し、決定事項をこの文書かREADMEに記録してから進める。

ユーザーは、サンプルとして始められる一方、ビルド後にそのまま単一店舗で商品と在庫を管理できるアプリを想定している。したがって、ログイン・初期管理者セットアップ・権限・永続保存・バックアップ・配布ビルドも初期リリースの対象とする。

本アプリはローカルPCで使う単一店舗向けデスクトップアプリであり、クラウド同期・複数PC間同期を提供しない。Windowsのローカル管理者やDBファイルへ直接アクセスできる人に対する完全な改ざん耐性は保証しない。この制約はREADMEとアプリのバックアップ説明に明記する。

## 2. 目的、対象利用者、前提

- 対象OS: Windows 10/11 64-bit。
- 言語: TypeScript。UI: React。デスクトップ基盤: Electron。開発・バンドル: Vite。
- テスト: Vitest（ドメイン・DB・IPCサービス）、Playwright（Electron E2E）。
- 保存: SQLite。DBはアプリのユーザーデータ領域に保存する。
- 利用場所: 1店舗、1台のWindows PC、複数の担当者が交代で同じ端末を使う想定。
- ネット接続なしでも、初期セットアップ後の通常業務（ログイン、商品・在庫管理、履歴、バックアップ）は利用できる。
- 店舗間・端末間同期、POS連携、発注、仕入先、販売価格・粗利、バーコード機器連携、クラウドアカウントは対象外。
- データはアプリ終了後も保持する。アプリ更新時もユーザーデータを維持する。
- UIは日本語を基本とし、日時はローカル表示、DB保存はUTCとする。

### 2.1 利用者ロール

- **管理者 (ADMIN)**: 初期セットアップ、全機能、ユーザー管理、バックアップ/復元、設定を利用できる。
- **担当者 (STAFF)**: 商品の参照、入庫・出庫・棚卸調整、履歴参照、CSV出力を利用できる。ユーザー管理、バックアップ復元、アプリ設定は利用できない。

すべてのアカウントは個人別とし、共有アカウントを前提にしない。操作履歴に実行者を残す。

## 3. 初期リリースの機能範囲

### 3.1 初回起動と認証

- DBに管理者が存在しない初回起動では、ログイン画面ではなく初期セットアップウィザードを表示する。
- ウィザードで店舗名、管理者表示名、ログインID、パスワードを登録する。ログインIDは前後空白を除去し、大文字小文字を区別しない一意値とする。
- 初期管理者を作成したら、その管理者でセッションを開始してダッシュボードへ移る。次回起動時はログインを要求する。既定ユーザー名、既定パスワード、開発用バックドアは作らない。
- 通常起動後は認証を必須とする。アプリ再起動後にセッションを復元しない。
- ログインIDとパスワードでログインする。パスワードはArgon2idなど、メンテナンスされている専用パスワードハッシュライブラリでソルト付きハッシュ化する。平文・復号可能暗号・独自ハッシュを保存しない。
- パスワードの最小長は12文字。最大長は安全な実装上限（例: 128文字）を設ける。可能なら空白やパスフレーズを許可し、不要な複雑性ルールは課さない。
- 連続したログイン失敗を抑制する。アカウント単位で5回連続失敗したら30秒停止し、その後も失敗するごとに待ち時間を段階的に延長して最大5分とする。正しいログインで失敗回数をリセットする。一般的なエラー表示でアカウント存在有無を漏らさない。
- STAFF/ADMINとも自分のパスワードを変更できる。変更には現在のパスワードを要求する。
- ADMINはユーザーを追加・無効化し、ロールを変更し、必要時にパスワード再設定を要求できる。管理者が本人のパスワードを知らずに新パスワードを指定する方式ではなく、次回ログイン時に本人が変更する一時状態を用いる。
- 最後に残る有効なADMINは無効化・STAFFへの降格できない。
- 非アクティブ状態が15分続いたら画面をロックし、再認証を要求する。アクティビティは認証済みのユーザー操作で更新する。長時間処理やモーダル表示を誤って操作と判定しない。
- ログアウト操作を常に利用可能にする。

**セキュリティ境界:** 認証状態・ロール・パスワード処理はMainプロセスに置く。Rendererに渡された表示状態だけを信頼しない。保護対象IPCではMainが呼出元ウィンドウと短命セッショントークンを照合し、セッション有効性と必要ロールを毎回確認する。パスワード、ハッシュ、トークンをログへ出さない。

### 3.2 ダッシュボードと在庫一覧

- 認証後はダッシュボードまたは在庫一覧を表示する。
- ダッシュボードに、登録商品数、有効商品数、低在庫商品数、在庫0商品数、直近の在庫変更を表示する。
- 在庫一覧に商品名、SKU、カテゴリ、現在庫、最低在庫数、単位、状態を表示する。
- SKU・商品名で部分一致検索する。前後空白を除き、大文字小文字を区別しない。
- カテゴリ、低在庫のみ、在庫0のみで絞り込める。
- 一覧は並べ替えとページング、または同等に応答性を保てる一覧方式を提供する。初期並び順は商品名昇順、同名時SKU昇順。
- 低在庫は`current_stock <= reorder_level`かつ`reorder_level > 0`と定義する。この判定を一覧・ダッシュボード・テストで共通化する。
- 0在庫は独立した状態として表示する。
- 空状態、検索結果なし、ロード中、エラー、再試行を区別する。

### 3.3 商品・カテゴリ管理

- 商品を登録・編集・無効化・再有効化できる。
- 商品項目: SKU、商品名、カテゴリ、単位、最低在庫数、任意メモ。
- SKUと商品名は必須。SKUは前後空白除去後に一意。商品名は前後空白を除去し、空文字不可。
- SKUはASCII英数字と`-`、`_`を基本許容（最大64文字）とする。これにより大文字小文字を区別しない一意性の挙動を安定させる。既存運用で全角SKU等が必須と判明した場合は別途明示的に仕様変更する。
- カテゴリは管理者が作成・名称変更・無効化できる。使用中カテゴリは物理削除せず無効化する。無効カテゴリの商品は表示・編集できるが、新規商品には選択できない。
- 単位は自由入力文字列（必須、最大16文字）とする。初回セットアップで「個」を初期値として提示する。異なる単位間の換算は行わない。
- 商品削除は論理削除（`is_active = 0`）。在庫操作はできなくなるが、履歴や監査記録は保持する。
- 既存SKUを変更する場合は重複チェックを再度実行する。

### 3.4 在庫入出庫と棚卸調整

- 入庫、出庫、棚卸調整を記録する。
- すべて整数数量。小数を扱う商品単位は初期版では対象外。
- 入庫・出庫の数量は1以上。出庫で在庫が負になる操作は拒否する。
- 棚卸調整は実数えした在庫数を入力し、差分を履歴に記録する。調整後の在庫は0以上。
- 入庫・出庫・調整には理由コードと任意メモを記録する。理由例: 入荷、返品、破損、期限切れ、棚卸差異、その他。
- 在庫変更と履歴・監査ログは同一トランザクションで保存する。
- 在庫変更を後から編集・削除しない。誤りは逆方向の入出庫または新しい棚卸調整で訂正する。
- 初期在庫は商品作成時に0とする。初期在庫を設定する導線を設ける場合はOPENING履歴として記録する。
- 商品の現在庫を任意の画面/APIから直接更新してはならない。在庫変更サービスのみを更新経路とする。

### 3.5 履歴・監査

- 商品別・期間別・種別・実行者で在庫履歴を絞り込める。
- 履歴に日時、商品、SKU、操作種別、数量または差分、変更前後在庫、理由、メモ、操作者を表示する。
- 監査ログはログイン成功/失敗（認証情報は除外）、ログアウト、ユーザー作成・無効化・ロール変更・パスワード再設定要求、商品変更、カテゴリ変更、在庫変更、バックアップ・復元を記録する。
- 監査ログは通常UIから編集・削除できない。ユーザー無効化後も履歴上の操作者表示を保持する（IDと表示名のスナップショットを記録）。
- ログにパスワード、ハッシュ、セッショントークン、DB接続情報を含めない。

### 3.6 CSV入出力

- 商品一覧をCSVにエクスポートできる。UTF-8 BOMを付け、Excelで開きやすくする。
- 商品CSVのインポートは初期リリースの必須機能にしない。必要なら別フェーズとする。CSV出力は監査ログに記録する。
- ファイル保存先はユーザーが選ぶ。Mainプロセスでファイルダイアログを開き、パスをRendererから任意指定させない。
- 数式インジェクション対策として、`=`, `+`, `-`, `@`等で始まるセル値を安全化する。CSVのカンマ・改行・引用符を正しくエスケープする。

### 3.7 バックアップと復元

- ADMINはアプリ内から手動バックアップを作成できる。
- 復元はADMINのみ可能。復元前に強い確認画面で現在データが置き換わることを明示し、自動的に現DBのバックアップを作成する。
- SQLiteファイルを使用中に単純コピーしない。SQLite backup APIまたは接続を適切に閉じた一貫性のある方法を使う。
- 復元ファイルは形式・スキーマバージョン・整合性を検査する。不正ファイルは適用しない。
- 復元後にアプリ再起動を要求する。復元直前に現DBを別ファイルへ退避し、復元成功後に復元後DBへ`BACKUP_RESTORED`監査イベントを記録する。失敗時は退避DBを戻し、アプリを通常状態で再開する。
- 自動クラウドバックアップは行わない。READMEに手動バックアップを定期的に別媒体へ保管する運用を記載する。

## 4. 画面仕様

### 4.1 初期セットアップ

- アプリ名・店舗用途の説明を表示。
- 店舗名、管理者表示名、ログインID、パスワード、確認用パスワードを入力。
- セットアップの実行中は二重送信を防止。
- セットアップ完了後は作成した管理者でセッションを開始し、ダッシュボードへ進む。
- すでに管理者が存在するときセットアップAPIは必ず拒否する。

### 4.2 ログイン/ロック

- ログインID、パスワード、送信、エラー、ロック解除待ちの表示。
- ログインエラーは「ログインIDまたはパスワードを確認してください」のように統一する。
- 15分無操作でロック画面に遷移し、現在ユーザーのパスワードで解除する。ログアウトとは区別する。
- アプリ終了時は必ずセッションを破棄する。

### 4.3 共通レイアウト

- ヘッダーまたはサイドバーに店舗名、画面名、ログイン中の表示名/ロールを表示。
- ADMINのみユーザー管理、カテゴリ管理、設定、バックアップ/復元への導線を表示。
- すべての画面でログアウトが可能。
- 権限がない画面への直接遷移やIPC呼び出しもMain側で拒否する。

### 4.4 主要画面

- ダッシュボード
- 在庫一覧（検索・フィルタ・ページング）
- 商品作成/編集
- 在庫変更（入庫・出庫・棚卸調整）
- 商品別/全体在庫履歴
- ユーザー管理（ADMIN）
- カテゴリ管理（ADMIN）
- 設定（店舗名、無操作ロック時間など。初期値15分）
- バックアップ/復元（ADMIN）

フォームには保存中、成功、入力エラー、サーバーエラーの状態を示す。破壊的または取り消せない操作には確認を挟む。

## 5. 技術構成・セキュリティ設計

### 5.1 プロセス境界

- **Renderer (React)**: 描画と入力。Node.js、SQL、ファイルシステム、パスワードハッシュへ直接アクセスしない。
- **Preload**: `contextBridge`で許可された型付き関数だけ公開。汎用`send(channel, payload)`は公開しない。
- **Main**: 認証、セッション、権限判定、IPC入力検証、DBサービス、ファイルダイアログ、アプリライフサイクルを担当。
- **DB/Domain**: SQLite接続、マイグレーション、Repository、ユースケースサービス、在庫不変条件を担当。
- IPCの発信元`webContents`と期待するアプリURL/ウィンドウを検証し、外部コンテンツ由来のIPCを拒否する。

### 5.2 Electron設定

- `contextIsolation: true`、`nodeIntegration: false`、sandbox可能な構成を使う。
- Rendererへ秘密情報、DBハンドル、Node APIを露出しない。
- 外部URLのナビゲーションと新規ウィンドウは既定拒否。
- CSPを設定し、本番で`unsafe-eval`等の不要な緩和をしない。
- 開発用DevToolsは開発ビルドに限定する。
- 認証済みでも各保護IPCでセッションを検証する。ADMIN専用操作はロールをMain側で再検証する。
- 画面に表示したロールを権限根拠にしない。

### 5.3 セッション

- セッションはMainメモリ上に保持し、再起動をまたいで永続化しない。
- ログイン成功時に暗号学的乱数でセッショントークンを発行する。Preloadは当該トークンを各保護API呼び出しに付ける。RendererのlocalStorage/sessionStorageには保存しない。
- トークンはMain内のセッション表でユーザーID・ロール・発行時刻・最終操作時刻に結びつける。ログアウト、無効化、パスワード変更、ロック時に破棄する。
- Electronの単一ウィンドウ・単一プロセスを前提にし、再接続やウィンドウ再生成時はセッションを再確認する。
- 無操作ロックはMain側の時刻を基準にし、Rendererのタイマーだけに依存しない。

### 5.4 認証とパスワード

- パスワードハッシュはArgon2idを使用し、ライブラリ既定の安全なパラメータを確認・記録する。
- ハッシュ値以外にソルト等を正しく保存する（通常はライブラリのエンコード形式を利用）。秘密鍵や固定ソルトをソースコードへ埋め込まない。
- ログイン失敗はユーザー列挙できない共通応答にする。
- 失敗回数と`locked_until`はDBに保存し、再起動後もクールダウンを維持する。平文パスワードは記録しない。
- 管理者によるパスワード再設定は`must_change_password`を設定し、対象ユーザーが次回ログイン後に変更するまで業務画面を許可しない。
- DBファイルの暗号化はMVPの必須要件ではない。パスワードハッシュを使ってもDB内の商品・在庫は暗号化されないことを説明する。

### 5.5 SQLiteライブラリ・配布

- SQLiteには`better-sqlite3`を使用する。ネイティブ依存がElectron ABIと一致するよう再ビルドを行い、Windowsパッケージ内の読み書きをPhase 0で検証する。
- Vite統合にはelectron-vite、Windowsパッケージにはelectron-builderを使用する。配布物はx64向けNSISインストーラーを標準とし、ユーザーデータを保持する更新インストールを確認する。
- パスワードにはArgon2idを使用する。ライブラリの推奨パラメーターを確認し、アプリ起動が遅くなりすぎない範囲で設定を記録する。
- バージョンはセットアップ時点で互換性を検証して固定し、lockfileをコミットする。
- DBは`app.getPath('userData')`配下に置く。アプリ更新で削除・上書きしない。
- パッケージ版の初回起動、更新後のマイグレーション、バックアップ復元を確認する。

## 6. データモデル

IDはUUID等の衝突しにくいテキストIDを用いる。日時はUTC ISO 8601。外部キー制約を有効にする。各マイグレーションを番号管理し、既適用分を書き換えない。

### 6.1 `app_meta`

- `key TEXT PRIMARY KEY`
- `value TEXT NOT NULL`
- 用途: 初期セットアップ完了、DBアプリスキーマバージョン補助、インストールID等。認証秘密を置かない。

### 6.2 `users`

- `id TEXT PRIMARY KEY`
- `login_name TEXT NOT NULL`（正規化済み）
- `display_name TEXT NOT NULL`
- `password_hash TEXT NOT NULL`
- `role TEXT NOT NULL CHECK role IN ('ADMIN','STAFF')`
- `is_active INTEGER NOT NULL DEFAULT 1 CHECK IN (0,1)`
- `must_change_password INTEGER NOT NULL DEFAULT 0 CHECK IN (0,1)`
- `failed_login_count INTEGER NOT NULL DEFAULT 0`
- `locked_until TEXT NULL`
- `created_at TEXT NOT NULL`, `updated_at TEXT NOT NULL`, `last_login_at TEXT NULL`
- `UNIQUE(login_name COLLATE NOCASE)`

ユーザー削除は論理無効化。最後の有効管理者を失う変更をトランザクション内で拒否する。

### 6.3 `categories`

- `id TEXT PRIMARY KEY`
- `name TEXT NOT NULL UNIQUE COLLATE NOCASE`
- `is_active INTEGER NOT NULL DEFAULT 1 CHECK IN (0,1)`
- `created_at TEXT NOT NULL`, `updated_at TEXT NOT NULL`

### 6.4 `products`

- `id TEXT PRIMARY KEY`
- `sku TEXT NOT NULL`
- `name TEXT NOT NULL`
- `category_id TEXT NULL REFERENCES categories(id) ON DELETE RESTRICT`
- `unit TEXT NOT NULL`
- `current_stock INTEGER NOT NULL DEFAULT 0 CHECK(current_stock >= 0)`
- `reorder_level INTEGER NOT NULL DEFAULT 0 CHECK(reorder_level >= 0)`
- `note TEXT NULL`
- `is_active INTEGER NOT NULL DEFAULT 1 CHECK IN (0,1)`
- `created_at TEXT NOT NULL`, `updated_at TEXT NOT NULL`
- SKUは正規化後の一意インデックスを持つ。無効商品もSKUを予約したままにし、再利用で過去履歴との混同を防ぐ。

SKU正規化はASCII制限の範囲でtrim + uppercaseとする。DBにも一意制約を置く。

### 6.5 `stock_movements`

- `id TEXT PRIMARY KEY`
- `product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT`
- `movement_type TEXT NOT NULL CHECK IN ('OPENING','RECEIPT','ISSUE','ADJUSTMENT')`
- `quantity_delta INTEGER NOT NULL`（在庫増は正、減は負、棚卸調整では差分）
- `stock_before INTEGER NOT NULL CHECK >= 0`
- `stock_after INTEGER NOT NULL CHECK >= 0`
- `reason_code TEXT NOT NULL`
- `note TEXT NULL`
- `actor_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL`
- `actor_login_snapshot TEXT NOT NULL`, `actor_name_snapshot TEXT NOT NULL`
- `created_at TEXT NOT NULL`
- `CHECK(stock_after = stock_before + quantity_delta)`
- index: `(product_id, created_at DESC)`、`(created_at DESC)`、`(actor_user_id, created_at DESC)`

操作種別と差分の整合性（RECEIPTは正、ISSUEは負、ADJUSTMENTは正負どちらも可）をドメインサービスで検証する。出庫後在庫0未満を拒否。

### 6.6 `audit_logs`

- `id TEXT PRIMARY KEY`
- `actor_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL`
- `actor_login_snapshot TEXT NULL`, `actor_name_snapshot TEXT NULL`, `actor_role_snapshot TEXT NULL`
- `action TEXT NOT NULL`
- `entity_type TEXT NULL`, `entity_id TEXT NULL`
- `details_json TEXT NULL`（許可した非機密項目のみ）
- `created_at TEXT NOT NULL`
- index: `(created_at DESC)`, `(entity_type, entity_id, created_at DESC)`, `(actor_user_id, created_at DESC)`

監査ログのpayloadを自由なオブジェクトのまま保存しない。イベントごとに許可項目を構築し、パスワード・hash・token等を除外する。

### 6.7 `app_settings`

- `key TEXT PRIMARY KEY`
- `value TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- 店舗名、無操作ロック時間、日付表示等を保存。ユーザー入力値は型・範囲検証して読み書きする。

## 7. ドメイン不変条件・トランザクション

### 7.1 在庫変更

在庫ユースケースを一つのサービスに集約する。

1. Mainで呼出ウィンドウ、セッション、ロールを確認。
2. 入力DTOをスキーマ検証。対象商品が有効か確認。
3. DBトランザクション開始。
4. 現在庫を読み、deltaを計算。ISSUE/ADJUSTMENT後に負数となる場合は拒否。
5. `products.current_stock`と`updated_at`を更新。
6. stock movementを追加し、操作者スナップショットを保存。
7. 同一トランザクションで監査ログを追加。
8. コミットし、最新在庫と履歴情報を返す。

途中で失敗したら全てロールバックする。連続操作による古い在庫の上書きを避けるため、SQLite transaction内で読取・更新を行う。SQLite busy timeoutを設定し、DBロックは利用者向けエラーに変換する。

### 7.2 商品・ユーザー・カテゴリ

- 商品作成・編集と監査記録を同一トランザクションで行う。
- 商品情報変更は在庫数変更と分離する。商品編集フォームで現在庫を直接変更させない。
- ユーザー追加・無効化・ロール変更・must-change設定と監査記録を同一トランザクションで行う。
- 初期管理者の作成は「管理者0人の場合だけ」の条件付きトランザクションとし、競合時に2人作られないようにする。

## 8. IPC/API契約

共有型を`src/shared/contracts`に置く。APIは用途別で、汎用IPCを公開しない。全引数をMainで再検証する。

```ts
interface DesktopApi {
  setup: { isRequired(): Promise<boolean>; createInitialAdmin(input: SetupInput): Promise<SessionView> };
  auth: {
    login(input: LoginInput): Promise<SessionView>;
    logout(): Promise<void>;
    getSession(): Promise<SessionView | null>;
    unlock(input: { password: string }): Promise<SessionView>;
    changeOwnPassword(input: ChangePasswordInput): Promise<void>;
  };
  products: {
    list(input: ProductQuery): Promise<Page<ProductSummary>>;
    create(input: CreateProductInput): Promise<Product>;
    update(input: UpdateProductInput): Promise<Product>;
    deactivate(input: { productId: string }): Promise<void>;
  };
  stock: {
    record(input: RecordStockMovementInput): Promise<StockMovementResult>;
    list(input: StockMovementQuery): Promise<Page<StockMovement>>;
    getDashboard(): Promise<DashboardSummary>;
  };
  users: { list(): Promise<UserSummary[]>; create(input: CreateUserInput): Promise<UserSummary>; update(input: UpdateUserInput): Promise<UserSummary>; deactivate(input: { userId: string }): Promise<void>; };
  categories: { list(): Promise<Category[]>; create(input: CreateCategoryInput): Promise<Category>; update(input: UpdateCategoryInput): Promise<Category>; deactivate(input: { categoryId: string }): Promise<void>; };
  data: { exportProducts(): Promise<ExportResult>; createBackup(): Promise<BackupResult>; restoreBackup(): Promise<void>; };
  settings: { get(): Promise<AppSettings>; update(input: UpdateSettingsInput): Promise<AppSettings>; };
}
```

これは機能グループの契約例であり、型は実装に合わせて精緻化する。`setup`以外の保護APIに未認証アクセスを許さない。`users`, `data.restoreBackup`, `settings.update`等はADMIN限定。STAFFには読み取り/在庫更新で必要最小限を許可する。

### 8.1 エラー型

IPCは予測可能なエラーを次のような識別子に変換する:

- `VALIDATION_ERROR`
- `AUTH_REQUIRED`, `AUTH_FAILED`, `SESSION_EXPIRED`, `ACCOUNT_LOCKED`
- `FORBIDDEN`
- `DUPLICATE_LOGIN`, `DUPLICATE_SKU`, `DUPLICATE_CATEGORY`
- `NOT_FOUND`, `INACTIVE_ENTITY`
- `INSUFFICIENT_STOCK`
- `LAST_ADMIN_REQUIRED`
- `DATABASE_BUSY`, `DATABASE_ERROR`
- `BACKUP_INVALID`, `BACKUP_FAILED`, `RESTORE_FAILED`

UI表示文は日本語で、技術詳細やSQL文を表示しない。開発ログにも秘密値を含めない。

## 9. 推奨リポジトリ構成

```text
.
├─ doc/plan.md
├─ src/
│  ├─ main/
│  │  ├─ index.ts
│  │  ├─ windows/
│  │  ├─ ipc/
│  │  ├─ auth/
│  │  ├─ services/
│  │  └─ db/
│  │     ├─ connection.ts
│  │     ├─ migrations/
│  │     └─ repositories/
│  ├─ preload/index.ts
│  ├─ renderer/
│  │  ├─ app/
│  │  ├─ components/
│  │  ├─ features/
│  │  │  ├─ setup/
│  │  │  ├─ auth/
│  │  │  ├─ dashboard/
│  │  │  ├─ products/
│  │  │  ├─ stock/
│  │  │  ├─ movements/
│  │  │  ├─ users/
│  │  │  ├─ categories/
│  │  │  └─ settings/
│  │  └─ styles/
│  └─ shared/
│     ├─ contracts/
│     ├─ domain/
│     └─ validation/
├─ tests/
│  ├─ unit/
│  ├─ integration/
│  └─ e2e/
├─ package.json
├─ README.md
└─ vite/electron/tsconfig configs
```

設定ファイル名は選択したVite/Electron統合方式に合わせる。Main、Preload、Renderer、共有コードとテストの責務は保つ。

## 10. フェーズ別の実装計画と成果物

各フェーズは、コード・文書・確認結果を揃えてから次へ進む。エージェントに分担させる場合、Phase 0で契約とフォルダ構成を確定してから割り当て、同じ共有型やマイグレーションを複数担当が同時編集しない。

### Phase 0 — 技術検証とアプリ骨格

1. Node/npm、対象Windows、既存repo規約を確認。
2. Electron + Vite + React + TypeScriptの最小起動を構築。
3. Main/Preload/Rendererのビルド分離、context isolation、nodeIntegration無効を確認。
4. `better-sqlite3`とArgon2idライブラリをElectron環境でビルドできるか確認。
5. Windows向けパッケージ生成、DB書込、再起動後の読込を最小プロトタイプで確認。
6. 選定した依存・スクリプト・制約をREADMEに記録。

**成果物:** 起動する空アプリ、固定された依存とlockfile、開発/ビルド手順。
**完了条件:** 開発モードとパッケージ版の両方で起動し、SQLiteファイルをuserDataに作成・再読込できる。

### Phase 1 — DB・契約・認証基盤

1. DB接続、foreign keys、busy timeout、番号付きマイグレーション。
2. app_meta、users、監査ログの初期スキーマ。
3. 初期セットアップと初期管理者作成。
4. パスワードhash、ログイン失敗制御、ログイン/ログアウト、セッション、15分ロック。
5. Preload限定APIとIPCの発信元/認証/ロール検証。
6. ログイン、ロック、パスワード変更、ユーザー管理の画面。

**成果物:** 初回セットアップから管理者ログイン・ログアウト・ロック解除までの縦断フロー。
**完了条件:** DBに管理者がなければセットアップ必須、登録後は再起動してもログイン必須。未認証/権限不足のIPCがMainで拒否される。

### Phase 2 — 商品・カテゴリ・ユーザー管理

1. products/categoriesスキーマとRepository。
2. 商品一覧、検索、ページング/ソート、作成・編集・無効化。
3. カテゴリ管理。
4. ADMINによるユーザー作成・ロール変更・無効化・次回パスワード変更要求。
5. 最後の管理者保護。
6. 各変更の監査ログ。

**完了条件:** STAFFはユーザー管理等をUIでもIPCでも利用できず、ADMINは管理できる。無効化済み商品・ユーザーの過去記録は残る。

### Phase 3 — 在庫変更・ダッシュボード・履歴

1. 入庫、出庫、棚卸調整のドメインサービスとトランザクション。
2. 在庫変更UIと理由コード/メモ。
3. 低在庫・在庫0判定、ダッシュボード。
4. 履歴一覧・商品/期間/種別/操作者フィルター。
5. 在庫変更と監査ログの整合性確認。

**完了条件:** 在庫更新の唯一の経路がサービスに集約され、変更前後・操作者・理由が残り、失敗時は全更新がロールバックする。

### Phase 4 — CSV、設定、バックアップ/復元

1. 商品CSV出力、式インジェクション対策。
2. 店舗名・ロック時間等の設定。
3. 一貫性のあるDBバックアップ。
4. ADMINのみの検証付き復元、事前バックアップ、自動再起動/再ログイン。
5. 操作履歴と利用者向け手順。

**完了条件:** 選択したバックアップを検証して復元できる。失敗時に現DBを破損させず、復元前データへ戻れる。

### Phase 5 — E2E、配布品質、運用文書

1. Playwrightでアプリ起動と主要業務フローを自動化。
2. Vitest単体・DB統合テスト。
3. Windowsインストーラー/ポータブル等の配布形式を決定してビルド。
4. クリーンなWindows環境相当で初回セットアップ、ログイン、商品・在庫操作、再起動、バックアップ復元を確認。
5. READMEに機能、初回利用、ユーザー管理、データ場所、バックアップ、復元、制約、開発/テスト/ビルドを記載。

**完了条件:** 受け入れ条件を満たし、別の担当者がREADMEだけで起動・テスト・Windowsビルドを再現できる。

## 11. テスト計画と受け入れシナリオ

### 11.1 Vitest 単体

- login_name/SKU正規化、必須項目、文字長、整数数量。
- パスワードポリシーとパスワード変更状態。
- ロールごとの認可マトリクス。
- 在庫delta計算、棚卸調整、低在庫境界、無効商品。
- CSVエスケープと危険な先頭文字。
- エラー型変換。

### 11.2 Vitest DB統合

- 一時DBの初期化と複数回マイグレーション。
- 初期管理者が一度だけ作成される。
- login_name/SKU/categoryの重複が制約される。
- パスワードが平文で保存されず、正しい/誤った入力の検証ができる。
- 最後の管理者降格/無効化を拒否。
- 入庫、出庫、棚卸調整と在庫履歴・監査ログが一致。
- 負在庫・失敗時に在庫、movement、auditが部分更新されない。
- 無効商品/ユーザーと過去履歴の保持。
- バックアップから復元したDBの整合性。

テストDBは一時領域に作り、実ユーザーのuserDataを絶対に利用・削除しない。

### 11.3 Playwright Electron E2E

- 初回起動でセットアップが必須になり、管理者作成後にログインできる。
- 再起動後にセッションが残らず、ログイン画面になる。
- 誤パスワード、クールダウン、無操作ロック、再認証を確認。
- ADMINがSTAFFを作成し、STAFFでユーザー管理画面/APIが拒否される。
- 商品作成、重複SKU拒否、編集、無効化。
- 入庫、出庫、負在庫拒否、棚卸調整、履歴の操作者表示。
- 低在庫、0在庫、検索、フィルター、ページング。
- CSV出力を専用一時ディレクトリで検証。
- 専用userDataを使いバックアップ・復元・再起動後のデータを検証。

PlaywrightのElectron起動方法は導入バージョンの公式サポートを確認し、手動で起動した開発者PCのアプリや通常userDataをテスト対象にしない。

### 11.4 最終受け入れチェックリスト

- [ ] Windows 10/11 64-bitで開発起動とパッケージ起動ができる。
- [ ] 初回セットアップで管理者を作成でき、既定認証情報がない。
- [ ] パスワードは安全な専用KDFで保存され、ログ等に秘密が出ない。
- [ ] 再起動後は再ログインが必要。無操作ロックとログアウトが機能する。
- [ ] ADMIN/STAFFの権限が画面とMain IPCの双方で適用される。
- [ ] 最後のADMINを失う操作が拒否される。
- [ ] 商品・カテゴリ・ユーザーの作成/編集/無効化、商品の再有効化ができ、過去履歴が保たれる。
- [ ] 入庫・出庫・棚卸調整ができ、負在庫が発生しない。
- [ ] 変更履歴に商品・数量・変更前後・理由・操作者・日時が残る。
- [ ] 低在庫、0在庫、検索、フィルターが仕様どおり。
- [ ] CSV出力がExcelで扱え、数式インジェクションを防ぐ。
- [ ] ADMINがバックアップを作成・検証付き復元できる。
- [ ] DBはuserDataに保存され、アプリ更新・再起動後も維持される。
- [ ] READMEに初回利用からバックアップ/復元、開発/テスト/配布手順まで記載される。

## 12. 運用・データ保護

- DB保存場所を設定画面とREADMEに示す。
- アプリ更新前のバックアップを推奨し、バックアップを同じPCだけに置く場合の故障リスクを説明する。
- パスワードを忘れた場合、ADMINが他ユーザーに次回変更要求を設定できる。全ADMINがログイン不能な場合は、アプリ内に秘密の回避口を作らず、READMEのオフライン復旧手順（バックアップ復元または明示的な管理者復旧ツール）を定める。
- DBを手動編集する運用を推奨しない。DB直接改変は監査ログを迂回する。
- ログには機密情報を出さない。通常ログはローテーションまたはサイズ制限を設ける。
- DB暗号化は初期リリースの必須ではない。Windowsユーザーアカウントとディスク暗号化を利用者側で保護すること、DBをコピーできるローカル管理者には内容が見えることを明記する。

## 13. MVP後に回す機能

- 店舗・端末間同期、クラウド運用、Web管理画面。
- POS/レジ、販売実績連携、売上・利益。
- 仕入先、発注書、入荷予定、発注点提案。
- バーコードスキャナ専用連携、ラベル印刷。
- ロット、期限、シリアル、複数単位換算。
- CSV一括インポート、帳票、ロールの細分化。
- 自動バックアップ、ネットワーク保存先への自動転送。
- 多言語、テーマ切替。

## 14. 実装開始時の最初の作業

実装は次の順で開始する。

1. この文書とリポジトリ内のAGENTS.md/既存規約を確認。
2. Windows/Node環境とVite/Electron方式を選定。
3. SQLiteネイティブ依存とパスワードKDFの最小検証。
4. `contextIsolation`を有効にした空アプリを起動。
5. SQLite userData保存・マイグレーションとWindowsパッケージを確認。
6. IPC契約・認証境界・初期マイグレーションを確定してPhase 1へ進む。
