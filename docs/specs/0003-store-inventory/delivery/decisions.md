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

## Phase 0の確定状況

依存バージョン、Argon2id設定、Windows userData名と排他方式、NSIS設定、検証コマンド、共有契約/マイグレーション配置は上記記録のとおり確定した。Electron内部トークンの受渡しと期限管理はD-24/D-25のとおりPhase 1で実装する。管理者復旧ツールの独立配布はD-23のとおりPhase 4で実装する。Phase 0で残る環境上の課題はなく、Windows 10/更新インストール/署名証明書/NSIS実インストールは後続の対象である。

## 後続フェーズでの実機検証

Phase 4で復元中断/復帰とWindows管理者復旧、Phase 5でWindows 10/11とExcel・更新インストールを確認する。互換性、署名/配布環境など未確認の事項を完了扱いしない。現時点で管理者への回答待ち事項はない。
