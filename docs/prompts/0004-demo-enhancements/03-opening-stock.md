# 03: 商品登録時の初期在庫

GPT6-Luna［High］の実装者として [共通指示](README.md) に従う。

## 参照

- `docs/specs/0004-demo-enhancements/features/opening-stock.md`
- `src/shared/contracts/index.ts`、`src/shared/validation/index.ts`。
- `src/main/services/catalog.ts`、`src/main/services/inventory.ts`、DB移行、商品フォーム、商品/在庫テスト。

## 実装範囲

1. 作成専用CreateProductInputへinitialStockを追加する。UpdateProductInputの基底へ一括追加せず、編集DTOは現在庫/初期在庫を拒否する。
2. ADMINの新規登録フォームへ既定0の入力と検証を追加する。
3. 商品行は0で作成し、正数の場合に在庫サービスの内部OPENINGユースケースで在庫を増やす。同一外側トランザクションで商品・在庫・履歴・監査を確定する。
4. 0の場合はOPENINGなし。正数はreason OTHER、固定メモ、操作者スナップショットを保存する。
5. 新規移行で商品あたりOPENING最大1件の部分一意索引を追加する。既適用移行は変更しない。既存の重複があれば削除せず報告する。
6. 一般stock.recordへOPENINGを公開せず、一覧/履歴へ「初期在庫」を表示する。既存商品への初期在庫後付けは通常入庫/棚卸で行う。

## 検証・完了

0、正数、最大、小数/負数/型/上限違反、STAFF拒否、更新DTO拒否、連打、movement/audit失敗での商品作成全体rollbackを検証する。通常在庫操作を回帰確認する。

AC-OPENINGを満たし、pnpmのlint/型検査/該当単体・DB・商品E2Eが成功すること。現行仕様とバックアップの対応スキーマ上限も整合させ、対象変更を日本語で自動コミットして報告する。
