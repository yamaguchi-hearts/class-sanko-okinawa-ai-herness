# 検証・受け入れ条件

[設計索引](../README.md) / 対応: 原Plan §11

## 検証方針

Vitestでドメイン/DB/IPC、PlaywrightでElectron E2Eを行う。採用バージョンにおけるElectron起動方法を公式資料で確認する。テストDB、userData、出力先は毎回隔離した一時領域とし、実ユーザーの通常userData・手動起動アプリを使用/削除しない。

時計、乱数、ファイル選択は差し替え可能な境界とし、長時間待機や通常運用向けバックドアを入れずに期限・キャンセル・失敗を再現する。Phase 0のnpm scriptsと検証結果は以下に記録する。

## Phase 0 実行結果（2026-10-20）

対象はWindows x64、OS build 10.0.26200、Host Node.js 24.19.0/npm 11.17.0。Windowsネイティブモジュール用のPython 3.12とVisual Studio 2022 x64開発環境を設定して検証した。

| コマンド/確認 | 結果 |
| --- | --- |
| `npm ci` | 成功。x64 Native Tools Command Promptから実施。`postinstall`でElectron 44.9.0向けにネイティブ依存を再ビルド |
| `npm run typecheck` | 成功 |
| `npm test` | 成功。SQLite close/reopenとArgon2id正誤照合の最小テスト1件 |
| `npm run build` | 成功。Main/Preload/Rendererを別出力 |
| `npm run test:e2e` | 成功。隔離userDataで起動、見出し表示とRendererの`process`/`require`非公開を確認 |
| `npm run verify:desktop` | 開発版でSQLite作成後の再起動読込とArgon2id照合に成功 |
| `npm run dist:win` | 成功。Electron ABI再ビルド後、x64 NSIS installerとasar化された`win-unpacked` appを生成 |
| `npm run test:packaged` | 成功。NSISを一時ディレクトリへサイレント導入し、導入アプリを隔離userDataで2回起動。SQLite初回書込み→再起動読込・Argon2id照合後、アプリをアンインストール |
| `npm audit --omit=dev` | 本番依存0件の脆弱性 |

Argon2idのWindows実測はハッシュ21ms、照合18msの記録と、後続の隔離検証でハッシュ/照合各33〜34ms。単回計測であり正式な性能試験ではない。Playwrightは専用userDataと一時領域を使い、実ユーザーの保存データを操作しない。開発依存全体のnpm auditにはmoderate 8件が報告されたため、Phase 5の依存更新時に再確認する。

NSIS installerの一時領域への実インストール・起動・検証・アンインストールまで確認した。Windows 10、更新インストール、署名証明書、Excel、復旧ツールは後続フェーズの検証対象。

## Phase 1 実行結果（2026-10-20）

Phase 0で固定したWindows x64環境（OS build 10.0.26200、Node.js 24.19.0/npm 11.17.0、Electron 44.9.0）で認証・DB基盤を追加検証した。依存追加はなく、既存lockfileを維持している。テストDB/userData/NSISインストール先は一時ディレクトリを使った。

| コマンド/確認 | 結果 |
| --- | --- |
| `npm run typecheck` | 成功 |
| `npm test` | 成功。9件。新規/既適用/未来版移行、FKとbusy timeout、セットアップ競合・一回制約、再起動時の再認証、最終ADMIN保護、失敗待機30秒→60秒、無操作ロック、旧トークン拒否、コード再発行/期限/一度限り/制限セッション/パスワード更新、監査秘密除外を確認 |
| `npm run test:e2e` | 成功。2件。Electron開発版で初回セットアップ→終了/再起動→ADMINログイン→STAFF作成→コードで本人設定→STAFFログイン、匿名/STAFFの管理API拒否、RendererのNode/require非公開を確認 |
| `npm run build` | 成功。Main/Preload/Rendererを分離ビルド |
| `npm run dist:win` | 成功。Windows x64 NSISを生成し、Argon2id/better-sqlite3をElectron 44.9.0 ABI向けに再ビルド |
| `npm run test:packaged` | 成功。NSISを一時領域へ導入し、導入アプリで初回ADMIN作成・終了・再起動・Argon2idログインを実行。Phase 0隔離DBの再読込/KDF照合も成功後アンインストール |

Argon2idはD-27のargon2 0.45.1、m=65,536 KiB、t=3、p=4、出力32 byteを使用し、Phase 0のWindows実測値を維持する。Phase 1でも開発版E2Eとインストール版E2Eで実際にハッシュ生成・照合した。Windows 10別実機、NSIS更新インストール、コード署名、UIアクセシビリティは未検証。業務商品/カテゴリ/在庫APIは後続フェーズの対象。

## Phase 2 実行結果（2026-10-20）

Phase 1の認証/IPC境界と既存移行1・2を維持し、移行3にカテゴリ・商品スキーマを追加した。依存変更はなく、`package-lock.json`を維持している。すべてのE2EはPlaywright専用userData、一時DB、および一時インストール先で実行した。

| コマンド/確認 | 結果 |
| --- | --- |
| `npm run typecheck` | 成功 |
| `npm test` | 成功。16件。移行1→3、SKU trim/大文字化後の重複（無効商品を含む）、在庫0固定、編集DTOの在庫拒否、無効カテゴリ保持/選択拒否、`%`/`_`の文字検索、安定ページング、STAFF書込拒否、カテゴリ名重複、監査失敗時の変更rollbackを確認 |
| `npm run test:e2e` | 成功。2件。初期ADMIN設定/再起動ログイン、STAFF発行とコード設定、カテゴリ・商品作成、特殊文字検索、無効カテゴリ表示、STAFF/未認証の管理操作拒否、RendererのNode統合無効を確認 |
| `npm run dist:win` | 成功。Windows 10.0.26200 x64上でElectron 44.9.0 ABI向けに`better-sqlite3`/`argon2`を再ビルドし、NSIS installerを生成 |
| `npm run test:packaged` | 成功。隔離領域へNSISを導入し、配布アプリの起動・SQLite書込後の終了/再起動読込・Argon2idログインを確認後、アンインストール |

Phase 2では商品/カテゴリ/ユーザーの管理APIをMainで認可し、ユーザー変更とカタログ変更を監査記録と同一トランザクションにした。UIと直接APIの両方でSTAFF拒否、最後のADMIN保護を確認した。Phase 3の在庫変更・履歴、ダッシュボードは未実装である。Windows 10別実機、署名済み配布物、NSIS更新インストール、アクセシビリティは未検証。

## Phase 3 実行結果（2026-10-20）

Phase 1/2の移行を変更せず、移行4に`stock_movements`と商品・日時・操作者索引を追加した。専用一時DB/userData、NSIS一時インストール先で検証した。外部依存の追加はない。

| コマンド/確認 | 結果 |
| --- | --- |
| `npm run typecheck` | 成功 |
| `npm test` | 成功。23件/4ファイル。移行1→4、整数数量・負在庫・上限、差分0棚卸、0/0・0/1・最低在庫一致、無効商品拒否、連続操作、movement/audit失敗時の全rollback、監査操作者スナップショット、UTC開始含む/終了除外、ローカル日付境界を確認 |
| `npm run test:e2e` | 成功。2件。初期画面ダッシュボード、ADMIN/STAFFの在庫操作、出庫不足拒否、棚卸実数0・差分0、商品/種別/操作者での履歴絞り込み、未認証IPC拒否を確認 |
| `npm run dist:win` | 成功。Windows x64 NSISを再生成。`better-sqlite3`/`argon2`をElectron 44.9.0 ABI向けに再構築 |
| `npm run test:packaged` | 成功。インストール版で起動・初期DB利用・終了後再ログインを確認し、一時領域からアンインストール |

在庫更新はMainの`InventoryService`だけが行い、IMMEDIATEトランザクション内で最新在庫を読んで、商品更新・履歴・監査を一括確定する。履歴の編集/削除APIはない。ダッシュボードは登録総数に無効商品を含め、低在庫/0在庫集計は有効商品のみに限定する。操作応答が不明なときはUIから再送せず、在庫と履歴を読み直す。Windows 10別実機、署名済み配布物、NSIS更新インストール、UIアクセシビリティは未検証。

## Phase 4 実行結果（2026-10-20）

移行1〜4は変更せず、移行5で監査主体種別を追加した。CSV・設定・バックアップ・Main内復元、起動時マーカー回復、専用のWindows x64 portable復旧exeを実装した。出力・復元候補・DBは隔離一時ディレクトリを使用した。

| コマンド/確認 | 結果 |
| --- | --- |
| `npm run typecheck` | 成功 |
| `npm test` | 成功。31件。移行1→5、式先頭/空白/制御文字のCSV安全化、BOM/固定列/全ページ、STAFF設定拒否、設定境界と短縮再評価、SQLite backup API、別アプリ候補拒否、監査失敗時に既存出力ファイルを保持、復元後の再設定コード失効、復元後セッション不在、強制終了相当の段階マーカーから原本へ復帰、同一ディレクトリの同時ロック拒否を確認 |
| `npm run test:e2e` | 成功。3件。初期設定/認証、ADMIN設定UIからのロック時間保存とDB保存先表示、sandbox/Node統合無効を確認 |
| `npm run dist:win` | 成功。Windows x64 NSISを生成し、`better-sqlite3`/`argon2`をElectron 44.9.0向けに再構築 |
| `npm run test:packaged` | 成功。NSIS導入版の起動、SQLite永続読込、終了後のArgon2idログインを確認 |
| `npm run dist:recovery` | 成功。別appId・`requireAdministrator`指定のWindows x64 portable exeを生成 |
| 非昇格復旧exe起動 | 成功。通常ユーザートークンを強制した実行で、管理者権限の案内を表示して対象DB選択前に終了。データ変更なし |

Phase 4は完了扱いしない。現Windows実行ユーザーは非管理者のためUAC昇格後の既存ADMINコード発行→本人再設定→通常ログイン、および破損DBからの復元を実行していない。同時起動中の実exeによる排他確認、復元中の実プロセス強制終了/電源断、事前バックアップ・接続停止・監査の各故障注入、ダイアログキャンセルのWindows E2E、Windows Excelでの式/日本語表示も未検証である。アプリ・復旧exeの同一ディレクトリロックは共通方式を使用し、アプリ内の復元マーカー回復はDB統合テストで模擬確認したが、これらは未実施のWindows運用ゲートの代替ではない。

## 0004-01 pnpm・ESLint実行結果（2026-10-20）

Windows 10.0.26300 x64、Node 24.21.0、pnpm 10.26.1、Visual Studio 18 Communityのx64開発環境で実施。Nodeのリポジトリ固定値24.19.0は維持しているためengine警告が出る。24.19.0そのものでは今回再検証していない。

TypeScriptのCLIは7.0.2のまま、公式互換パッケージ6.0.2（公開APIは6.0.3）をlint用に併用した。初回のTS7直接参照ではtypescript-eslintがロードを拒否したが、併用後はparser・ESLint推奨ルールが動作する。ESLintの警告は0件。CSV制御文字検査と4つの非同期IPC取得Effectだけに理由付き行単位例外を置いた。

| コマンド/確認 | 結果 |
| --- | --- |
| `pnpm exec tsc --version` / `tsc6 --version` | 7.0.2 / 6.0.3。型検査は前者を使用 |
| クリーン `pnpm install --frozen-lockfile --side-effects-cache=false` | 成功。node_modulesを退避して再導入。argon2/better-sqlite3/electron-winstallerのbuildとElectron ABI再構築を実行、lockfileのSHA256不変 |
| `pnpm run test:lint` | 6件成功。正常TSX、Hooks呼出順序/依存配列、深い相対パスを含むRenderer禁止import、環境別globals、生成物除外、CLI正常0/違反1を確認 |
| `pnpm run check` | lint警告0、TS7型検査、単体・DB31件/5ファイルが成功 |
| `pnpm run test:e2e` | ビルド成功、認証・在庫/認可・設定・sandboxの3件成功 |
| `pnpm run dist:win` / `pnpm run test:packaged` | NSIS生成成功。隔離インストール先でSQLite永続化・再起動後のArgon2id認証1件成功 |
| `pnpm run dist:recovery` | Windows x64 portable復旧exe生成成功。昇格後の実操作を新たに検証したものではない |

クリーン導入でpnpm内蔵node-gyp 11.5.0がVS18を認識できず失敗したため、better-sqlite3 13.0.3限定のpackageExtensionsでnode-gyp 13.1.0を補完して解消した。ビルドスクリプトの無効化で回避していない。TS7固有構文と互換parserの将来的な差には注意する。既存Phase 4の未検証項目と製品全体のリリースゲートは変更しない。

## 単体・DB・IPCの検証表

| 対象 | 主な確認 | 要求ID |
| --- | --- | --- |
| 入力・正規化 | login/SKU/category、必須・長さ・整数、Unicode方針 | F-PRODUCT、F-CATEGORY、F-AUTH |
| 認証 | Argon2id照合、平文不在、クールダウン永続化、現在パスワード | F-AUTH、R-SEC |
| セッション | 再起動/ロック/ロール変更/無効化/再設定で失効、ポーリングは活動に含めない | F-AUTH、R-IPC |
| 再設定 | 有効期限、失敗上限、再発行、消費、制限セッション、通常API拒否 | F-RESET |
| 認可 | 全API×未認証/STAFF/ADMIN/ロック/再設定、発信元違い | R-SCOPE、R-SEC、R-IPC |
| DB | 初期化/再移行/旧版/未来版、unique/FK、初期ADMIN一度、最後のADMIN保護 | R-DB、F-USERS |
| 在庫 | 正負delta、実数0、差分0、上限、無効商品、連続更新、全体rollback | F-STOCK |
| 一覧・履歴 | 安定ページング、検索文字、期間UTC境界、スナップショット | F-LIST、F-HISTORY |
| 低在庫 | 0/0、0/1、境界一致、超過、無効商品、集計一致 | F-DASHBOARD |
| CSV | BOM、引用、改行、式/空白/制御文字、全ページ、保存失敗 | F-CSV |
| 監査 | 許可項目、秘密除外、改名・無効化後、監査失敗 | F-AUDIT |
| バックアップ/復元 | コピー一貫性、各検査、未来版、退避、各段階失敗・強制終了 | F-BACKUP、F-RESTORE |
| 管理者復旧 | 昇格必須、排他、対象確認、事前バックアップ、既存ADMINのコード | F-RECOVERY |

## E2E

1. 初回セットアップ→ダッシュボード→終了→再起動でログインを要求。
2. 誤パスワード・待機、15分無操作相当、本人再認証、ログアウト。
3. ADMINがSTAFF作成→コードで本人が設定→STAFFログイン。ユーザー管理と商品更新はUI/IPCで拒否。
4. ADMINの商品作成、重複SKU拒否、編集、カテゴリ無効化、商品無効化。
5. STAFFの入庫・出庫・不足拒否・棚卸→履歴のbefore/after/理由/操作者。
6. 低在庫・0在庫、検索・複合フィルタ・ページング・空状態。
7. 隔離保存先へのCSV出力、ダイアログキャンセル、監査。
8. ADMINのバックアップ→変更→復元→再起動・旧セッション拒否・復元DBでログイン。
9. オフライン管理者復旧ツール→既存ADMINへコード発行→本人再設定→通常ログイン。

## 最終リリースゲート

- Windows 10/11 x64の開発版/配布版で起動し、ネイティブ依存が読める。
- 既定認証情報なし、パスワード/秘密非露出、再起動再認証、ロックとログアウトが動く。
- 権限表、最後のADMIN保護、ユーザー・商品・カテゴリの変更と履歴保持が成立する。
- 負在庫なし、在庫/履歴/監査が一致し、低在庫・0在庫・一覧条件が一致する。
- CSVがExcelで扱え、式を実行させない。
- バックアップ/復元・管理者復旧を手順から再現でき、失敗時に原本を回復できる。
- DBを更新インストール後も維持する。READMEだけで別担当者が開発・テスト・配布を再現できる。

実機で未検証のWindows版・Excel版・更新経路は未検証として記録し、初期リリース完成とは報告しない。
