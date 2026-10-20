# 商品登録時の初期在庫

[索引](../README.md) / 要求 R-OPENING

## 入力と権限

ADMINの商品新規登録フォームへ「初期在庫数」を追加し、既定0、整数0〜2,147,483,647とする。小数・負数・上限超過・NaN・数値文字列のDTOをMainで拒否する。UIはフォーム値を検証して数値へ変換する。

既存の `ProductDraft` はUpdateProductInputの基底なので、そこへ初期在庫を一括追加しない。共通の商品属性型とは別に `CreateProductInput = ProductDraft & { initialStock: number }` を定義し、作成専用の検証を追加する。編集DTOはinitialStock/currentStockを含めず、未知フィールドも拒否する。

## 在庫サービスと原子性

CatalogServiceが値を直接INSERTして完了させず、在庫サービスの認可済み内部ユースケースへ委譲する。外側の同一IMMEDIATEトランザクション内で以下を実行する。

1. ADMIN認可、商品属性・初期在庫を検証する。
2. 商品行はcurrent_stock=0で作成し、商品作成監査を追加する。
3. initialStock>0のときだけ在庫サービス内部でOPENINGを記録する。before=0、delta=initialStock、after=initialStock、reason_code=OTHER、noteは「商品登録時の初期在庫」、Main側の操作者と時刻を保存する。
4. 在庫更新・movement・STOCK_RECORDED監査を保存する。これらは外側のトランザクションに参加し、別接続や独立commitに分けない。
5. 全体が確定してから最新の商品情報を返す。

0の場合は商品と商品監査のみ作り、OPENING履歴を作らない。正数の場合は商品監査・在庫監査とOPENING履歴を一組で残す。履歴/監査失敗や重複SKUなら商品作成から全体ロールバックする。

## 一度だけの条件

OPENINGは新規商品作成内部だけで呼べる。一般の `stock.record` は引き続きRECEIPT/ISSUE/ADJUSTMENTだけ許可し、STAFF/ADMINとも後からOPENINGを発行できない。サービス内部でも対象在庫0・既存履歴なしを確認する。

DBへ `movement_type='OPENING'` を条件としたproduct_idの部分一意索引を新しい移行で追加し、1商品につき最大1件とする。既存データで重複があれば黙って削除せず、移行を停止して報告する。初期在庫の0入力を後から修正する場合も通常の入庫/棚卸を使う。

一覧・履歴・ダッシュボードは作成確定後に再取得し、OPENINGの日本語表示を「初期在庫」とする。既存商品へ遡って初期履歴を捏造しない。

## 受け入れ条件 AC-OPENING

- 既定0では在庫0・履歴なし、正数では在庫とOPENINGのbefore/delta/afterが一致する。
- ADMINのみ作成可。商品編集や一般在庫APIへのinitialStock/OPENING指定を拒否する。
- 正数・0・最大・負数・小数・不正型・上限超過を検証する。
- movement/audit失敗時は商品行も残らず、連打で同じSKUの商品/初期履歴が重複しない。
- 既存DB移行、通常の入出庫/棚卸・監査の回帰を確認する。
