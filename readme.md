# PDF-downloader
[岩手県入札情報公開サービス](https://www.pref.iwate.jp/kensei/nyuusatsu/kouji/1017384.html)から特定のPDFをダウンロードするスクリプト

> [!CAUTION]
> This repository has been moved to: https://github.com/kasseika/bid-info-downloader


# 機能
- 実行すると、インストールされたGoogle Chromeを自動操作してコンサルの案件から指定業務名の最新の100件を取得し、最新の案件のPDFをダウンロードする
- 設定ファイル(config.toml)を記述することでダウンロードの条件設定
  - 業務名キーワード
  - PDFタイトルキーワード
  - ダウンロード待機時間調整
- ログ機能
  - logs以下にシステムログを出力
- メール送信機能(Gmail)
  - ダウンロード結果をGmailから送信する
  - Google(Gmail)のアプリパスワードを発行することが必要

# 補足
- exeを実行したディレクトリにdataフォルダが作成され、案件ごとにディレクトリが作成される
- 現在、コンサル案件のみ
- あまりに低スペックだとダウンロードがうまくかないことがある
- 将来的に動かなくなる可能性はある
  - 岩手県の入札情報公開サービスの仕様変更
  - ダウンロード部分がChromeのAPIの仕様変更
  - 実行するPCの環境の変更
