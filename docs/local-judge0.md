# LearnHouseでPythonをローカル実行する

この構成はApple Silicon MacとOrbStackで、LearnHouseの単一ファイルPython演習をChromeから試すためのものです。受講者のPCでJudge0 API、実行ワーカー、Redis、PostgreSQLが起動します。APIの待ち受け先は `127.0.0.1:2358` です。

## 起動

以下のコマンドは、`scripts/local-judge0/` の4ファイルを同じHTTPS配布先へ置いてから使います。リリースごとに固定のURLを案内してください。

```sh
asset_url='https://配布先の固定URL'
curl -fsS "${asset_url}/setup.sh" -o setup.sh
bash setup.sh "$asset_url"
```

初回はJudge0のイメージを取得し、ARM64で動くPythonとIsolateを含むワーカーをビルドします。準備ができると、`Judge0 is ready` とローカル実行キーが表示されます。配布先からの取得をローカルで確認する場合は、`scripts/local-judge0/` をループバック上のHTTPサーバーから配布できます。

セットアップは既定で `https://learnhouse.image-pit.com` からの接続を許可します。ローカルのLearnHouseで確認する場合は、第2引数にそのオリジンを指定します。設定ファイルとキーは `~/.local/share/learnhouse-local-judge0/` に保存されます。起動スクリプトを同じオリジンで再実行すると、既存のキーを使います。

## LearnHouseから実行する

1. ChromeでLearnHouseにログインし、単一ファイルのPythonレッスンか、公開テストのあるPythonのCODE課題を開きます。
2. **このPCで実行**を押します。起動スクリプトに表示されたローカル実行キーを入力し、Chromeがローカル接続を確認したら許可します。
3. 標準出力や公開テスト結果を画面で確認します。このPCでの実行結果は練習用です。成績に使う正式な提出と採点は、従来の手順で行います。

ワーカーは単一プロセス、CPU実行時間1秒、実時間4秒、メモリ64,000 KBに制限します。提出コードのネットワーク接続は無効です。今回の構成で確認する言語はPythonです。JavaやNode.jsの教材、Safari、受講者別のAWS EC2は別途検証します。

## 停止

```sh
cd ~/.local/share/learnhouse-local-judge0
docker compose stop
```
