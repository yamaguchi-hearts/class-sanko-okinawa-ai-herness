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

現在のアプリPlanは [店舗向け商品在庫管理](docs/plans/0003-store-inventory.md) です。[機能・要求別の設計索引](docs/specs/0003-store-inventory/README.md) と [実装プロンプト索引](docs/prompts/0003-store-inventory/README.md) から参照してください。アプリ実装は未着手で、Phase 0から開始します。

初期構成の記録は [Plan](docs/plans/0001-repository-structure.md)、[設計書](docs/specs/0001-repository-structure.md)、[引き継ぎプロンプト](docs/prompts/0001-repository-structure.md) を参照してください。アプリケーションの技術構成・実装手順は現在のPlanと設計索引を基準とし、具体的な依存バージョンとビルド方法をPhase 0で検証・確定します。

再利用するSkillは [設計者用](.agents/skills/software-designer/SKILL.md) と [実装者用](.agents/skills/software-implementer/SKILL.md) です。このリポジトリの `.agents/skills/` に配置してGitで管理します。ユーザー共通のSkillsフォルダーへのコピーは不要です。このリポジトリを開いた新しい会話で、例えば次のように依頼できます。

- `$software-designer このPlanを基に設計書と実装プロンプトを作成してください。`
- `$software-implementer docs/prompts/0001-repository-structure.md に従って作業してください。`

どちらも自動選択を有効にしたまま使用します。実装時のモデルは実行環境で GPT6-Luna［High］を選択してください。Skill化の記録は [0002](docs/specs/0002-role-skills.md) を参照してください。
