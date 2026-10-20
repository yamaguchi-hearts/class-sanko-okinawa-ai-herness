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
