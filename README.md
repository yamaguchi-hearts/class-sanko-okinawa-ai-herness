# 設計・実装引き継ぎリポジトリ

管理者のPlanを設計書へ具体化し、GPT6-Luna［High］に実装を引き継ぐためのリポジトリです。作業指示は [AGENTS.md](AGENTS.md) にあります。

```text
AGENTS.md          再利用する作業指示
skills/            設計者用・実装者用Skillの配布原本
docs/
  plans/           管理者のPlanと出典
  specs/           ソフトウェアの設計書
  prompts/         実装者へのプロンプト
  templates/       設計書とプロンプトのひな型
```

Plan、設計書、プロンプトは同じ `<ID>-<slug>.md` で対応づけます。まず管理者のPlanを記録し、テンプレートから設計書とプロンプトを作成します。重要な不明点を解消してから実装へ引き継ぎます。各作業の完了時には対象の変更を自動コミットします。

初期構成については [Plan](docs/plans/0001-repository-structure.md)、[設計書](docs/specs/0001-repository-structure.md)、[引き継ぎプロンプト](docs/prompts/0001-repository-structure.md) を参照してください。アプリケーションの技術スタック、ソース配置、ビルド方法は今後のPlanに応じて決定します。

再利用するSkillは [設計者用](skills/software-designer/SKILL.md) と [実装者用](skills/software-implementer/SKILL.md) です。各フォルダーを `$CODEX_HOME/skills/`（未設定時は `~/.codex/skills/`）へ配置します。この環境には両方を配置済みです。新しい会話で、例えば次のように依頼できます。

- `$software-designer このPlanを基に設計書と実装プロンプトを作成してください。`
- `$software-implementer docs/prompts/0001-repository-structure.md に従って作業してください。`

どちらも自動選択を有効にしたまま使用します。実装時のモデルは実行環境で GPT6-Luna［High］を選択してください。Skill化の記録は [0002](docs/specs/0002-role-skills.md) を参照してください。
