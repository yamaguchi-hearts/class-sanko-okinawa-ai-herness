# Phase 5: 横断検証・Windows配布・運用文書

GPT6-Luna［High］の実装者として、[共通指示](README.md) とPhase 0〜4の検証結果を確認してください。

## 参照資料

- `docs/specs/0003-store-inventory/README.md` と各機能の受け入れ条件。
- 同配下 `delivery/verification.md`、`delivery/operations.md`、`delivery/decisions.md`、`architecture/platform.md`、`requirements/security.md`。
- `docs/plans/0003-store-inventory.md` の§11最終チェックリストと追加決定。

## 実装・検証

1. 既存の単体/DB/IPCテストを実行し、設計の受け入れ条件から漏れている重要な動作を追加検証する。
2. 専用userDataを使うPlaywright Electron E2Eで、セットアップ・再起動・認証・ロック・権限・商品・在庫・履歴・CSV・バックアップ復元・再設定を通す。
3. Windows 10/11 x64の開発/NSISパッケージ版、クリーン環境相当、更新インストールを検証する。DBと履歴の保持、移行、ネイティブ依存を確認する。
4. 開発環境なしでオフライン復旧ツールが起動し、管理者コード発行と本人設定ができることを確認する。
5. ExcelでCSVのBOM・日本語・文字列/式安全化を確認する。使用したWindows/Excel/アプリ版と検証結果を記録する。
6. READMEを運用設計の項目に沿って完成させる。実際のコマンド・保存先・配布物名を使い、DB非暗号化、ローカル管理者の限界、バックアップの別媒体保管、明示的復旧手順を記載する。
7. セキュリティ境界、秘密の非露出、通常ログのサイズ制限、復元中断回復を最終確認する。

## 完了条件

検証設計のリリースゲートと原Planの最終チェックをすべて満たし、別担当者がREADMEだけで起動・テスト・Windowsビルドと運用を再現できること。未実行/失敗は明示し、初期リリース完成としないでください。

対象の変更を日本語で自動コミットし、各検証結果、配布物の場所、未解決事項、コミットID、Git状態を報告してください。公開・pushは別途依頼された場合に限ります。
