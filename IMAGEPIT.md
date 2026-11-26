# IMAGEPIT版LearnHouse

LearnHouse 1.4.5を基点に、IMAGEPITの教材表示、Outline画像参照、成績出力を追加した公開フォークです。
このページを入口に、システム構成、独自仕様、配備・復旧手順を参照できます。

## 基本情報

以下はリポジトリに記録された構成です。稼働状態やSecretの登録状態は配備先で確認してください。

| 項目 | 内容 |
| --- | --- |
| 稼働URL・環境 | `https://learnhouse.image-pit.com`。mbp16のKubernetes、`learnhouse`名前空間に置くCommunity版PoC。公開経路はCloudflare Accessで保護 |
| ベースブランチ | `imagepit-1.4.5`。IMAGEPITのアプリ改変と運用資材を集約するブランチ |
| 配備ブランチ | `learnhouse-release`。Actionsが検証済みイメージのダイジェストと`deploy/k8s`を更新し、Argo CDが参照 |
| 上流リポジトリ・基点バージョン | `learnhouse/learnhouse`の1.4.5。履歴上の基点は`6e5f3d20`。API・Web・Collabの版も1.4.5 |
| 配備方式 | GitHub Actionsでlinux/amd64のCommunityイメージをビルド・起動検証し、非公開の`docker.io/imagepit/learnhouse`へpush。Argo CDで同期 |
| 関連システム | Outline、Cloudflare Access、Cloudflare R2、任意の画像変換Worker、Googleドライブ、共通バックアップ部品を置く`imagepit/platform` |
| データストア | PostgreSQL 16とpgvector、Redis、教材用PVC。Outlineの画像原本は別の非公開R2バケットに保存 |

構成の根拠は[配備手順](deploy/README.md)、[配備workflow](.github/workflows/imagepit-deploy.yml)、[Argo CD Application](deploy/application.yaml)です。

## ドキュメント一覧

| 文書 | 内容 |
| --- | --- |
| [アーキテクチャ](docs/imagepit/architecture.md) | システム全体図、コンポーネント、データフロー、配備・バックアップ構成 |
| [IMAGEPIT独自仕様](docs/imagepit/spec.md) | 教材表現、Outline画像、クイズ、成績出力、主要環境変数と制約 |
| [フォークの改変方針](IMAGEPIT-FORK-POLICY.md) | デザインシステムの部品取り込みと対応ソースの扱い |
| [配備手順](deploy/README.md) | Access、Actions、Argo CD、Outline画像台帳の登録、切り戻し |
| [バックアップ運用](deploy/backup/README.md) | 日次取得、Drive転送、監視、隔離復元 |
| [Outline画像Worker](apps/outline-image-worker/README.md) | 画像変換の有効化、短命チケット、キャッシュ、切り戻し |
| [ローカルJudge0](docs/local-judge0.md) | 受講者のApple Silicon MacでPython演習を実行する手順 |
| [教材UIの取り込み元](apps/web/components/Objects/RichMarkdown/vendor/SOURCE.md) | デザインシステムの基点とライセンス情報 |
| [CLI](apps/cli/README.md) | 上流の開発・セルフホスト用CLI |
| [E2Eと負荷計測](apps/e2e/README.md) | Playwrightによる検収とレッスン・クイズの同時利用計測 |
| [SDK](packages/sdk/README.md) | API用TypeScript SDK |
| [React表示部品](packages/react/README.md) | Reactアプリ向けの教材表示 |
| [Vue表示部品](packages/vue/README.md) | Vueアプリ向けの教材表示 |

## 主な機能・IMAGEPIT独自拡張

上流にはコース、ブロックエディター、課題、ディスカッション、共同編集などの機能があります。IMAGEPITの主な追加・改変は次のとおりです。詳細と実装箇所は[独自仕様](docs/imagepit/spec.md)にまとめています。

| 拡張 | 内容 | 履歴の根拠 |
| --- | --- | --- |
| デザインシステム部品の取り込み | 必要なパーサー、表示部品、スタイルをフォークにコピー。教材向けのコールアウト、手順、ファイルツリー、注釈付きコード、Mermaidを表示 | `ab7921eb`、`3c352804`、`df94f0a4` |
| Outline画像の配信 | アクティビティの閲覧権限と添付台帳を照合。R2原本や、任意のWorkerによるWebPプレビューを短命URLで配信 | `40337ccc`、`54635706`、`c5cfd2de` |
| 独自の教材UI | H2単位の章リーダー、固定目次、1問ずつ進む確認クイズ、条件を満たした後の解説表示 | `142105c8`、`7fa4cc14`、`6e3bc7f0` |
| 成績表・企業別レポート | 章ごとの課題・提出状況を表示し、企業と開催回を指定したPDF・CSVを出力 | `b8b17345`、`1b6412be`、`463143bc`、`26afd6b2` |
| 受講者PCでの実行 | 単一ファイルのPythonと公開テストをローカルJudge0で練習。正式な提出・採点は既存経路を使用 | `5be122a8` |
| 配備・運用 | Communityイメージの検証とGitOps配備、Driveバックアップ、画像表示とクイズ提出の同時負荷計測 | `f9ebdb51`、`8b72a5eb` |

## ディレクトリ構成

| パス | 役割 |
| --- | --- |
| `apps/api` | FastAPIのREST API、認証・権限、教材・提出・採点、画像認可、DBマイグレーション |
| `apps/web` | Next.jsの受講画面、管理画面、教材エディター、認証用ルート |
| `apps/collab` | HocuspocusとYjsによる共同編集サーバー |
| `apps/cli` | 開発環境とセルフホスト環境の管理CLI |
| `apps/e2e` | Playwrightによる操作検証、専用環境での負荷計測 |
| `apps/outline-image-worker` | Cloudflare WorkerによるOutline画像のWebP変換 |
| `packages/sdk`、`packages/react`、`packages/vue` | API SDKと外部アプリ向けの教材表示部品 |
| `deploy` | Kubernetes、Argo CD、起動検証、Outline画像台帳作成、バックアップ運用 |
| `.github/workflows` | 上流CIとIMAGEPITの配備workflow |
| `docker` | 統合イメージ内のNginx設定とサービス起動スクリプト |
| `scripts/local-judge0` | 受講者PC用Judge0の構築・起動資材 |
| `docs` | 上流のNext.jsドキュメントサイト。`content/`がサイト記事、`imagepit/`がこのフォークの日本語文書 |

## ローカル開発・検証コマンド

開発環境にはNode.js、Bun、uv、起動済みのDockerが必要です。CLIのNode.js要件は22以上、APIのPython要件は[pyproject.toml](apps/api/pyproject.toml)に記載されています。

以下は既存のスクリプトとCLIで使えるコマンドです。各行の作業ディレクトリから実行してください。

| 用途 | 作業ディレクトリ | コマンド |
| --- | --- | --- |
| API・Web・Collabと開発用DBの起動 | リポジトリ直下 | `npx learnhouse dev` |
| Web依存の取得 | `apps/web` | `bun install --frozen-lockfile` |
| Webの開発サーバー | `apps/web` | `bun run dev` |
| Webのビルド | `apps/web` | `bun run build` |
| Webの既存テスト | `apps/web` | `bun run test` |
| API依存の取得 | `apps/api` | `uv sync --frozen` |
| APIの起動 | `apps/api` | `uv run python app.py` |
| APIの既存テスト | `apps/api` | `uv run pytest src/tests` |
| 画像Workerの既存テスト | `apps/outline-image-worker` | `node --test worker.test.mjs` |
| Playwrightの既存テスト | `apps/e2e` | `bun run test` |
| 文書差分の空白検査 | リポジトリ直下 | `git diff --check` |

個別起動は接続先などの設定済み環境を前提とします。`npx learnhouse dev`は公開CLIを取得し、現在のチェックアウトで開発環境を用意します。E2Eの既定実行は公開イメージを起動するため、フォークの検証では[E2Eの接続先設定](apps/e2e/README.md)で対象のインスタンスを指定してください。負荷計測には専用のDB・Redis・画像バケットが必要です。

## 上流との関係・変更方針・ブランチ運用

上流のREADMEは製品全体の案内として維持し、IMAGEPIT向けの入口をこの`IMAGEPIT.md`に置きます。日本語の構成・仕様文書は`docs/imagepit/`にまとめます。上流サイトは[docs/source.config.ts](docs/source.config.ts)で`docs/content/`を記事の読み込み先としており、今回の文書はサイトへの記事追加を伴いません。

アプリと運用資材の変更は作業ブランチから`imagepit-1.4.5`向けのPRで確認します。`learnhouse-release`は配備結果を記録するブランチで、[配備workflow](.github/workflows/imagepit-deploy.yml)が更新します。マージ後の配備は同workflowの手動実行で行い、PRのマージだけでは配備されません。

IMAGEPITのUIは[フォークの改変方針](IMAGEPIT-FORK-POLICY.md)に従い、必要な部品と依存をコピーして管理します。取り込み元の変更は必要なものを選び、LearnHouseの画面で確認します。公開・配布時の権利確認と対応ソースの扱いは同方針、[取り込み元の記録](apps/web/components/Objects/RichMarkdown/vendor/SOURCE.md)、[LICENSE](LICENSE)を参照してください。
