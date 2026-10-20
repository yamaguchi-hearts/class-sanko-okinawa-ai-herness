# Phase 2: 商品・カテゴリ・ユーザー管理

GPT6-Luna［High］の実装者として、[共通指示](README.md) とPhase 1の成果を確認してください。

## 参照資料

- `docs/specs/0003-store-inventory/README.md`。
- 同配下 `requirements/scope-and-roles.md`、`requirements/user-interface.md`、`architecture/database.md`、`architecture/ipc.md`。
- 同配下 `features/catalog.md`、`features/users-and-recovery.md`、`features/inventory-and-history.md`、`features/audit.md`、`delivery/verification.md`。

## 実装

1. categories/productsの新規移行とRepositoryを追加する。既適用移行は書き換えない。
2. ADMIN専用の商品登録・編集・無効化、SKU正規化/重複制約、カテゴリ選択、初期在庫0、自由入力単位を実装する。
3. ADMIN専用のカテゴリ作成・名称変更・無効化を作る。無効カテゴリに属する商品の表示・編集と、新規選択禁止を両立する。
4. 両ロール用の商品一覧、SKU/名称検索、カテゴリ/状態フィルタ、安定ソート、ページング、空/読込/失敗状態を作る。低在庫・履歴の本格フローはPhase 3と接続する。
5. Phase 1のユーザーサービスを再利用し、一覧・追加・表示名/ロール変更・無効化・コード発行/一度だけ表示の管理画面を完成させる。
6. 商品・カテゴリ・ユーザー変更と監査の原子性、セッション失効、最後のADMIN保護をUIと直接IPCの両方で確認する。

## 検証と完了

F-PRODUCT、F-CATEGORY、F-USERS、F-LISTの対象条件を単体/DB/IPC/E2Eで検証してください。STAFFの商品更新/管理操作拒否、無効化済みSKUとの重複、無効カテゴリ保持、検索の特殊文字、ページ境界を含めます。

商品編集でcurrent_stockを書けず、ADMINだけが管理でき、論理無効化で履歴参照が壊れないことを確認して完了とします。文書を更新して日本語で自動コミットしてください。
