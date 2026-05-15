<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.md">English</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/rig-bridge/readme.png" width="400" alt="rig-bridge" />
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/rig-bridge/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/rig-bridge/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://mcp-tool-shop-org.github.io/rig-bridge/"><img src="https://img.shields.io/badge/landing-page-2563eb" alt="Landing Page" /></a>
</p>

**状态：** 第 7 阶段（功能执行第二阶段）已完成。v1.0.0 传输层：**已实现 8 个 CLI 命令中的 8 个**（init / new / send / close / status / thread / sync / relay）。传输层已完成；v1.1 将集成控制平面。

用于配对开发环境的同步工具，采用 Git 原生的类型化数据包，实现跨代理的数据传输。

## 当前内容

**v1.0.0 传输层已完成：**

所有 8 个 v1.0.0 CLI 命令以及它们背后的引擎辅助功能。v1.0.0 独立提供 Git 传输功能，控制平面集成将在 v1.1 中实现（路径 B-2；请参阅 [docs/v1.1-roadmap.md](docs/v1.1-roadmap.md)）。

命令：

- `rig-bridge init`：初始化本地仓库，安装提交消息钩子，并使用此环境的规范 ID 写入 `.bridge/config.yaml` 文件。
- `rig-bridge new <thread-id>`：根据数据包模板创建 `<thread-id>/REQUEST.md` 文件，并自动填充前置信息。
- `rig-bridge send <type> --thread <id>`：写入类型化数据包，根据模式进行验证，计算 `body_hash`，从标记中推断 `status_class`，然后执行 `git commit && git push`。
- `rig-bridge close <thread-id> --status <cancelled|completed>`：写入 `RESOLUTION.md` 文件，提交并推送。

查看命令：

- `rig-bridge status`：列出所有打开的线程，显示上次活动时间、状态类别、类型和脏状态；支持 `--json` 和 `--wide` 选项。
- `rig-bridge thread <id>`：渲染指定线程的完整数据包记录（采用小多重布局，按时间顺序升序排列，并在终端上自动分页）。

同步和验证命令：

- `rig-bridge sync`：执行快速同步，并在出现差异时进行提示（如果不是快速同步，则会拒绝，除非使用 `--auto` 选项；在同步边界处显示命名差异，遵循 Fossil 风格的语义）。
- `rig-bridge relay <type> --thread <id> --in-reply-to <hash>`：用于人工验证的决策/回复/确认，需要配置 `-relay` 环境 ID 后缀和 Git 签名密钥；会生成包含 `attested_by`、`attested_at` 和 ULID `nonce` 的验证块。

引擎辅助功能（位于 `src/engine/` 目录中）：

- `envelope.ts`：YAML 前置信息解析/渲染。
- `schema-validator.ts`：基于 Ajv 的模式验证，用于验证 `schemas/bridge-message.schema.json`。
- `body-hash.ts`：对 §4.1 规范化的正文进行 SHA-256 哈希计算（去除 BOM，将 CRLF 转换为 LF，去除尾随空格，必须包含一个换行符）。
- `status.ts`：根据 §4.2 的规则，从标记中推断 `status_class`（`▶ active`，`⏸ pending`，`🎯 targeted`，`✅ completed`，`❌ cancelled`）。
- `rig-id.ts`：在 CLI 接口处验证规范的 kebab-case 环境 ID。
- `git.ts`：Git 包装器，包含子模块、大小和操作系统相关信息的检查。
- `config.ts`：读取/写入 `.bridge/config.yaml` 配置文件。
- `list-threads.ts`：从工作目录中枚举所有打开的线程（用于 `status` 命令）。
- `peers.ts`：`findPeerRigs`：从数据包历史记录中发现规范的对等环境 ID（取代了内联的 `inferPeerRig`）。
- `git-diff.ts`：`gitDiffSinceLastSync`：显示上次成功同步后新增的文件（同步引擎）。
- `hash-verify.ts`：`verifyHash`：重新计算并比较 `body_hash`，以验证 `in_reply_to` 链的完整性（中继引擎）。
- `envelope-file.ts`：`validateEnvelopeFile`：一次性解析并根据模式验证文件路径（由 `thread`、`sync` 和 `relay` 命令共享）。

**第 0 阶段的成果（仍然有效）：**

- `docs/envelope-spec.md` — rig-bridge 拥有的标准信封规范（与传输无关的前置信息 + 消息体结构）。
- `schemas/bridge-message.schema.json` — JSON Schema 2020-12，用于信封的前置信息（验证的权威来源）。
- `docs/control-plane-integration.md` — 基于 `swarm-control-plane` 的 SQLite 数据库的“写入穿透”设计（前瞻性设计；v1.1 版本）。
- `docs/v1.1-roadmap.md` — v1.1 版本包含的内容：控制平面写入、阶段 7 研究 swarm 提出的开放性问题，以及待处理的审查内容。
- `docs/cli-contract.md` — 稳定的 CLI 接口规范（标准输出/标准错误输出、`--json` 模式、退出码、环境变量）。
- `ARCHITECTURE.md` — D2a-with-control-plane-bridge-glue 决策 + 模式交叉引用。

## 安装

### 从 npm (v1.0.0+)

```bash
npm install -g @mcptoolshop/rig-bridge
```

> **注意：** 该软件包目前处于预发布阶段 (`0.0.1-pre-swarm`)。 v1.0.0 版本将在下一个 dogfood swarm 的第 10 阶段发布。 在此之前，请从源代码安装（见下文）。

### 从源代码

```bash
git clone https://github.com/mcp-tool-shop-org/rig-bridge.git
cd rig-bridge
npm install
npm run build
npm link   # adds the rig-bridge command to your PATH
```

### 验证

```bash
rig-bridge --version
```

这应该打印出 `package.json` 中记录的版本。

### 支持的运行时环境

- **Node:** `>= 20.11.0` (根据 `package.json` 中的 `engines.node`)
- **npm:** `>= 10.0.0` (与 Node `>= 20.11.0` 捆绑)

### 支持的平台

macOS、Linux 和 Windows 10+ — 这三个平台都通过 CI 在每次提交时进行测试。

## 它将是什么

一个 CLI + 引擎库，允许两个（或更多）位于不同设备上的 Claude 实例通过共享的 Git 仓库进行协调，使用一种经过 2026-04-29 期间，Mac 和 Windows GPU 设备之间 16 次提交的有机会话验证的、具有类型定义的信封协议。

v1.0.0 版本包含所有 8 个命令，作为传输层。 v1.1 版本增加了控制平面集成，以便信封数据写入到 `swarm-control-plane` 的 SQLite 数据库中，作为持久化数据层 — 参见 [docs/v1.1-roadmap.md](docs/v1.1-roadmap.md)。

该协议拥有自己的信封（与传输无关）。 Git 是设备之间的连接；在 v1.1 版本中，控制平面成为持久化状态。

## CLI 接口规范

rig-bridge 遵循 [clig.dev](https://clig.dev/) 的原则：标准输出是数据，标准错误输出是描述信息，`--json` 是稳定的接口规范。 参见 [`docs/cli-contract.md`](docs/cli-contract.md) 以获取完整的规范，包括输出规范、`--json` 模式 (`schema_version: "1.0"`)、每个命令的标准输出格式、退出码和环境变量。

### 示例用法

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

对于脚本化的客户端，每个命令都支持 `--json`：

```bash
rig-bridge status --json | jq '.threads[] | select(.dirty == true)'
```

## 安全与数据

- **涉及的数据：** bridge 仓库的本地副本 + `.bridge/config.yaml` (设备标识符 + 可选的显示名称) + 消息文件 (包含 YAML 前置信息的 Markdown)。 没有数据库。 没有遥测端点。
- **网络出站：** 仅限于配置的 Git 远程仓库 (默认情况下通过 HTTPS 连接到 GitHub)。 没有其他网络访问。
- **所需的权限：** 对本地 bridge 仓库和 `.bridge/` 目录的读/写访问权限；用于推送的 Git 凭据 (委托给操作员现有的 Git 配置)。
- **默认情况下没有遥测** — rig-bridge 不会收集、传输或持久化任何使用数据。 唯一离开本地机器的数据是操作员明确推送的提交。
- **信任模型：** rig-bridge 信任 GitHub 的 TLS 用于传输完整性，并信任本地 Git 配置以进行身份验证。 `init`、`new`、`send`、`close`、`status`、`thread` 和 `sync` 命令本身不签署提交；操作员可以通过现有的 Git 机制来添加 GPG/SSH 提交签名。 `relay` 命令是例外 — 它**需要**配置的 Git 签名密钥（设计上拒绝未签名），并将签名者的身份记录在信封的 `attested_by` 字段中。

请参阅 [SECURITY.md](SECURITY.md) 文件，了解漏洞报告和支持的版本信息。

## 许可证

MIT 协议 — 详情请参阅 [LICENSE](LICENSE) 文件。

---

<p align="center">
  Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
</p>
