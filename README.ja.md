<p align="center">
  <a href="README.md">English</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/rig-bridge/readme.png" width="400" alt="rig-bridge" />
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/rig-bridge/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/rig-bridge/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://mcp-tool-shop-org.github.io/rig-bridge/"><img src="https://img.shields.io/badge/landing-page-2563eb" alt="Landing Page" /></a>
</p>

**ステータス:** 7フェーズ（機能実行フェーズ2）が完了しました。v1.0.0の伝送レイヤー：**8つのCLIコマンドのうち8つが実装済み**（init / new / send / close / status / thread / sync / relay）。伝送レイヤーは完了しました。v1.1では、コントロールプレーンの統合が開始されます。

ペアになった開発環境用の同期ツール。Gitネイティブな型付きエンベロープによる、エージェント間のデータ転送。

## 本日提供されている機能

**v1.0.0の伝送レイヤーが完了:**

v1.0.0の8つのCLIコマンドと、それらを支えるエンジンヘルパーが含まれています。v1.0.0では、Gitの伝送機能が独立して提供されます。コントロールプレーンの統合はv1.1にdeferされます（Path B-2。詳細は[docs/v1.1-roadmap.md](docs/v1.1-roadmap.md)を参照）。

コマンドの概要：

- `rig-bridge init`: ローカルリポジトリを初期化し、コミットメッセージのフックをインストールし、`.bridge/config.yaml`ファイルにこの環境の識別子を記述します。
- `rig-bridge new <thread-id>`: エンベロープテンプレートから`<thread-id>/REQUEST.md`ファイルを作成します。フロントマターは自動的に入力されます。
- `rig-bridge send <type> --thread <id>`: 型付きエンベロープを作成し、スキーマに対して検証を行い、本文のハッシュ値を計算し、マーカーからステータスクラスを導出します。その後、`git commit && git push`を実行します。
- `rig-bridge close <thread-id> --status <cancelled|completed>`: `RESOLUTION.md`ファイルを作成し、コミット、プッシュします。

確認コマンド：

- `rig-bridge status`: 実行中のスレッドを、最終アクティビティ、ステータスクラス、タイプ、および変更の有無とともにリスト表示します。`--json`と`--wide`オプションを使用できます。
- `rig-bridge thread <id>`: スレッドの完全なエンベロープのトランスクリプトを表示します（マルチビュー形式で、時系列順に表示され、TTY上で自動的にページ分割されます）。

同期および認証コマンド：

- `rig-bridge sync`: 差分がある場合にのみプルを実行します（非差分の場合には`--auto`オプションが必要です）。名前付きの差分を同期の境界で表示します（Fossilのセマンティクスに準拠）。
- `rig-bridge relay <type> --thread <id> --in-reply-to <hash>`: 人間が確認したDECISIONS/RESPONSE/ACKのターン（`-relay`サフィックスを持つrig-idとGitの署名キーが必要です。`attested_by`、`attested_at`、およびULIDのnonceを含む認証ブロックを出力します）。

エンジンヘルパー（`src/engine/`内）：

- `envelope.ts`: YAMLフロントマターの解析/レンダリング
- `schema-validator.ts`: `schemas/bridge-message.schema.json`に対するAjvによる検証
- `body-hash.ts`: §4.1で正規化された本文に対するSHA-256ハッシュ計算（BOMの削除、CRLF→LFへの変換、末尾の空白の削除、正確に1つの改行）
- `status.ts`: マーカーからステータスクラスを導出（§4.2: `▶ active`、`⏸ pending`、`🎯 targeted`、`✅ completed`、`❌ cancelled`）
- `rig-id.ts`: CLIからの入力における、標準的なkebab-case形式のrig idの検証
- `git.ts`: サブモジュール、サイズ、およびOS固有の情報を扱うGitラッパー
- `config.ts`: `.bridge/config.yaml`ファイルの読み込み/書き込み
- `list-threads.ts`: 作業ツリーから実行中のスレッドを列挙（`status`コマンド用）
- `peers.ts`: `findPeerRigs` - エンベロープの履歴から標準的なピアrig-idを検出（インラインの`inferPeerRig`を置き換えます）
- `git-diff.ts`: `gitDiffSinceLastSync` - 最後に正常にプルされた以降の新しいファイルを検出（同期エンジン）
- `hash-verify.ts`: `verifyHash` - `in_reply_to`チェーンの整合性を検証するために、本文のハッシュ値を再計算し、比較します（リレーエンジン）
- `envelope-file.ts`: `validateEnvelopeFile` - ファイルパスを1回の呼び出しで解析し、スキーマ検証を実行します（`thread`、`sync`、`relay`で使用）

**フェーズ0の成果物（現時点でも有効）:**

- `docs/envelope-spec.md` — rig-bridge が管理する、標準的なエンベロープ仕様（トランスポートに依存しないヘッダーと、メッセージの構造）。
- `schemas/bridge-message.schema.json` — エンベロープのヘッダーに関する JSON Schema 2020-12（検証のための真の参照）。
- `docs/control-plane-integration.md` — `swarm-control-plane` の SQLite への書き込み機能（フォワード設計、v1.1 の機能）。
- `docs/v1.1-roadmap.md` — v1.1 で実装される機能：コントロールプレーンへの書き込み、Phase 7 の調査で明らかになった未解決の問題、および保留中のレビュー項目。
- `docs/cli-contract.md` — 安定した CLI のインターフェース仕様（標準出力/標準エラー出力、`--json` スキーマ、終了コード、環境変数）。
- `ARCHITECTURE.md` — D2a とコントロールプレーンブリッジの連携に関する決定、およびスキーマの相互参照。

## インストール

### npm (v1.0.0 以降)

```bash
npm install -g @mcptoolshop/rig-bridge
```

> **注意:** 現在、このパッケージはプレリリース版 (`0.0.1-pre-swarm`) です。v1.0.0 は、次期 dogfood swarm の Phase 10 で npm リリースされます。それまでは、ソースコードからインストールしてください（下記参照）。

### ソースコードから

```bash
git clone https://github.com/mcp-tool-shop-org/rig-bridge.git
cd rig-bridge
npm install
npm run build
npm link   # adds the rig-bridge command to your PATH
```

### 確認

```bash
rig-bridge --version
```

これにより、`package.json` に記録されているバージョンが表示されます。

### サポートされている実行環境

- **Node:** `>= 20.11.0` ( `package.json` の `engines.node` に基づく)
- **npm:** `>= 10.0.0` (Node `>= 20.11.0` に同梱)

### サポートされているプラットフォーム

macOS、Linux、Windows 10 以降。これらすべてが、CI によってプッシュごとにテストされます。

## このソフトウェアの概要

CLI とエンジンライブラリ。異なる環境で動作する複数の Claude インスタンスが、共有の Git リポジトリを介して連携できます。この連携は、型付きエンベローププロトコルを使用し、2026年4月29日に、Mac と Windows GPU 環境で 16 コミットの有機的なセッションで初めて動作確認されました。

v1.0.0 では、8 つのコマンドがすべて実装されます。v1.1 では、コントロールプレーンとの連携が追加され、エンベロープが `swarm-control-plane` の SQLite に書き込まれ、永続的なデータ層として機能します。詳細は [docs/v1.1-roadmap.md](docs/v1.1-roadmap.md) を参照してください。

このプロトコルは、独自のエンベロープを使用します（トランスポートに依存しません）。Git は、異なる環境間の通信手段です。v1.1 では、コントロールプレーンが永続的な状態の管理を担当します。

## CLI の仕様

rig-bridge は、[clig.dev](https://clig.dev/) の原則に従います。標準出力はデータ、標準エラー出力は説明、`--json` は安定したインターフェースの仕様です。詳細については、[`docs/cli-contract.md`](docs/cli-contract.md) を参照してください。このドキュメントには、出力のルール、`--json` スキーマ (`schema_version: "1.0"`)、コマンドごとの標準出力の形式、終了コード、および環境変数が記載されています。

### 使用例

```bash
# Initialize the local clone on the GPU rig
rig-bridge init

# Open a new thread and send a typed REQUEST envelope
rig-bridge new bridge-onboarding-01
rig-bridge send REQUEST --thread bridge-onboarding-01

# Glance at what's open across all threads
rig-bridge status

# Pull from the peer rig (fast-forward only by default)
rig-bridge sync
```

スクリプトで利用する場合、すべてのコマンドで `--json` オプションを使用できます。

```bash
rig-bridge status --json | jq '.threads[] | select(.dirty == true)'
```

## セキュリティとデータ

- **アクセスされるデータ:** ローカルの bridge リポジトリのクローン、`.bridge/config.yaml` (環境識別子とオプションの表示名)、メッセージファイル (YAML フロントマターを含む Markdown)。データベースは使用しません。テレメトリのエンドポイントもありません。
- **ネットワークへのアクセス:** 設定された Git リモート (デフォルトでは HTTPS を使用した GitHub) へのアクセスのみ。他のネットワークアクセスはありません。
- **必要な権限:** ローカルの bridge リポジトリと `.bridge/` ディレクトリへの読み書きアクセス、Git の認証情報 (オペレーターの既存の Git 設定に委譲)。
- **デフォルトではテレメトリは無効:** rig-bridge は、使用状況データを収集、送信、または保存しません。ローカルマシンから送信されるのは、オペレーターが明示的にプッシュするコミットのみです。
- **信頼モデル:** rig-bridge は、トランスポートの整合性については GitHub の TLS を信頼し、作者の認証についてはローカルの Git 設定を信頼します。`init`、`new`、`send`、`close`、`status`、`thread`、および `sync` コマンドは、コミット自体を署名しません。オペレーターは、既存の Git メカニズムを使用して、GPG/SSH によるコミットの署名を適用できます。`relay` コマンドは例外で、**必ず**設定された Git 署名キーが必要であり（設計上、署名されていない場合は拒否されます。これは、人間が確認したゲートウェイモデルに基づいています）、署名者の情報をエンベロープの `attested_by` フィールドに記録します。

脆弱性に関する報告およびサポートされているバージョンについては、[SECURITY.md](SECURITY.md) を参照してください。

## ライセンス

MITライセンス — [LICENSE](LICENSE) を参照してください。

---

<p align="center">
  Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
</p>
