# 0004: DEMO向け開発環境と商品機能の追加Plan

## 出典

2026-10-20、管理者がsoftware-designerを指定して依頼した以下の変更に基づく。[既存Plan](0003-store-inventory.md) と [既存の追加決定](0003-store-inventory-decisions.md) を継承し、変更点を本書に分離する。

## 要求

| ID | 管理者の要求 |
| --- | --- |
| R-PNPM | 開発・テスト・ビルド等をpnpmで実行する |
| R-LINT | linterを追加する |
| R-IMAGE | 商品画像を追加できるようにする |
| R-DEMO | DEMOなのでパスワード要件を緩和する |
| R-OPENING | 商品に初期在庫を設定できるようにする |
| R-RELEASE | この差分を、再現可能な品質確認とWindows配布の工程に組み込む |

## 追加確認の回答

同日の確認で、管理者はパスワードを「4文字以上（DEMO向け）」と指定した。最大128文字、Argon2id保存、認証・権限チェックを維持し、最小文字数を変更する。

## 設計判断と範囲

- linterはESLintとTypeScript/React Hooks用ルールを採用する。
- 商品画像はまず任意の1枚、PNG/JPEG、ADMINが登録・差替え・削除し、両ロールが閲覧できる設計にする。
- 初期在庫は新規商品作成時のみ、既定0・非負整数とし、正数はOPENING履歴へ残す。
- これらの詳細は管理者が指定していないため設計判断として扱う。
- 今回の担当は設計と実装プロンプト作成。コード変更、依存導入、lockfile変換、マイグレーション適用は実装者の作業とする。
- 着手時に既存Phase 4等の未コミット変更が存在するため、それらを上書き・コミットせず、新しい文書だけを作成する。
- pnpm と lint は個別の開発者向け改善ではなく、以降の変更を同じ品質ゲートで通すための前提とする。リリース時の実行順・証跡・承認・復旧の扱いは [0005](0005-release-harness.md) を定義元とする。
- `package.json` がnpmを指しESLint設定が存在しない調査時点では、R-PNPM/R-LINTは設計済み・未実装である。pnpm移行前のnpmによる過去の検証結果を、pnpm/lintを通過した結果として扱わない。

## 成果物

- [機能・要求別設計](../specs/0004-demo-enhancements/README.md)
- [実装プロンプト](../prompts/0004-demo-enhancements/README.md)
- [リリース・ハーネスPlan](0005-release-harness.md)
