# LearnHouseのGoogleドライブバックアップ

CORE-222のバックアップ運用。毎日06:00 JSTに取得し、06:30 JSTにGoogleドライブの所有者限定フォルダ `BACKUP/learnhouse` へ転送する。各世代の `learnhouse.tar.gz` にはPostgreSQL 16の論理ダンプ、アップロードした教材ファイル、Outline画像台帳を収める。講座・教材本文・受講者・提出・採点はDBに含まれる。転送Jobは保存先の所有権と、今回の保存に必要な空き容量を確認し、データ全体を読み戻してSHA-256が一致してから完了印 `COMPLETE.json` を登録する。

直近14日分を保持し、日数を過ぎた場合も最新の検証済み2世代を残す。期限を過ぎた検証済み世代はGoogleドライブのゴミ箱へ移す。未完了・同名重複・未知の世代は調査用に残す。教材PVCと台帳はDB取得の前後で照合し、変更を検出したらその世代を公開しない。DBとファイルシステムで共通のトランザクションはないので、切替・移行直前に整合した復元点が必要な場合は教材更新を止めてから単発取得する。

OutlineのR2原本は既存のOutlineバックアップで復旧する。Redis上の一時セッションやキャッシュは対象外。DB接続・OAuth・JWT・R2認証などのSecretは障害時に既存の運用経路で再登録する。アーカイブは利用者データを含むため、ダウンロードと復旧先は運用担当者に限定する。保存先は他の利用者と共有せず、アーカイブに追加の暗号化は施さない。

## 初回配備・再配備

`deploy/backup` はアプリ配備から独立したKustomize入口。転送JobはPlane名前空間で既存Outline用Drive認証を参照する。取得JobはLearnHouse名前空間でDBと教材PVCを読み取り、ステージングPVCに書き込む。転送JobにはそのステージングPVだけをノード上の読み取り専用パスで渡す。PVを再作成した場合は、下の手順で新しい割り当てを確認して再配備する。

Kustomizeは共通のDrive転送コードを `imagepit/platform` の `backup/` から取得する。以下の手順を実行する端末では、同リポジトリをHTTPSで読み取れるGit認証を設定する。

本番のJobは `/drive-common/drive_loader.py` を使う。ローカルで `LEARNHOUSE_DRIVE_TRANSPORT_DIR` を設定した場合は、そのディレクトリから読み込む。設定がなければ、リポジトリの親にある `platform/backup`、`imagepit/infra/backup`、`/Users/imagepit/Documents/imagepit/infra/backup` の順に探す。最後の2つは共有部品の移行期間中に使う。

1. 初回は停止状態でリソースを作成し、取得Jobを1回実行する。Jobが完了し、`stage=capture` と `result=verified` がそろうまで待つ。

   ```sh
   kubectl kustomize deploy/backup | kubectl --context mbp16 apply -f -
   kubectl --context mbp16 -n learnhouse create job learnhouse-backup-capture-manual \
     --from=cronjob/learnhouse-backup-capture
   kubectl --context mbp16 -n learnhouse logs -f job/learnhouse-backup-capture-manual
   ```

2. ステージングPVとノードの照合を含むレンダリングを使い、転送Jobを1回実行する。取得から6時間以内に起動する。Jobの完了と `stage=drive`、`result=verified` を確認し、出力の `generation` を控える。

   ```sh
   python3 deploy/backup/render.py | kubectl --context mbp16 apply -f -
   kubectl --context mbp16 -n plane create job learnhouse-backup-drive-manual \
     --from=cronjob/learnhouse-backup-drive
   kubectl --context mbp16 -n plane logs -f job/learnhouse-backup-drive-manual
   ```

3. ドライブから取得した世代を隔離環境で復元する。以下の `GENERATION` に転送Jobが返した識別子を設定する。Job引数の末尾にある `transfer` を `restore-check` に変更し、世代識別子を追記する。検証はJob内のローカルソケット限定の空PostgreSQLと空ディレクトリで行う。

   ```sh
   kubectl --context mbp16 -n plane create job learnhouse-backup-restore-check \
     --from=cronjob/learnhouse-backup-drive --dry-run=client -o json |
     jq --arg gen "$GENERATION" '
       .spec.template.spec.containers[0].args[-1] = "restore-check" |
       .spec.template.spec.containers[0].args += [$gen] |
       .spec.template.spec.volumes |= map(select(.name != "staging")) |
       .spec.template.spec.containers[0].volumeMounts |= map(select(.name != "staging")) |
       .spec.template.spec.nodeSelector = {"kubernetes.io/arch":"amd64"}
     ' | kubectl --context mbp16 apply -f -
   kubectl --context mbp16 -n plane logs -f job/learnhouse-backup-restore-check
   ```

4. 照合と復元が成功したら定時実行を有効にする。再配備時にも同じ入口を使う。予定外の単発実行は、対象CronJobと同じ処理が動いていないことを確認してから起動する。

   ```sh
   python3 deploy/backup/render.py --enable | kubectl --context mbp16 apply -f -
   kubectl --context mbp16 -n learnhouse get cronjob learnhouse-backup-capture
   kubectl --context mbp16 -n plane get cronjob learnhouse-backup-drive
   ```

5. 最初の定時実行は単発と区別して検収する。両Jobの `Complete`、当日の世代が一致すること、転送Jobの `retention` と `drive` が `verified` であることを確認する。運用を止める場合は両CronJobの `spec.suspend=true` を設定する。

## 日次監視

共通バックアップ台帳の `LH-CAP`（06:00）と `LH-DRIVE`（06:30）を朝の点検に含める。次のコマンドを両方の完了予定後に実行する。

```sh
python3 deploy/backup/monitor.py
```

共通の判定器でCronのUID、定時Job名、完了状態とログを確認する。手動で起動したJobや前日の世代は当日の成功に数えない。Drive転送の検証記録は、同じ日の取得Jobが返した世代、バイト数、SHA-256と一致する必要がある。

転送が正常なら、別の読み取り専用Jobで当日の世代をDriveから再確認する。完了印を読み戻し、アーカイブのメタデータを転送時の記録と照合する。フォルダまたはファイル欠落は `drive.result=missing`、認証や照合の失敗は `unconfirmed` とする。どちらも正常にはならない。監視Jobは定時の取得・転送を再実行しない。初回の定時検収では、これに加えて再取得と隔離復元も行う。

`--receipt-only` を付けると、監視Jobを作らずに共通判定の結果を取得する。定時Jobが正常な場合も、Driveを再照合するまで、このオプションで `healthy=true` は返さない。

## 障害時の復旧

Googleドライブから復元する世代の2ファイルを、運用担当者だけがアクセスできる新しいディレクトリへ取得する。`COMPLETE.json` の世代と `archive.bytes`・`archive.sha256` を実ファイルと照合し、アーカイブを展開する。対応するLearnHouseイメージとpgvector付きのPostgreSQL 16を準備する。

1. 新規DBへ `pg_restore --exit-on-error --no-owner --no-privileges` で `database.dump` を復元する。LearnHouse用の所有者・接続設定で投入し、同じDBに上書き復元しない。
2. 展開した `content/` の中身を新規PVCの `/app/api/content` へ復元する。`catalog.json` から `learnhouse-outline-image-catalog` ConfigMapを登録する。登録コマンドは[画像台帳の手順](../README.md#検証環境へ反映する)を参照する。
3. 復旧先で講座を開き、教材ファイル、Outline参照画像、受講・提出記録を照合する。Outline側にも障害がある場合は[Outline復旧手順](https://github.com/imagepit/imagepit/blob/main/ops/operation/outline-drive-backup.md)に従う。
