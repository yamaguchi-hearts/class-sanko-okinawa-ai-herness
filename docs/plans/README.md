# Plan一覧

| ID | Plan | 状態 |
| --- | --- | --- |
| [0001](0001-repository-structure.md) | リポジトリ運用と設計・実装の引き継ぎ基盤 | 方針 |
| [0002](0002-role-skills.md) | 設計者・実装者Skillの役割分担 | 方針 |
| [0003](0003-store-inventory.md) | 店舗向け商品在庫管理アプリの機能・基盤 | 基本Plan。Phase 4/5に未検証項目あり |
| [0003の追加決定](0003-store-inventory-decisions.md) | 商品権限、再設定コード、管理者復旧 | 0003への補足 |
| [0004](0004-demo-enhancements.md) | DEMO差分、pnpm、ESLint、商品画像、初期在庫 | 実装済み（一部検証待ち。lintはTS7互換性で未通過） |
| [0005](0005-release-harness.md) | リリース・ハーネス、品質ゲート、証跡、公開判断 | 工程Plan |

リリース判断では0005を工程の定義元、0004を開発環境とDEMO差分の定義元、0003をアプリの機能・セキュリティ・データ保護の定義元とする。各Planの設計・実装・検証の状態は、対応する `docs/specs/`、`docs/prompts/`、検証記録、コミットで確認し、Planの存在だけを完了の根拠にしない。
