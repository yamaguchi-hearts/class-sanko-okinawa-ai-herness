# 04: 商品画像

GPT6-Luna［High］の実装者として [共通指示](README.md) に従う。初期在庫の作成専用DTOとの統合が前提。

## 参照

- `docs/specs/0004-demo-enhancements/features/product-images.md`
- `docs/specs/0004-demo-enhancements/delivery/integration.md`
- 商品のcontracts/validation/catalog/フォーム、Main IPC/Preload、監査、DB移行。
- `src/main/services/maintenance.ts` と復旧ツールのスキーマ検証、バックアップ/復元テスト。

## 実装範囲

1. 新規移行にproduct_imagesを作成し、既存商品を画像なしで維持する。
2. Mainファイルダイアログ、5MiB/4,096辺上限、PNG/JPEG実体/ヘッダー/デコード検証、PNG正規化を実装する。必要なパーサーは互換版を確認して固定する。
3. 本人/webContents限定・10分期限・1ウィンドウ1枚の保留選択IDを実装し、キャンセル/破棄/失効を扱う。Rendererに任意ファイルパスAPIを渡さない。
4. products.createにimageSelectionId、updateにKEEP/REMOVE/REPLACEを加え、商品・画像・初期在庫・全監査を一括保存する。別APIで画像だけ先に保存して部分成功にしない。
5. ADMINの選択/プレビュー/差替え/削除、両ロールの参照/画像なし表示、表示ページだけの遅延取得を実装する。ロック/ログアウト/復元で候補とキャッシュを消去する。
6. PRODUCT_IMAGE_SET/PRODUCT_IMAGE_REMOVEDの監査を記録し、本体・元ファイル名/パスをログへ出さない。CSPは画像データ表示に必要な範囲だけ変更する。一覧は最大128×128サムネイルを使い、全元画像を取得しない。
7. 復元検査の対応バージョンと画像検証を更新し、旧DBの移行とSQLiteバックアップへの画像包含を確認する。

## 検証・完了

AC-IMAGEの正常/拒否/失敗を単体・DB・IPC・E2Eで検証する。画像の追加/置換/削除/キャンセル、偽装・破損・上限・期限/本人違い、STAFF拒否、監査失敗での旧画像保持を含める。

画像/初期在庫付き商品をバックアップし、変更後に復元・再起動して組合せが戻ること。pnpm lint/型検査/該当テストと配布版画像表示を確認し、対象変更を日本語で自動コミットして報告する。
