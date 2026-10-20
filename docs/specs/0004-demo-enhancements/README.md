# 0004: DEMO向け追加設計

## 参照・状態

- [Plan](../../plans/0004-demo-enhancements.md)
- [基本設計0003](../0003-store-inventory/README.md)
- [実装プロンプト](../../prompts/0004-demo-enhancements/README.md)
- 状態: pnpm移行、ESLint設定、DEMOパスワード、初期在庫、商品画像を実装済み。TypeScript 6.0.3へ固定し、型検査・単体テスト・ビルド・lint・開発版/配布版E2E・NSIS/復旧exe生成を検証済み。実ファイル選択を含む画像UI E2E、更新導入、Windows/Excel/昇格復旧の実機検証は未完了。

## 要求対応

| 要求 | 差分設計 | 実装プロンプト |
| --- | --- | --- |
| R-PNPM | [pnpm運用](tooling/pnpm.md) | [01](../../prompts/0004-demo-enhancements/01-pnpm-lint.md) |
| R-LINT | [linter](tooling/lint.md) | [01](../../prompts/0004-demo-enhancements/01-pnpm-lint.md) |
| R-DEMO | [DEMOパスワード](requirements/demo-password.md) | [02](../../prompts/0004-demo-enhancements/02-demo-password.md) |
| R-OPENING | [初期在庫](features/opening-stock.md) | [03](../../prompts/0004-demo-enhancements/03-opening-stock.md) |
| R-IMAGE | [商品画像](features/product-images.md) | [04](../../prompts/0004-demo-enhancements/04-product-images.md) |
| 横断 | [移行・統合検証](delivery/integration.md) | [05](../../prompts/0004-demo-enhancements/05-integration.md) |

## 適用順と保護するもの

この差分の対象箇所では0004を優先し、0003の認証・権限・在庫更新経路・監査・バックアップ等は継承する。原Planと過去の検証結果は書き換えない。実装に合わせて既存の現行設計・READMEへ参照と変更後仕様を反映するが、進行中の未コミット作業とは調整して扱う。

調査時のコードはnpm固定、ESLint未導入、パスワード最小12文字、商品作成時在庫0、商品画像の型/保存先なしだった。この記述は調査時点の記録であり、現在はpnpm移行、ESLint設定、パスワード下限4文字、初期在庫、商品画像、DB移行6〜7を実装している。

画像・初期在庫は商品管理ADMIN限定という決定を継承する。画像枚数/容量などの上限、画像をSQLiteに保存する方式、ESLintの構成は設計判断。DEMOの4文字下限は管理者が確定した要求である。

## 実装開始

pnpm/lint→パスワード→初期在庫→商品画像→統合検証の順で引き継ぐ。各変更を独立して検証し、未検証のWindows配布や既存Phase 4を完成扱いしない。
