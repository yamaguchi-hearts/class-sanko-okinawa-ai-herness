# 商品画像

[索引](../README.md) / 要求 R-IMAGE

## 機能とUI

設計判断として1商品に任意の1枚を登録する。ADMINは商品登録時の選択と、編集時の追加・差替え・削除ができる。STAFFは一覧/商品参照の画像閲覧のみ。商品無効化時も画像は保持し、ADMINによる画像変更は商品情報編集と同じ扱いで許可する。

商品フォームに選択・プレビュー・差替え・削除・未登録状態・入力エラーを設ける。保存前の取消では既存画像を変えない。一覧は固定枠のサムネイルと画像なし表示を使い、商品名を代替テキストにする。画像バイナリを全件一覧DTOへ埋め込まない。

画像の複数枚、撮影、URL取込、クラウド、SVG/GIF/WebP、トリミング/加工UIは今回の対象外。

## 取込・正規化

MainでPNG/JPEG専用のファイル選択ダイアログを開く。入力上限5MiB、各辺1〜4,096ピクセルとする。拡張子だけでなくシグネチャ、ヘッダー寸法、実デコードを検証する。読取前のサイズ検査だけでなく読取後にも上限を確認する。

寸法をヘッダーから事前確認できる保守されているパーサーを選び、上限超過画像をデコード前に拒否する。ElectronのnativeImage等でデコードし、静止PNGへ正規化する。正規化後も5MiB・寸法上限を超える場合は拒否し、自動縮小はしない。デコード失敗・偽装・切断データは既存画像を保ったまま入力エラーにする。

ファイルパスやファイル名はDB・監査へ保存しない。Mainで正規化済み画像を一時メモリへ保持し、選択ID・プレビューだけを返す。選択IDは本人セッション/webContentsに結び、10分で失効、ログアウト/ロック/復元で破棄する。1ウィンドウにつき保留画像1枚に制限し、再選択は旧候補を破棄する。キャンセルは正常結果とする。

## 保存方式・マイグレーション

DEMOの単一画像・容量制限に合わせ、画像をSQLite BLOBに保存する。外部ディレクトリを追加せず、既存のSQLiteバックアップ/復元に画像も含める。

新規移行で `product_images` を作る。

| カラム | 制約 |
| --- | --- |
| product_id | TEXT PRIMARY KEY、products(id)へのFK、ON DELETE RESTRICT |
| content | BLOB NOT NULL、typeof(blob)、lengthが1〜5,242,880 |
| mime_type | TEXT NOT NULL、image/png固定 |
| width / height | INTEGER NOT NULL、整数・1〜4,096 |
| updated_at | UTC ISO 8601 TEXT NOT NULL |

既存商品には画像行を作らない。画像なしをnullとして扱い、画像の存在は一覧DTOの `hasImage` と `imageUpdatedAt` で返す。画像削除は商品画像行だけを削除し、商品/履歴/監査は維持する。

## IPC・保存の契約

以下は既存の用途別APIへの追加とする。発信元・DTO・セッション・現在ロールのMain検証を継承する。

| 契約 | 入出力 | 許可 |
| --- | --- | --- |
| `productImages.select` | Mainダイアログ→cancelled、またはselectionId/寸法/PNGプレビュー | ADMIN |
| `productImages.discardSelection` | 本人の保留selectionIdを破棄 | ADMIN |
| `productImages.get` | productIdとvariant（THUMBNAIL/DETAIL）→null、またはPNGデータURLとupdatedAt | 両ロール |
| `products.create` | 作成属性+initialStock+imageSelectionId（null可） | ADMIN |
| `products.update` | 編集属性+imageChange（KEEP/REMOVE/REPLACE+selectionId） | ADMIN |

画像の保存・削除を商品保存と同一トランザクションに含め、商品登録+初期在庫+画像が全て保存されるか全て失敗するようにする。期限/本人/選択IDを保存直前に再検証し、確定後にだけ選択IDを消費する。失敗後は有効期限内なら本人が再試行できる。

画像更新・削除の監査は `PRODUCT_IMAGE_SET` / `PRODUCT_IMAGE_REMOVED` とし、商品ID、寸法、バイト数、置換/追加の種別だけを許可する。画像本体・データURL・元パスを記録しない。画像以外を編集する場合はKEEPを明示する。

THUMBNAILはMainで縦横比を維持して最大128×128へ縮小したPNGとし、元画像を一覧へ返さない。DETAILは元の正規化済みPNGを返し、同時に表示する詳細プレビューは1枚とする。

画像取得は表示中ページの画像がある商品だけを遅延取得し、最大同時取得4件とする。キャッシュは現在ページのサムネイルと現在の詳細1枚、画像updatedAtに限定し、離脱・ロック・ログアウト・復元で消去する。データURLの許可はCSPのimg-srcに必要最小限だけ加え、script-srcを緩めない。任意URL・file://参照を公開しない。

## バックアップ・復旧への影響

同一DBのBLOBなので通常のSQLiteスナップショットに含まれる。復元候補検査へ新スキーマと画像のサイズ/型/寸法・PNGヘッダー整合を追加する。既存コードの固定schema上限は最新マイグレーション定義に基づく対応上限へ変更し、画像なし旧DBはコピー上で移行して受け付ける。現行のschema versionは7である。

## 受け入れ条件 AC-IMAGE

- PNG/JPEGの選択、登録・再起動表示、差替え、削除、キャンセルと画像なし表示が動く。
- サイズ/寸法境界、偽拡張子、破損、期限切れ・他セッションの選択ID、不正パス指定を拒否する。
- STAFFの閲覧は可、取込・変更は直接IPCでも拒否する。ロック後にキャッシュが残らない。
- 商品/初期在庫/画像/監査のいずれかの失敗で全体が戻り、元画像を失わない。
- バックアップ→差替え/削除→復元→再起動で画像と商品/在庫の組が戻る。旧版DB復元も成功する。

## 根拠

PNG/JPEGのデコードとPNG化には [Electron nativeImage公式API](https://www.electronjs.org/docs/latest/api/native-image) を参照する。画像正規化後のサイズやメタデータの扱いは採用実装で確認し、読取時の上限検証を省かない。
