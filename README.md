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

現在のアプリPlanは [店舗向け商品在庫管理](docs/plans/0003-store-inventory.md) です。[機能・要求別の設計索引](docs/specs/0003-store-inventory/README.md) と [実装プロンプト索引](docs/prompts/0003-store-inventory/README.md) から参照してください。Phase 0とPhase 1のWindows検証済み基盤を実装済みです。商品・カテゴリ・ユーザー管理をPhase 2で実装中です。

### 店舗在庫アプリ Phase 0・1

アプリ骨格は TypeScript、React、Electron、electron-vite で構成し、DBと認証ハッシュの検証はMainプロセス内に限定しています。Rendererへ業務DB APIや認証回避口は公開していません。開発・検証コマンド:

固定バージョンはNode.js 24.19.0/npm 11.17.0です。WindowsではPython 3とVisual Studio 2022の「Desktop development with C++」ツールチェーンを用意し、x64 Native Tools Command Promptから `npm ci` を実行してください。postinstallでbetter-sqlite3とargon2をElectron ABIへ再ビルドします。

```powershell
npm ci
npm run typecheck
npm test
npm run test:e2e
npm run dev
npm run build
npm run dist:win
npm run test:packaged
```

`test:packaged` は `dist:win` の後に実行し、パッケージ化されたWindows x64アプリの隔離データ領域で終了・再起動後のSQLite読込とArgon2id照合を確認します。

`npm run verify:desktop` を同じWindowsユーザー領域で2回実行すると、`%APPDATA%\沖縄店舗在庫管理\phase0-validation\persistence.sqlite` の再読込とArgon2id照合を確認できます。検証専用データは業務DBと分離しています。Playwrightは毎回一時userDataを使います。Windowsネイティブ依存の再ビルドは `npm run rebuild:native`、NSIS出力は `release/` に作られます。

採用バージョン、KDF実測、Windows x64 NSISと永続化の確認結果は[Phase 0判断・検証記録](docs/specs/0003-store-inventory/delivery/decisions.md)に記録しています。テスト・ビルドでの失敗や未検証範囲は[検証記録](docs/specs/0003-store-inventory/delivery/verification.md)を参照してください。

Phase 1では番号付きSQLite移行、初期ADMIN、Argon2idログイン、段階的な失敗待機、無操作ロック、本人のパスワード変更、ADMINによるユーザー発行と一度限りの再設定コードを実装しています。内部セッショントークンはMainからPreloadへ渡し、Preload内に保持します。Rendererは型付きAPIのみ利用し、商品・在庫の業務APIはまだありません。

Phase 1の主要確認は `npm test`（一時SQLite/認証統合）、`npm run test:e2e`（開発版セットアップ・再ログイン・STAFF再設定）、`npm run dist:win` と `npm run test:packaged`（NSIS導入版のDB永続化・Argon2idログイン）です。各実行結果は[検証記録](docs/specs/0003-store-inventory/delivery/verification.md)にあります。

製品DBは `%APPDATA%\沖縄店舗在庫管理\store-inventory.sqlite` に置きます。SQLite内の商品・在庫は暗号化されず、Windows管理者やDBファイルへアクセスできる人への完全な改ざん耐性はありません。手動バックアップは別媒体へ定期保管してください。Phase 0の検証DBは製品データではありません。

初期構成の記録は [Plan](docs/plans/0001-repository-structure.md)、[設計書](docs/specs/0001-repository-structure.md)、[引き継ぎプロンプト](docs/prompts/0001-repository-structure.md) を参照してください。アプリケーションの技術構成・実装手順は現在のPlanと設計索引を基準とし、具体的な依存バージョンとビルド方法をPhase 0で検証・確定します。

再利用するSkillは [設計者用](.agents/skills/software-designer/SKILL.md) と [実装者用](.agents/skills/software-implementer/SKILL.md) です。このリポジトリの `.agents/skills/` に配置してGitで管理します。ユーザー共通のSkillsフォルダーへのコピーは不要です。このリポジトリを開いた新しい会話で、例えば次のように依頼できます。

- `$software-designer このPlanを基に設計書と実装プロンプトを作成してください。`
- `$software-implementer docs/prompts/0001-repository-structure.md に従って作業してください。`

どちらも自動選択を有効にしたまま使用します。実装時のモデルは実行環境で GPT6-Luna［High］を選択してください。Skill化の記録は [0002](docs/specs/0002-role-skills.md) を参照してください。
