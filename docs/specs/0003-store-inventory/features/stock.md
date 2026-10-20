# 入庫・出庫・棚卸調整

[設計索引](../README.md) / 対応: 原Plan §3.4、§7.1

## 要求 F-STOCK

有効商品の在庫操作をADMIN/STAFFが行う。全数量は整数で、入庫・出庫は1以上、棚卸の実数は0以上。上限はDB設計に従う。`products.current_stock` を更新する唯一の経路は在庫ユースケースサービスとし、商品編集や汎用Repository更新で直接変更させない。

| 種別 | 入力 | deltaと結果 |
| --- | --- | --- |
| RECEIPT | quantity | delta=+quantity、stock_after=before+quantity |
| ISSUE | quantity | delta=-quantity、afterが負なら拒否 |
| ADJUSTMENT | countedStock | delta=countedStock-before、after=countedStock |
| OPENING | 一般在庫APIでは入力不可。0004の新規商品作成内部ユースケースのみ | 初期在庫が正数の場合にbefore=0として一度だけ記録 |

棚卸差分0も実施した記録として保存する。入出庫の0は拒否する。在庫上限超過は `VALIDATION_ERROR`、不足は `INSUFFICIENT_STOCK`、無効商品は `INACTIVE_ENTITY`。

理由コードは `DELIVERY`（入荷）、`RETURN`（返品）、`DAMAGE`（破損）、`EXPIRED`（期限切れ）、`STOCKTAKE`（棚卸差異）、`OTHER`（その他）の固定列挙とする。原Planは組合せ制限を定めていないため、初期版では全種別に全理由を選択可能とし、棚卸はSTOCKTAKEを初期提示する。メモは任意、最大2,000文字。

## トランザクション

1. IPCで発信元・セッション・ロール・DTOを検証する。
2. 書込みトランザクション内で商品存在と有効性を再確認し、最新在庫を読む。
3. 種別・差分・範囲を純粋ドメイン関数で検証する。
4. 商品の現在庫とupdated_atを更新する。
5. movementに種別・差分・before/after・理由・メモ・Main側操作者IDとログインID/表示名スナップショットを追加する。
6. 同じトランザクションで監査イベントを追加し、確定後に最新在庫とmovementを返す。

どの段階の失敗も全更新をロールバックする。数量の古い画面表示を計算根拠にせず、連続出庫もDB内の最新値から計算する。UI送信中は重複クリックを止める。応答不明の更新を自動再送せず、最新在庫・履歴を再取得してから再実行を判断する。

履歴の編集・削除APIは作らない。誤入力は逆方向の操作か新たな棚卸調整で訂正し、理由とメモに訂正理由を残す。

## 受け入れ条件

F-STOCK-01: 入庫、残数ちょうどの出庫、超過出庫拒否、実数0の棚卸、差分0、上限/小数/負数/無効商品を検証する。

F-STOCK-02: movementまたはaudit挿入失敗を注入し、商品・movement・auditが部分保存されない。

F-STOCK-03: 連続操作で古い現在庫を上書きせず、履歴のbefore+delta=afterと操作者スナップショットが一致する。
