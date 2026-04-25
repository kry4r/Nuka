<div align="center">

<img src="assets/logo.png" width="128" height="128" alt="Nuka" />

# Nuka

**插件优先、Agent 蜂群的 CLI 编程助手。**

[![tests](https://img.shields.io/badge/tests-849%20passing-brightgreen)]()
[![bundle](https://img.shields.io/badge/bundle-237%20KB-blue)]()
[![status](https://img.shields.io/badge/status-active-success)]()
[![license](https://img.shields.io/badge/license-TBD-lightgrey)]()

流式 TUI · MCP 服务器 · 插件市场 · 多专家 Agent · LSP 工具 —— 单包 ~240 KB。

[English](README.md) · [简体中文](README.zh-CN.md)

</div>

---

## ✨ 亮点

| | |
|---|---|
| **🎯 插件优先** | 工具、斜杠命令、MCP、Hook、Agent、输出渲染器、LSP 服务器都通过同一份 manifest 注入。 |
| **🤖 Agent 蜂群** | 插件可声明专家 Agent，主 Agent 隔离会话调度，最多 4 个并行执行。 |
| **🔌 多 Provider** | 已支持 Anthropic / OpenAI，新接一家约 150 行代码。 |
| **📦 插件市场** | 支持 URL 索引 / git / npm / `.mcpb`、`.dxt` 包；带版本缓存与依赖闭包。 |
| **🛡️ 权限感知** | 只读 / 破坏性 / 联网注解驱动 UI；按会话缓存授权。 |
| **📁 LSP 集成** | stdio LSP 服务器；diagnostics / definition / references 直接成为 Agent 工具；`Write`/`Edit` 自动 `didChange`。 |

---

## 🚀 快速开始

```bash
git clone https://github.com/kry4r/Nuka.git
cd Nuka && npm install && npm run build && npm link
```

在 `~/.nuka/config.yaml` 中配置一个 Provider：

```yaml
providers:
  - id: anthropic
    type: anthropic
    apiKey: sk-ant-...
    model: claude-opus-4-7
defaultProvider: anthropic
```

启动：

```bash
nuka
```

> 未配置 Provider 也可启动，会进入离线模式；通过 `/config` 或编辑配置文件随时添加。

---

## 🏗 架构

```
                ┌─────────────────────┐
                │     src/cli.tsx     │
                │  providers·sessions │
                │  permission·slash   │
                └──────────┬──────────┘
                           │
                  ┌────────▼────────┐
                  │  agent/loop.ts  │  流式 · 并行批处理
                  │                 │  hooks · 通道 · 自动压缩
                  └─┬──────┬──────┬─┘
                    │      │      │
            ┌───────▼─┐ ┌──▼───┐ ┌▼──────────┐
            │ 工具集  │ │Skill │ │ Provider  │
            └────┬────┘ └──────┘ └───────────┘
                 │
       ┌─────────┼─────────────────────────────┐
       │         │                             │
   ┌───▼───┐ ┌───▼────┐ ┌──────────┐ ┌─────────▼────┐
   │  MCP  │ │ 插件   │ │  Agent   │ │     LSP      │
   │client │ │ 装配   │ │  调度    │ │ jsonrpc·docs │
   │mgr    │ │ market │ │  注册表  │ │ manager·tools│
   └───────┘ └────────┘ └──────────┘ └──────────────┘
```

### 模块速查

```
src/core/
  agent/         主循环 · 事件 · 系统提示 · 进度泵
  agents/        Agent 调度 · 注册表 · 工具过滤
  config/        4 层配置叠加（enterprise/user/project/local）
  hooks/         生命周期钩子（execa 运行）
  lsp/           jsonrpc · 客户端 · 文档跟踪 · 管理器 · 工具
  mcp/           客户端 · 传输 · 重连 · elicitation
  notifications/ 通道（webhook / command）
  permission/    检查器 · 桥接 · 模式缓存
  plugin/        manifest · 安装 · 依赖 · 市场 · userConfig
  provider/      Anthropic · OpenAI 适配器
  tools/         注册表 · 校验 · 并发 · ContentBlock
src/slash/       /plugin · /help · 插件贡献
src/tui/         Ink 渲染 · 对话框 · 消息行
```

---

## 🧩 插件 manifest

```yaml
name: my-plugin
version: 1.0.0

# 能力声明
tools:        [tools/foo.js]
slashCommands:[slash/bar.js]
skills:       [skills/baz.md]
hooks:        hooks.json
mcpServers:   { fs: { type: stdio, command: ... } }
lspServers:   [{ name: ts, command: typescript-language-server, ... }]

# 多专家 Agent
agents:
  - name: reviewer
    description: 严谨的代码审查
    systemPrompt: 你是一名严格的审查者...
    allowedTools: [Read, Grep, Glob]
    keywords: [review, audit]

# UI 定制
outputStyles: [{ name: gh, matchToolName: "mcp__github__*", componentPath: ... }]
channels:     [{ name: slack, allowlist: [tool_result], dispatch: { type: webhook, url: ... } }]

# 配置
userConfig:   { fields: [{ name: token, type: string, required: true }] }
dependencies: [{ name: shared-lib, required: true }]
```

---

## 🤖 自动测试模式

Nuka 内置无头 TUI 测试框架。测试计划是 `test-plans/` 目录下的 YAML 文件，
可挂载 App、发送按键，并对渲染帧进行断言。

```bash
# 运行测试计划（默认 pretty 输出）
nuka --test-plan test-plans/01-offline-boot.yaml

# TAP 格式输出（适用于 CI）
nuka --test-plan test-plans/01-offline-boot.yaml --reporter=tap

# 更新快照
nuka --test-plan test-plans/01-offline-boot.yaml --update-snapshots

# 通过 vitest 运行全部示例计划
npx vitest run test/integration/samplePlans.test.ts
```

`test-plans/` 中包含 5 个示例计划：离线启动、引导向导、
主题切换界面、状态视图、以及计划模式锁定。

---

## 🎬 人工测试流程

```bash
# 基本检查
npm run typecheck && npm test && npm run build

# 交互
nuka              # 输入 prompt；/help 列出斜杠命令

# 插件冒烟
mkdir -p ~/.nuka/plugins/hello/{tools,slash}
# 复制 plugin.yaml + greet.js + wave.js（参考 docs/superpowers/specs/）
nuka              # /plugin list 应能看到 hello

# Agent 调度
# 在 hello/plugin.yaml 中加入 agents: [{ name: reviewer, ... }]
nuka              # "派 reviewer 看一下 src/cli.tsx"
                  # 期望出现缩进的 [hello:reviewer] 块

# LSP
npm install -g typescript-language-server
# 在 hello/plugin.yaml 中加入 lspServers: [{ name: ts, ... }]
nuka              # "对 src/cli.tsx 跑 lsp_diagnostics"

# 校验
nuka plugin validate ~/.nuka/plugins/hello

# 配置作用域
nuka config show [--scope user]
```

完整 13 步测试方案见 `docs/superpowers/specs/2026-04-24-phase5-marketplace-agents-design.md`。

---

## 🛣 阶段历程

| 阶段 | 项目数 | 重点 |
|------:|------:|---|
| 1–3 | 基础 | Agent 主循环 · Provider · 最小 MCP · 基础插件 |
| **4a** | 21 | 超时 · 截断 · listRoots · resource_link · 图片落盘 · 校验 · ContentBlock · hooks · elicitation · SSE · 重连 |
| **4b** | 14 | 并行批处理 · 注解化授权 · 调度 · 别名 · userConfig · stderr 缓冲 · LRU |
| **5** | 16 | 市场 + git/npm/bundle · 依赖闭包 · `/plugin` TUI · **Agent 蜂群** · outputStyles · channels · 4 层配置 |
| **6** | 1 | LSP 集成 |

849 个测试 · 237 KB 包体 · 0 新增 vendored 依赖。

---

## 📜 License

待定。在维护者另行声明前保留所有权利。

## 🤝 贡献

欢迎 Issue 与 PR。每个重要变更都附带 `docs/superpowers/` 下的设计 + 计划 + Gap Closure 条目。
