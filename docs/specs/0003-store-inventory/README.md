# 0003: 店舗向け商品在庫管理アプリ 設計索引

## 基準資料・状態

- [管理者の原Plan](../../plans/0003-store-inventory.md): 2026-10-20に受領した添付を変更せず保存。
- [管理者の追加決定](../../plans/0003-store-inventory-decisions.md): 商品管理権限、再設定コード、管理者復旧ツール。
- [実装プロンプト索引](../../prompts/0003-store-inventory/README.md): GPT6-Luna［High］への引き継ぎ。
- 状態: Phase 0/1をWindows x64で実装・検証済み、Phase 2を実装中。各Phaseの実装・検証状況は [検証記録](delivery/verification.md) を参照する。後続Phaseや別Windows環境の検証を完了扱いしない。

原Planの出典は添付 `貼り付けたテキスト.txt`。保存時のSHA-256は `3847FC36301630323A1917F2F48CAB08085B1471AA8003794DF468C13C6C9469`。追加の決定と設計判断は原文とは別に管理する。

## 分類と要求対応

| 分類 | 設計書 | 原Planの主な対応箇所 |
| --- | --- | --- |
| 要求事項 | [適用範囲・権限](requirements/scope-and-roles.md) | §1–2、§3、§13 |
| 要求事項 | [セキュリティとデータ保護](requirements/security.md) | §3.1、§5、§12 |
| 要求事項 | [画面・操作規約](requirements/user-interface.md) | §3.2、§4 |
| 共通基盤 | [技術構成・プロセス境界](architecture/platform.md) | §5、§9、§14 |
| 共通基盤 | [DB・マイグレーション](architecture/database.md) | §6–7 |
| 共通基盤 | [IPC・エラー契約](architecture/ipc.md) | §5.1–5.3、§8 |
| 業務機能 | [初期設定・認証・セッション](features/authentication.md) | §3.1、§4.1–4.2、§5.3–5.4 |
| 業務機能 | [ユーザー管理・再設定・管理者復旧](features/users-and-recovery.md) | §2.1、§3.1、§12、追加A-02/A-03 |
| 業務機能 | [商品・カテゴリ](features/catalog.md) | §3.3、追加A-01 |
| 業務機能 | [入庫・出庫・棚卸調整](features/stock.md) | §3.4、§7.1 |
| 業務機能 | [ダッシュボード・一覧・履歴](features/inventory-and-history.md) | §3.2、§3.5、§4.4 |
| 業務機能 | [監査ログ](features/audit.md) | §3.5、§6.6、§7 |
| 業務機能 | [CSV出力](features/csv.md) | §3.6 |
| 業務機能 | [設定・バックアップ・復元](features/settings-and-backup.md) | §3.7、§6.7、§10 Phase 4 |
| 実装・検証 | [実装フェーズ・依存関係](delivery/implementation.md) | §10、§14 |
| 実装・検証 | [検証・受け入れ条件](delivery/verification.md) | §11 |
| 実装・検証 | [配布・運用](delivery/operations.md) | §5.5、§10 Phase 5、§12 |
| 実装・検証 | [設計判断・検証待ち事項](delivery/decisions.md) | 原Planの不足・重複・追加決定の整理 |

## 文書の適用

元の要求を変更する場合は管理者の決定を補足資料へ追記する。具体的な実装上の判断は判断記録に残す。権限は適用範囲、DB構造はDB設計、IPCはIPC設計をそれぞれ定義元とし、画面ごとに別の解釈を作らない。矛盾があれば黙って一方を採用せず、影響する実装を止めて確認する。

設計者・実装者は索引、対象機能、共通基盤、対応するフェーズプロンプトを読む。Phase 0から順に実装し、共有契約とマイグレーションの責任を先に確定する。
