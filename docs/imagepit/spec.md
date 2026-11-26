# IMAGEPIT版LearnHouseの独自仕様

[IMAGEPIT版の入口](../../IMAGEPIT.md) / [アーキテクチャ](architecture.md)

上流1.4.5の基点`6e5f3d20`から、確認時点の`df94f0a4`までの履歴と実装に基づく仕様です。機能の存在と、配備先で有効かどうかは区別します。履歴はリポジトリ直下の`git log --oneline 6e5f3d20..HEAD`で追跡できます。

## 独自機能の一覧

| 機能 | 主な仕様 | 追加・改変履歴 |
| --- | --- | --- |
| 教材向けリッチMarkdown | 課題説明、解説、設問とレッスン用ブロックにMarkdown表示を追加。学習用コールアウト、手順、コード、ファイルツリー、Mermaidに対応 | `ab7921eb`、`3c352804` |
| Outline画像 | アクティビティの閲覧権限と台帳による認可、R2原本、任意のWebPプレビュー、遅延読み込み、拡大表示 | `40337ccc`、`79f78bd4`、`54635706`、`c5cfd2de` |
| 章リーダー | H2でレッスンを分割し、固定目次と前後のセクション移動を提供 | `142105c8` |
| 確認クイズ | 条件を満たすクイズを1問ずつ表示し、最後に提出。解説と正解は採点・公開条件に従って表示 | `6e3bc7f0`、`7fa4cc14` |
| 成績表・レポート | 章ごとの課題・成績表示と、企業・開催回別PDF・CSV | `b8b17345`、`1b6412be`、`463143bc`、`26afd6b2` |
| ローカルJudge0 | 単一ファイルPythonと公開テストを受講者PCで練習 | `5be122a8` |
| 計測・配備・復旧 | DB接続取得の計測、同時負荷試験、Community版のGitOps配備、Driveバックアップ | `895adcdf`、`8b72a5eb`、`f9ebdb51` |

## 教材向けリッチMarkdown

課題の説明・解説とタスク説明は`plain`と`markdown`を持ち、既存データの既定値は`plain`です。設問にも形式を保持します。Markdownは最大100,000文字で、APIが保存時に検証します。レッスンのTiptapエディターにはリッチMarkdownブロックを追加しています。

表示はGFM、学習用コールアウト、手順、ファイルツリー、注釈付きコードとコピー、Mermaid図に対応します。MermaidはPeleで描画します。HTMLは`skipHtml`で除外し、形式がMarkdownでない場合や表示上限を超えた場合はプレーンテキストで表示します。

デザインシステムから必要な部品とスタイルをコピーして、`apps/web/components/Objects/RichMarkdown/vendor/`と`apps/web/styles/rich-markdown.css`で管理します。取り込み元の基点は`imagepit/design-system@8d0629a66b413a733993b9fe538a14e41b291508`です。対応ソースと再配布の扱いは[フォーク方針](../../IMAGEPIT-FORK-POLICY.md)と[取り込み元の記録](../../apps/web/components/Objects/RichMarkdown/vendor/SOURCE.md)に従います。

仕様の根拠は[DB定義](../../apps/api/src/db/courses/assignments.py)、[保存時の検証](../../apps/api/src/services/courses/activities/assignments.py)、[Markdown表示](../../apps/web/components/Objects/RichMarkdown/RichMarkdown.tsx)、[レッスン用ブロック](../../apps/web/components/Objects/Editor/Extensions/RichMarkdown/RichMarkdownBlock.ts)です。

## Outline画像の認可・配信

Outlineの添付画像は、コースUUID・アクティビティUUID・添付IDを画像台帳に登録して参照します。台帳の形式は`version: 1`と`images`配列です。各行に`course_uuid`、`activity_uuid`、`attachment_id`、`object_key`、`content_type`を保持します。実際の台帳や署名付きURLはこの文書に掲載しません。

| 項目 | 仕様 |
| --- | --- |
| 一括認可 | `POST /api/v1/courses/{course_uuid}/activities/{activity_uuid}/outline-images`。添付IDを1〜32件、幅を640または1200で指定 |
| 原本取得 | `GET /api/v1/courses/{course_uuid}/activities/{activity_uuid}/outline-images/{attachment_id}`。閲覧権限と台帳の照合後、R2へ302で転送 |
| 有効期間 | APIが発行する署名付きURLとプレビューチケットは60秒 |
| 原本の対応形式 | PNG、JPEG、GIF、WebP、SVG。拡張子とMIME型を照合 |
| 変換 | 設定がある場合にPNG・JPEGを640pxまたは1200px以下のWebPへ変換。Workerの原本サイズ上限は20,000,000バイト |
| Worker認証 | APIと共有するAES-GCM用の鍵で暗号化したチケットを検査。認証後に原本ETag・幅・変換条件に対応したキャッシュを確認 |
| クライアントへの応答 | `Cache-Control: private, no-store`。SVG原本は`Content-Disposition: attachment` |
| 原本への切り替え | SVGなどの形式、拡大表示、プレビュー変換失敗時は原本を使用 |
| 設定不足時 | R2または台帳の設定が足りない場合は画像配信を無効化。Worker設定を外すとR2原本の表示へ戻る |

本文表示範囲に近い画像から認可し、レッスンの画像ブロックの本文表示幅は最大600pxです。手順内のMarkdown画像にもプレビューと原本の拡大表示を使います。

教材移行では、公開済みのOutlineリビジョンとLearnHouseの版・本文をスナップショットとして照合します。台帳生成時にR2のHEADで型とサイズを確認します。教材更新APIに条件付き書き込みはないため、再照合から更新・読み戻しまで対象の編集を止めます。手順は[配備文書](../../deploy/README.md)を参照してください。

実装は[APIルーター](../../apps/api/src/routers/external_activity_images.py)、[台帳と署名処理](../../apps/api/src/services/media/outline_images.py)、[Webの一括認可](../../apps/web/services/media/outlineImagePreviews.ts)、[画像ブロック](../../apps/web/components/Objects/Editor/Extensions/Image/ImageBlockComponent.tsx)、[Worker](../../apps/outline-image-worker/worker.mjs)にあります。

## 章リーダーと確認クイズ

章リーダーはTiptap本文のH2をセクションの境界にします。見出しから移動用IDを作り、同じ見出しが複数ある場合は連番で区別します。固定目次、H3〜H6への移動、前後のセクション移動を提供します。根拠は[分割処理](../../apps/web/components/Objects/Activities/DynamicCanva/lessonSections.ts)と[リーダー](../../apps/web/components/Objects/Activities/DynamicCanva/LessonSectionReader.tsx)です。

1問ずつの表示は、課題が単一の`QUIZ`タスクだけで構成され、そのタスクに2問以上ある場合に適用します。回答を保存して次へ進み、最後の設問の回答後に提出できます。複数タスクを持つ課題はこの表示条件に含みません。

正解表示は`GRADED`かつ`show_correct_answers`が有効な場合に行います。クイズの解説パネルは再試行が残っていないことを条件とし、提出時または採点後という`solution_reveal`の設定にも従います。解説と正解の表示条件は別です。

根拠は[対象クイズの判定](../../apps/web/components/Objects/Activities/Assignment/assignmentUI.ts)、[クイズ表示](../../apps/web/app/orgs/[orgslug]/dash/assignments/[assignmentuuid]/_components/TaskEditor/Subs/TaskTypes/TaskQuizObject.tsx)、[課題表示](../../apps/web/components/Objects/Activities/Assignment/AssignmentStudentActivity.tsx)です。

## 成績表と企業・開催回別レポート

コース管理の成績表は、組織内の受講者と課題を読み取り、章ごとに表示します。複数の提出記録がある旧データでは、試行回数が多い記録、同数なら新しい記録を優先します。成績の閲覧には、コースの更新権限と`grade_assignments`権限が必要です。

企業別の出力対象は、コースに紐づく`企業名 / 開催回`形式のユーザーグループです。両側の名前が空でないグループを候補にし、同じ企業・開催回が重複する候補は除外します。選択対象が候補に一致しない場合は404、対象受講者が別の対象グループにも重複する場合や受講者がいない場合は409を返します。

PDF・CSVには企業、開催回、受講者、受講進捗、課題の成績・提出状況を出力します。CSVはUTF-8 BOM付きで、数式として解釈される可能性があるフィールドの先頭にアポストロフィを付けます。PDFはNoto CJKフォントを使います。

APIは`GET /api/v1/courses/{course_uuid}/gradebook`、候補一覧は同パスの`GET /report-cohorts`、出力は`POST /report.pdf`または`POST /report.csv`です。出力時には対象の`group_id`、`company`、`session`をJSONで指定します。実装は[APIルーター](../../apps/api/src/routers/courses/courses.py)、[成績集計](../../apps/api/src/services/courses/course_gradebook.py)、[企業別出力](../../apps/api/src/services/courses/course_report.py)にあります。

## 受講者PCのJudge0

単一ファイルPythonのレッスンと、公開テストを持つCODE課題でローカル実行を使います。課題では出題者がローカル実行を有効にし、公開テスト合格を保存条件にしていないことが必要です。

ブラウザーは`http://127.0.0.1:2358`へ接続し、利用者が入力したローカル実行キーを`sessionStorage`に保持します。練習結果は正式な成績には使いません。今回の構成で確認する対象はApple Silicon Mac、OrbStack、Chrome、Pythonです。

実行ワーカーは単一プロセス、CPU実行時間1秒、実時間4秒、メモリ64,000 KBに制限し、提出コードのネットワーク接続を無効にします。Java、Node.js、Safari、受講者別EC2は別途検証する扱いです。根拠は[既存手順](../local-judge0.md)、[Webの実行処理](../../apps/web/services/code/localJudge0.ts)、[Compose設定](../../scripts/local-judge0/compose.yaml)です。

## 計測・配備・バックアップ

同時負荷計測では、20人の独立した利用者、90画像参照を持つ3セクションのレッスン、10問のクイズを用意します。既定の段階は1・5・10・20人で、画像表示と最終提出が重なる試行を記録します。これは[専用環境で実行する計測手順](../../apps/e2e/README.md)であり、本番で保証する性能値ではありません。

`LEARNHOUSE_MEASURE_DB_ACQUIRE=1`で、負荷試験に対応するDBプールの接続取得時間を計測します。接続待ち・新規接続・接続確認を含み、その後の業務SQL実行時間は含みません。実装は[DBイベント処理](../../apps/api/src/core/events/database.py)です。

IMAGEPITの配備は手動Actions、非公開Docker Hub、`learnhouse-release`、Argo CDの順で進みます。日次バックアップはDB・教材・画像台帳を取得し、Drive転送後に読み戻して照合します。詳細は[構成文書](architecture.md)、[配備手順](../../deploy/README.md)、[バックアップ運用](../../deploy/backup/README.md)を参照してください。

## 主要環境変数

変数名と用途を示します。接続文字列、鍵、トークン、署名付きURLの実値は文書や共有ログに記録しません。

| 変数・binding | 用途・条件 |
| --- | --- |
| `LEARNHOUSE_SQL_CONNECTION_STRING` | PostgreSQL接続。Secretから供給 |
| `LEARNHOUSE_REDIS_CONNECTION_STRING`、`LEARNHOUSE_REDIS_URL` | APIと共同編集などで使うRedis接続。配備マニフェストで後者に前者を展開 |
| `LEARNHOUSE_AUTH_JWT_SECRET_KEY`、`NEXTAUTH_SECRET`、`COLLAB_INTERNAL_KEY` | API認証、Web、共同編集用のSecret |
| `LEARNHOUSE_INITIAL_ADMIN_PASSWORD` | 初期構築時の管理者パスワード。Secretから供給 |
| `LEARNHOUSE_DOMAIN`、`LEARNHOUSE_FRONTEND_DOMAIN`、`LEARNHOUSE_ALLOWED_ORIGINS`、`LEARNHOUSE_SSL`、`NEXTAUTH_URL` | 公開ドメイン、許可オリジン、HTTPS、Web認証URL |
| `LEARNHOUSE_INTERNAL_API_URL`、`LEARNHOUSE_API_URL` | サーバー内のAPI接続先。サーバー側認証は内部URLを使用 |
| `NEXT_PUBLIC_LEARNHOUSE_API_URL`、`NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL`、`NEXT_PUBLIC_COLLAB_URL` | ブラウザーに渡すAPI・バックエンド・共同編集の接続先 |
| `LEARNHOUSE_CONTENT_DELIVERY_TYPE` | PoCの教材保存先は`filesystem` |
| `LEARNHOUSE_TENANCY`、`NEXT_PUBLIC_LEARNHOUSE_MULTI_ORG`、`NEXT_PUBLIC_LEARNHOUSE_DEFAULT_ORG` | PoCは単一組織。Webの既定組織を指定 |
| `LEARNHOUSE_IS_AI_ENABLED`、`LEARNHOUSE_MCP_ENABLED` | コミット済みのPoC設定では両方無効 |
| `LEARNHOUSE_OUTLINE_R2_ENDPOINT`、`LEARNHOUSE_OUTLINE_R2_BUCKET` | Outline原本のR2接続先とバケット |
| `LEARNHOUSE_OUTLINE_R2_ACCESS_KEY_ID`、`LEARNHOUSE_OUTLINE_R2_SECRET_ACCESS_KEY` | Outline原本の読み取り専用認証。Secretから供給 |
| `LEARNHOUSE_OUTLINE_IMAGE_CATALOG` | 画像台帳JSONのファイルパス |
| `LEARNHOUSE_OUTLINE_IMAGE_WORKER_ORIGIN`、`LEARNHOUSE_OUTLINE_IMAGE_PREVIEW_KEY` | 任意の画像変換を有効化。WorkerのHTTPSオリジンと64桁16進数の専用鍵 |
| Workerの`PREVIEW_KEY`、`OUTLINE_ORIGINALS`、`IMAGES` | APIと共有するWorker Secret、非公開R2 binding、Images binding |
| `LEARNHOUSE_REPORT_FONT` | PDF出力用のフォントパス。既定はイメージ内のNoto CJK |
| `LEARNHOUSE_MEASURE_DB_ACQUIRE` | `1`で同時負荷試験のDB接続取得計測を有効化 |

根拠は[PoCの非Secret設定](../../deploy/k8s/learnhouse.env)、[Secret参照](../../deploy/k8s/workload.yaml)、[内部認証API](../../apps/web/app/api/auth/[...path]/route.ts)、[画像サービス](../../apps/api/src/services/media/outline_images.py)、[Worker設定](../../apps/outline-image-worker/wrangler.toml)です。画像変換用の任意Secretは[Argo CD Application](../../deploy/application.yaml)からも参照します。

## 上流との差分と運用上の制約

| 主な差分箇所 | 変更内容・制約 |
| --- | --- |
| `apps/web/components/Objects/RichMarkdown`と`apps/web/styles` | IMAGEPITから取り込んだ教材表現。更新は部品と依存を選んで再取り込み |
| `apps/api/src/db/courses/assignments.py`と`apps/api/migrations/versions` | Markdownの形式を保持する列とマイグレーション。旧データは`plain`を既定とする |
| `apps/web/components/Objects/Activities`と課題エディター | 章リーダー、順次クイズ、正解・解説表示条件、ローカル実行UI |
| `apps/api/src/services/courses/course_gradebook.py`と`course_report.py` | 成績表と企業別出力。コース権限、組織、対象グループを検査 |
| `apps/api/src/routers/external_activity_images.py`と`apps/api/src/services/media/outline_images.py` | 閲覧権限・画像台帳に基づく短命URL発行。台帳の変更にはAPI再起動を伴う |
| `apps/outline-image-worker` | 変換Workerは別配備。R2と同じCloudflareアカウントに置き、設定とSecretを用意する |
| `apps/web/app/api/auth` | サーバー側認証で内部APIを使用 |
| `deploy`と`.github/workflows/imagepit-deploy.yml` | mbp16向けGitOps配備と独立したバックアップ入口 |
| `apps/e2e/features/assignments/load`とDBイベント処理 | 専用環境での同時負荷計測。結果には実行環境・キャッシュ条件を添える |

CommunityイメージのビルドではEnterpriseの実装を除外します。SSOなどのEnterprise機能の利用可否は上流のライセンスと実装に従います。公開経路のAccess認証後も、LearnHouse自身のログインと教材閲覧権限の検査が必要です。

バックアップのCronJobは初期状態で停止しています。運用者が取得・転送・隔離復元を確認して有効化します。Redisの一時データ、Secret、OutlineのR2原本はLearnHouseのバックアップ対象に含みません。復旧時はSecretを再登録し、R2原本はOutline側の復旧手順を使います。
