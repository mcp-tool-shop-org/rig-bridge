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

**状态：** v1.0.x 版本已发布到 npm。**包含 8 个 CLI 命令**（init / new / send / close / status / thread / sync / relay）。通过跨设备端到端测试，验证了跨设备漂移检测功能（CRLF/LF 传输，3 个设备拓扑）。v1.1 版本将集成控制平面功能。

用于配对开发设备的同步工具，采用基于 Git 的、类型化数据包的跨设备数据传输。

## 当前版本的功能

**v1.0.x 传输层（已完成）：**

包含所有 8 个 CLI 命令以及支持它们的引擎组件。v1.0.x 版本独立发布了 Git 传输功能，控制平面集成将在 v1.1 版本中实现（路径 B-2；请参阅 [docs/v1.1-roadmap.md](docs/v1.1-roadmap.md)）。

命令功能：

- `rig-bridge init`：初始化本地仓库，安装提交消息钩子，并创建 `.bridge/config.yaml` 文件，其中包含此设备的唯一 ID。
- `rig-bridge new <thread-id>`：根据模板创建 `<thread-id>/REQUEST.md` 文件，并自动填充前置信息。
- `rig-bridge send <type> --thread <id>`：创建类型化数据包，根据模式进行验证，计算 body_hash，根据标记推断 status_class，然后执行 `git commit && git push`。
- `rig-bridge close <thread-id> --status <cancelled|completed>`：创建 `RESOLUTION.md` 文件，提交并推送。

查询命令：

- `rig-bridge status`：列出所有打开的线程，显示上次活动时间、状态、类型和脏状态；支持 `--json` 和 `--wide` 选项。
- `rig-bridge thread <id>`：渲染指定线程的完整数据包内容（以小多重布局显示，按时间顺序升序排列，并在终端上自动分页）。

同步和验证命令：

- `rig-bridge sync`：执行快速前进的拉取操作，并在出现差异时进行提示（如果不是快速前进，则会拒绝，除非使用 `--auto` 选项；在同步边界处显示命名差异，遵循 Fossil 的语义）。
- `rig-bridge relay <type> --thread <id> --in-reply-to <hash>`：对决策/回复/确认进行人工验证（需要 `-relay` 后缀的设备 ID，并配置 Git 签名密钥；会生成包含 `attested_by`、`attested_at` 和 ULID `nonce` 的验证块）。

引擎组件（位于 `src/engine/` 目录中，并通过 `src/engine/index.ts` 导出，作为 v1.1 控制平面功能的消费者接口）：

- `envelope.ts`：YAML 前置信息的解析和渲染。
- `schema-validator.ts`：基于 Ajv 的模式验证，使用 `schemas/bridge-message.schema.json`。
- `body-hash.ts`：对按照 §4.1 规范进行规范化的 body 进行 SHA-256 哈希计算（将 CRLF 转换为 LF，去除尾部空格，必须包含一个尾部换行符，去除 BOM）。
- `status.ts`：根据 §4.2 规范，根据标记推断 status_class（`▶ active`，`⏸ pending`，`🎯 targeted`，`✅ completed`，`❌ cancelled`）。
- `rig-id.ts`：对规范的 kebab-case 格式的设备 ID 进行验证，并提供 `normalizeRigId` 辅助函数。
- `git.ts`：Git 包装器，包含子模块、大小和操作系统相关信息的检查（使用 `spawnSync` 时，最大缓冲区为 50 MB）。
- `config.ts`：`.bridge/config.yaml` 文件的读取器/写入器（在 YAML 解析之前，对行尾进行规范化，以确保 Windows autocrlf 的兼容性）。
- `threads.ts`：`listThreads` 函数，用于从工作目录中枚举所有打开的线程（用于 `status` 命令）。
- `peer-rigs.ts`：`findPeerRigs` 函数，用于从数据包历史记录中发现规范的对等设备 ID（取代了内联的 `inferPeerRig` 函数）。
- `git-diff.ts`：`gitDiffSinceLastSync` 函数，用于显示上次成功拉取以来新增的文件（同步引擎；快速前进的资格标志）。
- `verify-hash.ts`：`verifyHash` 函数，用于重新计算 body_hash 并进行比较，以验证 `in_reply_to` 链的完整性（中继引擎）。
- `validate-file.ts`：`validateEnvelopeFile` 函数，用于一次性解析、模式验证和验证哈希值（由 `thread`、`sync` 和 `relay` 命令共享）。
- `index.ts`：稳定的公共 API 接口；v1.1 控制平面写入器，以及下游消费者从此处导入。

**阶段 0 的交付成果（仍然有效）：**

- `docs/envelope-spec.md` — rig-bridge 维护的规范化数据包规范（与传输无关的前置信息 + 数据包结构）。
- `schemas/bridge-message.schema.json` — JSON Schema 2020-12，用于数据包的前置信息（验证的权威来源）。
- `docs/control-plane-integration.md` — 基于 `swarm-control-plane` 的 SQLite 数据库的“写入穿透”设计（前向设计；v1.1 版本）。
- `docs/v1.1-roadmap.md` — v1.1 版本包含的内容：控制平面写入、Phase 7 研究 swarm 提出的开放性问题，以及待处理的审查内容。
- `docs/cli-contract.md` — 稳定的 CLI 接口规范（标准输出/错误输出、`--json` 模式、退出码、环境变量）。
- `ARCHITECTURE.md` — D2a-with-control-plane-bridge-glue 决策 + 模式交叉引用。

## 安装

### 使用 npm

```bash
npm install -g @mcptoolshop/rig-bridge
```

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

这应该会打印出 `package.json` 中记录的版本。

### 支持的运行时环境

- **Node:** `>= 20.11.0` (根据 `package.json` 中的 `engines.node`)
- **npm:** `>= 10.0.0` (与 Node `>= 20.11.0` 捆绑)

### 支持的平台

macOS、Linux 和 Windows 10+ — 这三个平台都通过 CI 在每次提交时进行测试。

## 它是什么

一个 CLI + 引擎库，它允许两个（或更多）位于不同设备上的 Claude 实例通过共享的 Git 仓库进行协调，使用一种经过验证的、可在 2026-04-29 在 Mac 和 Windows GPU 设备之间进行 16 次提交的有机会话中使用的、具有类型的数据包协议。

v1.0.x 版本包含所有 8 个命令，作为传输层。v1.1 版本将添加控制平面集成，以便数据包写入到 `swarm-control-plane` 的 SQLite 数据库中，作为持久化数据层 — 参见 [docs/v1.1-roadmap.md](docs/v1.1-roadmap.md)。

该协议拥有自己的数据包（与传输无关）。Git 是设备之间的连接；在 v1.1 版本中，控制平面成为持久化状态。

## CLI 接口规范

rig-bridge 遵循 [clig.dev](https://clig.dev/) 的原则：标准输出是数据，标准错误输出是描述信息，`--json` 是稳定的接口规范。有关完整规范，请参阅 [`docs/cli-contract.md`](docs/cli-contract.md) — 输出规范、`--json` 模式 (`schema_version: "1.0"`）、每个命令的标准输出格式、退出码和环境变量。

### 使用示例

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

- **涉及的数据：** 本地 Git 仓库的克隆 + `.bridge/config.yaml` (设备标识符 + 可选的显示名称) + 消息文件 (包含 YAML 前置信息的 Markdown)。没有数据库。没有遥测端点。
- **网络出站：** 仅限于配置的 Git 远程仓库 (默认情况下通过 HTTPS 连接到 GitHub)。没有其他网络访问。
- **所需的权限：** 对本地 Git 仓库和 `.bridge/` 目录的读/写访问权限；用于推送的 Git 凭据 (委托给操作员现有的 Git 配置)。
- **默认情况下没有遥测** — rig-bridge 不会收集、传输或存储任何使用数据。离开本地机器的唯一数据是操作员明确推送的提交。
- **信任模型：** rig-bridge 信任 GitHub 的 TLS 用于传输完整性，并信任本地 Git 配置用于身份验证。`init`、`new`、`send`、`close`、`status`、`thread` 和 `sync` 命令本身不会对提交进行签名；操作员可以通过现有的 Git 机制来添加 GPG/SSH 提交签名。`relay` 命令是例外 — 它**需要**配置的 Git 签名密钥（设计上拒绝未签名的提交，遵循人类认证的网关模型），并记录签名者的身份信息在数据包的 `attested_by` 字段中。

请参阅 [SECURITY.md](SECURITY.md)，了解漏洞报告和支持的版本。

## 许可证

MIT — 参见 [LICENSE](LICENSE)。

---

<p align="center">
  Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
</p>
