# 設計・実装引き継ぎリポジトリ

管理者のPlanを設計書へ具体化し、GPT6-Luna［High］に実装を引き継ぐためのリポジトリです。作業指示は [AGENTS.md](AGENTS.md) にあります。

```text
AGENTS.md          再利用する作業指示
.agents/skills/    設計者用・実装者用のリポジトリ内Skill
docs/
  plans/           管理者のPlanと出典
  specs/           ソフトウェアの設計書
  prompts/         実装者へのプロンプト
  templates/       設計書とプロンプトのひな型
```

Plan、設計書、プロンプトは同じ案件の `<ID>-<slug>` で対応づけます。単一文書は `.md`、機能・要求別に分割する案件は同名ディレクトリの `README.md` を索引にします。まず管理者のPlanを記録し、設計書とプロンプトを作成します。重要な不明点を解消してから実装へ引き継ぎます。各作業の完了時には対象の変更を自動コミットします。

アプリの基本Planは [店舗向け商品在庫管理](docs/plans/0003-store-inventory.md) です。[DEMO差分・pnpm・ESLintのPlan](docs/plans/0004-demo-enhancements.md) と [リリース・ハーネスPlan](docs/plans/0005-release-harness.md) をあわせて参照してください。Plan全体の対応関係は [Plan一覧](docs/plans/README.md)、機能・要求別の設計と実装引き継ぎは [設計索引](docs/specs/0003-store-inventory/README.md) と [実装プロンプト索引](docs/prompts/0003-store-inventory/README.md) にあります。Phase 0〜4の基盤、認証、商品・カテゴリ・ユーザー管理、在庫変更・履歴、CSV、設定、バックアップ/復元、Windows管理者復旧ツールを実装しています。0004ではpnpm移行、TypeScript 6.0.3への固定、ESLint設定、DEMOパスワード、初期在庫、商品画像、商品の再有効化を実装済みです。型検査・単体/DBテスト・ビルド・lint・開発版/配布版E2E・Windows配布候補生成を検証済みです。実ファイル選択を含む画像UI、更新導入、Windows/Excel/昇格復旧の実機検証は未完了です。

### 店舗在庫アプリ Phase 0〜3

アプリ骨格は TypeScript、React、Electron、electron-vite で構成し、DBと認証ハッシュの検証はMainプロセス内に限定しています。Rendererへ業務DB APIや認証回避口は公開していません。開発・検証コマンド:

固定バージョンはNode.js 24.19.0/pnpm 12.14.0です。WindowsではPython 3とVisual Studio 2022の「Desktop development with C++」ツールチェーンを用意し、x64 Native Tools Command Promptから `pnpm install --frozen-lockfile` を実行してください。postinstallでbetter-sqlite3とargon2をElectron ABIへ再ビルドします。

```powershell
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run test:e2e
pnpm run dev
pnpm run build
pnpm run dist:win
pnpm run test:packaged
pnpm run dist:recovery
```

`test:packaged` は `dist:win` の後に実行し、パッケージ化されたWindows x64アプリの隔離データ領域で終了・再起動後のSQLite読込とArgon2id照合を確認します。

`pnpm run verify:desktop` を同じWindowsユーザー領域で2回実行すると、`%APPDATA%\沖縄店舗在庫管理\phase0-validation\persistence.sqlite` の再読込とArgon2id照合を確認できます。検証専用データは業務DBと分離しています。Playwrightは毎回一時userDataを使います。Windowsネイティブ依存の再ビルドは `pnpm run rebuild:native`、NSIS出力は `release/` に作られます。

採用バージョン、KDF実測、Windows x64 NSISと永続化の確認結果は[Phase 0判断・検証記録](docs/specs/0003-store-inventory/delivery/decisions.md)に記録しています。テスト・ビルドでの失敗や未検証範囲は[検証記録](docs/specs/0003-store-inventory/delivery/verification.md)を参照してください。

Phase 1では番号付きSQLite移行、初期ADMIN、Argon2idログイン、段階的な失敗待機、無操作ロック、本人のパスワード変更、ADMINによるユーザー発行と一度限りの再設定コードを実装しています。Phase 2では商品・カテゴリ・ユーザー管理と商品一覧を追加しました。Phase 3ではMainの在庫サービスに更新を集約し、入庫・出庫・棚卸、在庫履歴、ダッシュボードを追加しました。0004でDEMO用パスワード下限を4文字へ統一し、商品作成時の初期在庫登録と商品画像の保存・表示を追加しています。内部セッショントークンはMainからPreloadへ渡し、Preload内に保持します。Rendererは型付きAPIのみ利用します。

Phase 0〜3の主要確認は `pnpm run typecheck`、`pnpm test`（一時SQLite/サービス統合）、`pnpm run test:e2e`（開発版セットアップ・認証・カタログ・在庫変更・履歴）、`pnpm run dist:win` と `pnpm run test:packaged`（NSIS導入版のDB永続化・Argon2idログイン）です。各実行結果は[検証記録](docs/specs/0003-store-inventory/delivery/verification.md)にあります。0004の短縮入口は `pnpm run check`（lint→型検査→単体テスト）です。

Phase 4の設定はADMINだけが変更できます。店舗名と無操作ロック時間（1〜60分、既定15分）を更新し、ロック時間短縮は最終本人操作時刻に照らして即時再評価します。商品一覧のCSV出力は画面の検索・カテゴリ・状態・在庫条件・ソートを保ち、一致する全件をUTF-8 BOM/CRLFで保存します。保存ダイアログのキャンセルも監査されます。Excelでの表示確認はWindows実機と対象Excel版で行い、結果を検証記録に残してください。

ADMINは画面の「バックアップ・復元」から `.sqlite3` バックアップを作成できます。使用中DBの単純コピーはせずSQLite backup APIを使います。バックアップには商品、履歴、ユーザー情報が含まれ、暗号化されません。作成後はUSB等の別媒体へ定期的に複製し、保管先をWindowsアカウント/ディスク保護で管理してください。復元は候補検査、店舗名の再確認、ADMINパスワード再認可、現DBの事前バックアップ後に実施されます。成功するとアプリを再起動し、復元先DBの資格情報で再ログインします。復元された未使用の再設定コードは失効されます。

全ADMINが利用できない場合、`pnpm run dist:recovery` で作成した `release/recovery/沖縄店舗在庫管理 管理者復旧ツール-<version>-win-x64.exe` を右クリックして「管理者として実行」します。アプリを終了し、対象の `store-inventory.sqlite` を選びます。ツールはアプリと同じuserDataディレクトリ排他ロックを取得し、対象店舗と既存の有効ADMINを確認してから、保存先を指定した検証済み事前バックアップを作ります。発行されたコードは一度だけ表示されるため、その場で対象者へ安全に渡してください。通常アプリのログイン画面から本人がコードで新しいパスワードを設定します。DB破損時はツールで検証済みバックアップを選択し、対象DBファイルの退避と段階マーカー付き入替を行います。自動復帰できない場合は業務アプリを起動せず、退避ファイルとマーカーを保持して管理者へ連絡してください。

開発版のDBはリポジトリ直下の `store-inventory.sqlite`、配布版は `%APPDATA%\沖縄店舗在庫管理\store-inventory.sqlite` に保存します。別Windowsアカウントで昇格した場合は復旧ツールの対象選択で意図したアカウントのDBを指定してください。ローカル管理者やDBファイルへ直接アクセスできる者に対する完全な機密性・改ざん防止はありません。DBを直接編集しないでください。復旧exeの配布前には署名と実機の昇格・排他・本人再設定を確認してください。

配布版の製品DBは `%APPDATA%\沖縄店舗在庫管理\store-inventory.sqlite` に置きます。SQLite内の商品・在庫は暗号化されず、Windows管理者やDBファイルへアクセスできる人への完全な改ざん耐性はありません。手動バックアップは別媒体へ定期保管してください。Phase 0の検証DBは製品データではありません。


初期構成の記録は [Plan](docs/plans/0001-repository-structure.md)、[設計書](docs/specs/0001-repository-structure.md)、[引き継ぎプロンプト](docs/prompts/0001-repository-structure.md) を参照してください。アプリケーションの技術構成・実装手順は現在のPlanと設計索引を基準とし、具体的な依存バージョンとビルド方法をPhase 0で検証・確定します。

再利用するSkillは [設計者用](.agents/skills/software-designer/SKILL.md) と [実装者用](.agents/skills/software-implementer/SKILL.md) です。このリポジトリの `.agents/skills/` に配置してGitで管理します。ユーザー共通のSkillsフォルダーへのコピーは不要です。このリポジトリを開いた新しい会話で、例えば次のように依頼できます。

- `$software-designer このPlanを基に設計書と実装プロンプトを作成してください。`
- `$software-implementer docs/prompts/0001-repository-structure.md に従って作業してください。`

どちらも自動選択を有効にしたまま使用します。実装時のモデルは実行環境で GPT6-Luna［High］を選択してください。Skill化の記録は [0002](docs/specs/0002-role-skills.md) を参照してください。
