# 沖縄店舗在庫管理

店舗の商品と在庫を管理するWindowsデスクトップアプリです。商品・カテゴリ・利用者の管理、入庫・出庫・棚卸、在庫履歴、バックアップと復元ができます。

## 起動方法

Windows x64、Node.js 24.19.0、pnpm 12.14.0を使用します。初回セットアップにはネット接続が必要です。

```powershell
pnpm install --frozen-lockfile
pnpm run build
pnpm run dev
```

初回起動時に店舗名と管理者アカウントを登録します。同時にサンプルカテゴリ3件・商品6件が初期在庫とともに登録されます。次回以降は登録したログインIDとパスワードでログインします。

開発中のデータベースはリポジトリ直下の `store-inventory.sqlite` に作成されます。Electronでビルドした配布版では `%APPDATA%\沖縄店舗在庫管理\store-inventory.sqlite` に保存されます。
