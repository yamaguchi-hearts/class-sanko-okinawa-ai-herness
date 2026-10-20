# 02: DEMOパスワードを4文字以上へ変更

GPT6-Luna［High］の実装者として [共通指示](README.md) に従う。

## 参照

- `docs/specs/0004-demo-enhancements/requirements/demo-password.md`
- `src/shared/validation/index.ts`、`src/main/auth/service.ts`、`src/renderer/main.tsx`。
- 認証・再設定・復旧の既存テストと0003認証設計。

## 実装範囲

1. 新規設定の下限4・上限128 Unicodeコードポイントを共有定数/検証へ集約する。
2. セットアップ、自分の変更、再設定コードからの本人設定に適用する。Mainが再検証する。現在パスワード/ログイン照合に新規設定の下限を適用しない。
3. 入力説明、エラー、確認欄、DEMO表示、READMEを整合させる。HTML minLengthだけに頼らない。
4. Argon2id、失敗待機、セッション、ロック、ロール、コード期限/一度限りは変更しない。DB移行や既存ハッシュの再生成はしない。

## 検証・完了

全設定入口で3/4/128/129文字、空欄、不一致、Unicode境界を検証する。4文字で初期設定と通常ログイン、本人変更、再設定が成功する。既存の12文字以上のパスワードも継続利用できる。

pnpmのlint/型検査/該当テストと認証E2Eを実行し、AC-DEMOを確認する。現行設計へ0004の参照を追加し、対象変更を日本語で自動コミットして報告する。
