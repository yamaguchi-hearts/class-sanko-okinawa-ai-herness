# Phase 3: 在庫変更・ダッシュボード・履歴

GPT6-Luna［High］の実装者として、[共通指示](README.md) とPhase 2の成果を確認してください。

## 参照資料

- `docs/specs/0003-store-inventory/README.md`。
- 同配下 `architecture/database.md`、`architecture/ipc.md`、`features/stock.md`、`features/inventory-and-history.md`、`features/audit.md`、`requirements/user-interface.md`、`delivery/verification.md`。

## 実装

1. stock_movementsと索引の新規移行、純粋な数量/差分/低在庫判定を実装する。
2. 在庫サービスを唯一の更新経路とし、トランザクション内で最新値を読み、商品更新・movement・auditを一括保存する。
3. 入庫/出庫/棚卸の判別DTO、理由・メモ、結果表示と二重送信防止を実装する。負在庫・上限・小数・無効商品を拒否する。
4. 棚卸実数0・差分0を扱い、過去履歴の編集/削除APIを作らない。訂正は追加操作で行う。
5. ダッシュボード、低在庫/0在庫フィルタ、直近10件、商品別/全体履歴と商品/期間/種別/操作者フィルタを完成させる。
6. 操作者スナップショットとUTC境界、一覧と集計の母集団を確認する。

## 検証と完了

F-STOCK/F-DASHBOARD/F-HISTORYと一覧の残る条件を単体/DB/IPC/E2Eで検証してください。監査またはmovement失敗の注入、連続出庫、境界0/0・0/1・最低一致、改名/無効化後の操作者表示を含めます。

失敗時に商品・movement・auditの部分保存がなく、唯一の更新経路から全操作できれば完了です。未応答の更新を自動再送しないでください。文書を更新し、日本語で自動コミットしてください。
