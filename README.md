# MealTrack

筋トレ向けの食事管理PWAです。Phase1のMVPとして、食事記録、日別集計、履歴、テンプレート、備考、JSONバックアップに対応しています。

## フォルダ構成

- `index.html`: アプリの画面構造。今日、履歴、テンプレート、バックアップ用の画面と入力ダイアログを定義します。
- `styles.css`: スマホ優先の見た目。片手操作しやすい下部ナビゲーションと、モノクロ・青・水色基調のUIを管理します。
- `js/app.js`: 画面表示、入力、編集、削除、インポート/エクスポートなどのアプリ操作を担当します。
- `js/storage.js`: IndexedDBへの保存・取得を担当します。将来Firebaseへ移行する場合は、この層を差し替える想定です。
- `manifest.webmanifest`: ホーム画面追加用のPWA設定です。
- `sw.js`: オフライン動作用のService Workerです。
- `assets/icon.svg`, `assets/icon-192.png`, `assets/icon-512.png`: PWAアイコンです。

## データ設計

日付単位で `days` に保存します。

```text
2026-06-11
├ meals: 食事一覧
├ summary: 日別サマリー
└ note: 備考
```

テンプレートは `templates` に分離して保存しています。

## 公開方法

GitHub Pagesでは、このリポジトリのルートを公開対象にすれば動作します。HTTPS配信されるため、PWAとService Workerも有効になります。

## 今後の拡張ポイント

- 月別グラフ: `days` の日別サマリーを月単位で集計する画面を追加します。
- 体重・体脂肪率: `storage.js` に新しいストアを追加し、画面を分離して管理します。
- 目標設定・達成率: 目標用ストアを追加し、既存の `summary` と比較します。
- Firebase同期: `js/storage.js` と同じ関数を持つFirebaseアダプターを作り、UI層を変えずに差し替えます。
