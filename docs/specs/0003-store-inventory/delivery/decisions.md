# 設計判断・検証待ち事項

[設計索引](../README.md)

## 要求と判断の区別

商品管理ADMIN限定・一度限りの再設定コード・初期版の管理者復旧ツールは [管理者決定](../../../plans/0003-store-inventory-decisions.md) による。以下は原Planの不足・重複を具体化する設計判断であり、管理者の原文には上書きしない。

| ID | 判断 | 理由・影響 |
| --- | --- | --- |
| D-01 | 文書は既存docs配下、案件0003の機能別/要求別フォルダー | 原Planのdoc/plan.mdは推奨例。既存規約と追加指示を優先 |
| D-02 | 商品更新はADMINのみ、カテゴリ読取はSTAFFも可 | 追加A-01、商品表示に名称が必要 |
| D-03 | ログイン等は匿名/専用状態APIとして列挙 | 「setup以外認証必須」の文字どおりの実装でログイン不能にしない |
| D-04 | ロックは業務トークン破棄と本人のロック文脈を分離 | 旧トークンを拒否しつつ本人のunlockを可能にする |
| D-05 | 再設定コード32バイト、15分、誤入力5回、1ユーザー1件、検証時消費 | 一度限りの意味と制限セッションの期限を具体化 |
| D-06 | 新規ユーザーもコードで本人が初期パスワード設定 | 管理者に本人のパスワードを指定させない |
| D-07 | 復旧ツールはWindows管理者昇格、アプリ停止、事前バックアップ、既存ADMIN対象 | 明示的なローカル保守手段とし、通常アプリの秘密の回避口を避ける |
| D-08 | 数量上限2,147,483,647、パスワード最大128、メモ最大2,000文字 | 入力境界とDB/JavaScript整合を明示 |
| D-09 | ロック設定1〜60分、既定15分、無効化不可 | 認証要件を維持した設定範囲 |
| D-10 | 商品作成時在庫0のみ、OPENING導線は作らない、棚卸差分0は記録 | 初期在庫の任意要件を増やさず棚卸実施を保持 |
| D-11 | 有効商品を一覧既定、低在庫/0集計は有効のみ、登録数は全件、直近10件 | 集計の母集団と無効商品の扱いを統一 |
| D-12 | CSVは現在条件の全ページ、固定8列、UTF-8 BOM/CRLF | 出力範囲の曖昧さを解消 |
| D-13 | 匿名ログインはACCOUNT_LOCKED等で既知IDを区別しない | 原Planのユーザー列挙防止を優先 |
| D-14 | 監査閲覧画面・商品再有効化画面は初期必須に追加しない | 原Planの対象範囲を保持 |
| D-15 | カテゴリ正規化キー、ログインtrim+小文字化、Unicode完全case foldingは対象外 | SQLite NOCASEだけにUnicode全体の比較を期待しない |
| D-16 | 復元時は全コード失効、旧DB退避、段階マーカーで中断回復 | 過去コード再利用、Windowsファイル入替と強制終了への対応 |
| D-17 | ユーザー管理はPhase 1で基盤、Phase 2でUI仕上げ、復旧はPhase 4 | 原Planの重複と追加A-03の配置を整理 |
| D-18 | バックアップ単体はSQLite、識別/スキーマはDB内メタデータ | 別アプリDBを拒否し、単一ファイルで運用可能にする |
| D-19 | トークン期限は無操作期限と同一、本人操作だけで延長 | ロック設定より早い意図しない失効と並行呼び出しのローテーション競合を避ける |
| D-20 | 商品名の正規化検索キーをDBへ追加 | Unicode大小文字の検索をSQLite NOCASEだけに依存させない |
| D-21 | アプリIDは `jp.co.sanko-okinawa.store-inventory`、表示名/既定userData名は「沖縄店舗在庫管理」 | electron-builderの安定識別子と、Windowsのユーザー別AppData配置をPhase 0で固定 |
| D-22 | MainはuserDataディレクトリを `proper-lockfile` で排他し、stale 15秒・更新5秒とする。復旧ツールも同じロックを取得し、アプリ終了中だけ操作する | OS間で共有できるロックファイル方式を採用。SQLite自身の書込みロックだけに保守作業の排他を依存しない |
| D-23 | 復旧ツールはPhase 4でアプリと別のWindows x64ポータブル実行ファイルとして配布し、Windows管理者昇格を要求する。共通DBサービス/ロック規約を共有する | 通常アプリに復旧バックドアを置かず、オフライン保守の実行と通常業務を分離 |
| D-24 | 内部トークンはMainから認証IPC応答としてPreloadへ返し、Preloadクロージャ内だけに保持する。Preloadの用途別ラッパーが各保護呼出しへ付与し、Rendererには返さない | Rendererのlocal/session storageと汎用IPCを使わず、設計済みのMain→Preload境界に限定 |
| D-25 | Main内で無操作期限とトークン期限を同じ期限値で管理し、検証済みの本人操作だけが最終操作時刻を更新する。ポーリングや期限切れ確認は延長しない | D-19をPhase 1で実装可能な単一の期限管理方針に確定 |
| D-26 | 公開DTO/エラーの定義元は `src/shared/contracts/`、共有入力検証は `src/shared/validation/`、番号付きマイグレーションは `src/main/db/migrations/` に置く。Phase 1で適用履歴用 `schema_migrations` を初期化する | Main秘密型とRenderer公開契約を分離し、適用済み移行の不変性を保つ |
| D-27 | Argon2idはargon2 npm 0.45.1のArgon2id実装、m=65,536 KiB、t=3、p=4、出力32 byteを採用 | 64 MiB級のメモリコストを確保し、Windows x64 Electronで実測して選定。実行時間はPhase 0記録に残す |
| D-28 | 製品DBのuserData内ファイル名は `store-inventory.sqlite`。Phase 0検証DBは `phase0-validation/persistence.sqlite` | 製品データと検証データを別ファイル・別ディレクトリに分離し、検証実行が業務DBに触れないようにする |
| D-29 | 初期スキーマ移行1は認証・設定・監査テーブル、移行2は再設定/監査索引としてPhase 1で固定し、Phase 2以降は新番号を追加する | 適用済みスキーマの不変性を保ち、既存DBの段階移行を検証可能にする |
| D-30 | IPCの認証状態は用途別Mainハンドラーが検証する。内部トークンは認証応答でPreloadへ返し、Preloadクロージャだけで保管・付与する。物理キー/ポインターの信頼済みイベントのみ活動時刻を更新する | D-24/D-25を実装し、Renderer向け任意チャンネルやポーリングによる期限延長を避ける |
| D-31 | セットアップ完了後に有効ADMINが0人、またはセットアップ未完了でユーザー行が存在するDBは通常セットアップを拒否し、復旧案内にする | 不整合DBから通常画面で管理権限を再作成させない |
| D-32 | Phase 2の移行3にカテゴリ・商品テーブルと検索/一覧用索引を追加する。SKUはtrimして入力された大小文字を表示値に保ち、ASCII限定とSQLite `NOCASE` 一意制約で大小文字を区別せず比較する。無効商品も一意制約の対象にする | 既適用移行1・2を変更せず、再有効化画面がない初期版でもSKU再利用による履歴参照の曖昧さを避ける |
| D-33 | 商品一覧はSKU・名称の部分一致、カテゴリ/状態/在庫条件をSQLパラメーターで適用し、`%`と`_`をLIKE検索のメタ文字でなく文字として扱う。ページ内外は明示ソート列とIDの組で安定化する | 利用者入力をSQL構文として解釈せず、ページ境界の重複・欠落を抑える |
| D-34 | 無効カテゴリを参照する既存商品は表示・他項目編集を許可し、新規商品およびカテゴリ変更先には無効カテゴリを選べない | 論理無効化後も商品情報・過去履歴の参照性を保持する |
| D-35 | 商品更新DTOは`currentStock`を含めず、DBでも作成時在庫を0に固定する。在庫変更はPhase 3の専用サービスに限定する | 商品管理と在庫記録の監査・原子性を分離し、編集経由の在庫迂回を防ぐ |
| D-36 | Phase 3の移行4で在庫履歴と商品/日時/操作者索引を追加する。在庫サービスだけがIMMEDIATEトランザクション内で最新値を読み、商品在庫・履歴・`STOCK_RECORDED`監査を一括確定する | 古いRenderer値で更新せず、履歴または監査の失敗で部分保存を残さない |
| D-37 | ダッシュボードの商品総数は無効を含み、有効数は有効商品のみ、低在庫/0在庫数は有効商品のみとする。低在庫は最低数>0かつ現在庫<=最低数、0在庫は現在庫=0。直近10件は商品有効状態を問わず在庫履歴から日時/ID降順で選ぶ | 商品登録数と現在操作可能な在庫警告の母集団を分け、履歴を論理無効化後も追えるようにする |
| D-38 | 履歴期間はローカル日付の開始0時以上・終了日の翌日0時未満をそれぞれUTCへ変換する。操作者候補は記録された操作者IDごとの最新スナップショットを選ぶ | DSTを含むローカル日の境界を保ち、改名後に重複する操作者選択肢を抑える |
| D-39 | Phase 4で監査主体種別 `actor_kind` を移行5で追加し、通常利用者・オフライン復旧・システムを区別する | 復旧exeの操作を店舗ユーザーの操作と混同せず記録し、移行1〜4を不変に保つ |
| D-40 | 復元候補はMainがuserData内へコピーして検査し、適用時にSQLite backup APIで現DBを退避する。復元マーカーは同一userDataに段階とファイル名のみを記録し、再起動時は未確定操作を元DBへ戻す | Rendererから任意パスを受けず、強制終了で候補だけが不完全なまま業務起動する事態を避ける |
| D-41 | 復旧ツールは専用ElectronエントリーをWindows x64 portable targetとして別appId・`requireAdministrator`で配布する。通常アプリと同じuserDataディレクトリロックを使用する | PCにNode開発環境を要求せず、アプリの昇格を常態化させず、同時書込みを拒否する |
| D-42 | DEMOの新規パスワードは4〜128 Unicodeコードポイントとし、0003の12文字下限を置き換える。ログイン・ロック解除・現在パスワード照合は既存の1〜128文字条件を維持する | [0004 R-DEMO](../../0004-demo-enhancements/requirements/demo-password.md)による管理者確定要件。既存ハッシュや認証機構は変更しない |

## Phase 0 技術確定・実測

2026-10-20のWindows x64環境で確定した固定バージョン:

| 構成 | バージョン |
| --- | ---: |
| Host Node.js / npm | 24.19.0 / 11.17.0 |
| Electron | 44.9.0（同梱Node.js 24.22.0） |
| electron-vite / Vite | 6.0.0 / 8.3.4 |
| TypeScript / React | 7.0.2 / 19.3.1 |
| better-sqlite3 / argon2 | 13.0.3 / 0.45.1 |
| electron-builder / Vitest / Playwright | 26.15.3 / 5.0.5 / 1.64.1 |

electron-vite公式の必要Node.js範囲（20.19+または22.12+）にHost Node 24が含まれる。Electronはsandboxed preloadがNodeの完全なrequire環境を持たないため、Preloadは依存をbundleし、CommonJS出力にする。electron-builderはbetter-sqlite3/argon2をx64 Electron向けに再ビルドし、`.node`をasar外へ配置する。Electron公式のネイティブモジュール手順どおり再ビルドを実施した。

互換性・実装の参照先は [electron-vite前提条件](https://electron-vite.org/guide/)、[Electronのネイティブモジュール](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules/)、[Electronセキュリティ推奨](https://www.electronjs.org/docs/latest/tutorial/security)、[electron-builder NSIS設定](https://www.electron.build/docs/nsis/)、[Playwright Electron API](https://playwright.dev/docs/api/class-electron)、[node-argon2実装資料](https://github.com/ranisalt/node-argon2) を参照。

Windows実測はKDFハッシュ21ms、照合18ms（同一マシンで各1回のPhase 0起動結果）。測定は環境依存の単回値であり、正式な性能試験ではない。アプリ識別子は初期値で、正式な販売者ドメインが決まった時点で変更を判断する。

製品DBは `%APPDATA%\沖縄店舗在庫管理\store-inventory.sqlite`、Phase 0検証用DBは `%APPDATA%\沖縄店舗在庫管理\phase0-validation\persistence.sqlite`。起動引数 `--phase0-verify` のMain内限定検証で後者を作成/再読込し、結果を同ディレクトリの `result.json` に記録する。通常UI/PreloadからDB読書きや検証ハッシュへアクセスできない。

## Phase 0〜4の確定状況

依存バージョン、Argon2id設定、Windows userData名と排他方式、NSIS設定、検証コマンド、共有契約/マイグレーション配置は上記記録のとおり確定した。移行1〜5と認証・カタログ・在庫・CSV/設定/保守IPC境界を実装した。Windows 10の別環境、更新インストール、署名証明書、Excel表示、復旧exeの実機運用は未検証項目として管理する。

## 後続フェーズでの実機検証

Phase 4で復元中断/復帰とWindows管理者復旧、Phase 5でWindows 10/11とExcel・更新インストールを確認する。互換性、署名/配布環境など未確認の事項を完了扱いしない。現時点で管理者への回答待ち事項はない。
