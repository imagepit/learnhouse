# LearnHouseのPoCをmbp16で動かす

[CORE-210](https://plane.itpit.net/imagepit/browse/CORE-210/)の検証用に、LearnHouse Community版をmbp16の `learnhouse` 名前空間に配備する。PostgreSQL 16・pgvector、Redis、教材ファイルはそれぞれ専用のPVCに保存する。アプリは1 Podで動く。データベースの初期化とマイグレーションはアプリの起動時に実行する。初期構築に使える[上流の1.4.5](https://github.com/learnhouse/learnhouse/releases/tag/1.4.5)のダイジェストをマニフェストに記録している。

## Cloudflare Access経由でログインする

[LearnHouseのログイン画面](https://learnhouse.image-pit.com/login)を開く。Cloudflare Accessで `r-takahashi@image-pit.com` のGoogleアカウントを使って認証し、LearnHouseで同じメールアドレスを入力する。初期パスワードは、配備を実行したMacのキーチェーンにある `LearnHouse mbp16 PoC` を参照する。新規に構築した場合は、構築時に入力したパスワードを使う。

### 公開経路を登録する

Cloudflare Zero Trustにセルフホスト型のAccessアプリ `LearnHouse` を作り、`learnhouse.image-pit.com` の全パスを保護する。Presentonと同じGoogleの認証方法を選び、許可ルールを `r-takahashi@image-pit.com` の完全一致にする。Accessアプリとポリシーを確認してからIngressを適用する。

```sh
kubectl --context mbp16 apply --dry-run=server -f deploy/k8s/ingress.yaml
kubectl --context mbp16 apply -f deploy/k8s/ingress.yaml
```

ログインしていない状態でトップページ、ログイン画面、APIがCloudflare Accessへ移ることを確認する。公開を止める場合は、Accessアプリを維持したままIngressを削除する。

## フォークから更新する

[Deploy LearnHouse](https://github.com/imagepit/learnhouse/actions/workflows/imagepit-deploy.yml)を `imagepit-1.4.5` で実行する。既定で[フォークの1.4.5ブランチ](https://github.com/imagepit/learnhouse/tree/imagepit-1.4.5)を使う。別の版を配備する場合は、フォークのブランチから参照できる40桁のコミットSHAを `source_sha` に指定する。

Actionsはlinux/amd64のCommunityイメージをビルドし、新しいPostgreSQLとRedisで起動する。ヘルスチェック、組織のログイン画面、管理者ログイン、pgvectorを確認する。イメージはDocker Hubの非公開リポジトリ `imagepit/learnhouse` にプッシュする。Actionsがダイジェストを `learnhouse-release` にコミットし、Argo CDが変更を検知してmbp16へ同期する。

プッシュにはこのリポジトリのGitHub Actions環境 `presenton-dockerhub` の認証情報を使う。Kubernetesでは、`learnhouse` 名前空間の `presenton-dockerhub` imagePullSecretに同じ読み取り認証を設定する。認証を更新する場合は、両方の名前空間のimagePullSecretを更新する。

## クラスタを新規に構築する

既設の環境では、この節の操作は不要。構築先に `standard` StorageClassとArgo CDがあり、Argo CDから `imagepit/learnhouse` を読み取れることを確認する。

名前空間とSecretを作る。以下はBash用。初期パスワードはパスワード管理ツールに保管した強いパスワードを入力する。

```bash
(
  set -e
  kubectl --context mbp16 apply -f deploy/k8s/namespace.yaml
  read -rs -p 'Initial admin password: ' admin_password
  printf '\n'
  test -n "$admin_password"
  postgres_password="$(openssl rand -hex 24)"
  redis_password="$(openssl rand -hex 24)"
  kubectl --context mbp16 -n learnhouse create secret generic learnhouse-env \
    --from-literal=POSTGRES_PASSWORD="$postgres_password" \
    --from-literal=REDIS_PASSWORD="$redis_password" \
    --from-literal=LEARNHOUSE_SQL_CONNECTION_STRING="postgresql://learnhouse:$postgres_password@learnhouse-postgres:5432/learnhouse" \
    --from-literal=LEARNHOUSE_REDIS_CONNECTION_STRING="redis://:$redis_password@learnhouse-redis:6379/0" \
    --from-literal=LEARNHOUSE_INITIAL_ADMIN_PASSWORD="$admin_password" \
    --from-literal=LEARNHOUSE_AUTH_JWT_SECRET_KEY="$(openssl rand -hex 32)" \
    --from-literal=NEXTAUTH_SECRET="$(openssl rand -hex 32)" \
    --from-literal=COLLAB_INTERNAL_KEY="$(openssl rand -hex 32)"
)
```

名前空間 `learnhouse` に、Presentonと同じDocker Hubの読み取り認証で `presenton-dockerhub` imagePullSecretを用意する。

Argo CDのApplicationを登録する。 `learnhouse-release` ブランチが存在することを確認してから実行する。

```sh
kubectl --context mbp16 apply --dry-run=server -k deploy/k8s
kubectl --context mbp16 apply -f deploy/application.yaml
```

Applicationが `Synced`、`Healthy` になり、3つのPVCが `Bound` になったことを確認する。

```sh
kubectl --context mbp16 -n argocd get application learnhouse
kubectl --context mbp16 -n learnhouse get pods,pvc
kubectl --context mbp16 -n learnhouse get pods \
  -o custom-columns='NAME:.metadata.name,IMAGE:.status.containerStatuses[0].imageID'
```

クラスタ内の応答を確認する場合は、ポートフォワードを開く。

```sh
kubectl --context mbp16 -n learnhouse port-forward --address 127.0.0.1 svc/learnhouse 18032:80
```

別の端末で `curl -fsS http://localhost:18032/api/v1/health` を実行し、`true` が返ることを確認する。ブラウザーでログインする場合は、Cloudflare Accessの公開URLを使う。

## 前の版に戻す

`learnhouse-release` のイメージ参照を直前の確認済みのダイジェストへ戻す。アプリは起動時にDBを更新するため、マイグレーションを伴う更新の前にはDBと教材ファイルをバックアップする。前の版が新しいスキーマに対応しない場合は、更新前のデータも復元する。

## バックアップ

日次の取得、Googleドライブ転送、隔離復元の手順は [バックアップ運用](backup/README.md) を参照する。

## Outlineの画像を非公開R2から表示する

[画像参照と配信の実装](https://plane.itpit.net/imagepit/browse/CORE-232/)を含むアプリ版を使う。
[配備と教材検収](https://plane.itpit.net/imagepit/browse/CORE-233/)にアプリSHA、確認件数、表示と拒否の結果を記録する。

### 認証と画像台帳を準備する

1. 運用担当者が、非公開バケット `outline-originals` に限定した R2 の Object Read 認証を安全な運用経路で登録する。登録先は `learnhouse` 名前空間の `learnhouse-outline-r2`。キー名は `access-key-id` と `secret-access-key`。既存のLearnHouse保存先は `filesystem`。
2. Outlineの認証済み読み取りで、文書ごとに公開済みリビジョンのMarkdownと添付メタデータを取得する。LearnHouseの編集者向けAPIで、移行対象のコース・アクティビティIDと、各アクティビティの `current_version` と `content` を取得する。教材を配信してよい画像かを運用担当者が確認する。
3. 同じ文書とアクティビティを結び、ローカルのアクセス制限付きJSONに次の構造で保存する。署名付きURLは台帳生成の入力にだけ使う。

```text
[
  {
    course_uuid, activity_uuid,
    activity_version: LearnHouseのcurrent_version,
    activity_content: LearnHouseのTipTap JSON,
    outline_document: {id, revision, markdown},
    attachments: [{id, document_id, signedUrl, contentType, size}]
  }
]
```

`document_id` はOutlineで対象文書に紐づくことを確認した添付の所属文書ID。添付が複数箇所に出現するときは、同じ文書の添付メタデータを一度だけ入れる。LearnHouseのIDにはAPIが返す `course_` と `activity_` の接頭辞を含める。

4. 専用のR2認証を外部へ出力しない実行環境で、`LEARNHOUSE_OUTLINE_R2_ENDPOINT`、`LEARNHOUSE_OUTLINE_R2_ACCESS_KEY_ID`、`LEARNHOUSE_OUTLINE_R2_SECRET_ACCESS_KEY` を供給して、次を実行する。

```sh
uv run deploy/prepare-outline-image-plan.py snapshot.json --out image-plan
```

`catalog.json` はアクティビティと添付からR2上の画像を特定する。 `updates.json` は更新前後の教材を保持する。処理はR2のHEADでサイズと型を照合する。両ファイルの保存先を運用者に限定する。署名付きスナップショットは照合後に保管期限に従って処理する。

### 検証環境へ反映する

1. 良輔がマージしたアプリと配備設定の版を承認済みのGitOps手順で配備する。台帳未登録でも通常のレッスン、既存のアップロード画像、ヘルスチェックが応答することを確認する。
2. まず未公開の検証用レッスンと自習演習に紐づく台帳を登録する。クラスタに適用する前に、同じ名前のConfigMapの現行版を保管する。

```sh
kubectl --context mbp16 -n learnhouse create configmap learnhouse-outline-image-catalog \
  --from-file=catalog.json=image-plan/catalog.json \
  --dry-run=client -o yaml | kubectl --context mbp16 -n learnhouse apply -f -
kubectl --context mbp16 -n learnhouse rollout restart deployment/learnhouse
kubectl --context mbp16 -n learnhouse rollout status deployment/learnhouse
```

3. 対象の編集を止め、新しいOutlineとLearnHouseのスナップショットを取り直す。次の照合が成功したら、LearnHouseの既存API `PUT /api/v1/activities/{activity_uuid}` で、各更新案の `after` を `content` として適用する。更新APIに条件付き書き込みはないため、照合から読み戻しまで人と自動処理の編集を止める。1件ずつ保存し、バージョンと内容を読み戻してから次へ進む。

```sh
uv run deploy/prepare-outline-image-plan.py fresh-snapshot.json \
  --check-current image-plan/updates.json
```

4. Outlineにログインしていない閲覧許可済みアカウントで、レッスンと演習をChromeとSafariで開く。ブラウザーのネットワーク検査で次を確認する。
   - PNG・SVGが表示され、画像リクエストはLearnHouseの同一オリジンを通ってR2に転送される。LearnHouseの302とR2の200に `Cache-Control: private, no-store` がある。SVGのR2応答には `Content-Type: image/svg+xml` と `Content-Disposition: attachment` がある。
   - SVGを個別に開くとダウンロードになる。他の受講者のセッションを借りず、台帳外の画像、別レッスンの画像、閲覧権限のない利用者が拒否されることを確認する。発行から60秒を過ぎたURLは失効し、通常のキャッシュ設定で再読み込みすると権限が再確認される。
   - 同じレッスンで署名なしのR2要求が拒否される。教材の画像追加前後でLearnHouseの教材ストレージの画像ファイル件数を比べる。R2にGET以外の書き込みが発生しないことを確認する。
5. 各形式が合格した後、テキスト全6章の173参照を照合する。最多90画像のレッスンで表示時間とDBプール待ちを記録する。ヘッダーの保証やSVGの表示を確認できない場合はその形式の切り替えを保留する。証拠を保存する際はURLの署名、Cookie、R2キーを含めない。

### 画像参照を切り戻す

1. 対象を編集停止にし、移行後に別の編集が入っていないことを確認する。適用したアクティビティを既存のバージョン履歴または `updates.json` の `before` で戻し、本文を読み戻す。
2. 前の台帳を再適用してPodを再起動する。LearnHouseが起動し、取り消した添付IDには新しく署名を発行しないことを確認する。発行済みの署名付きURLの有効期限は発行から60秒。
