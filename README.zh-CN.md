<div align="center">

<img src="assets/logo.png" alt="Nuka" width="160" />

# Nuka

**驻留终端的插件式编程助手。**

流式 TUI · 多 Agent 蜂群 · 工作流 Harness · 实时监控 · 会话回顾与梦境整理

[English](README.md) · [简体中文](README.zh-CN.md)

[![bundle](https://img.shields.io/badge/bundle-376_KB-brightgreen)](#)
[![tests](https://img.shields.io/badge/tests-1421_passing-success)](#)
[![node](https://img.shields.io/badge/node-%E2%89%A518-blue)](#)
[![license](https://img.shields.io/badge/license-TBD-lightgrey)](#license)

</div>

---

## 为什么选 Nuka

主流编程助手要么把你绑死在它自家的 runtime 上，要么把所有任务都套进
同一个 TDD 循环。Nuka 走的是另一条路：

- **插件是一等公民。** 工具、斜杠命令、技能、钩子、LSP 服务、子 Agent —
  全部由 YAML 清单声明，丢进目录即可生效。
- **工作流分场景。** 修 bug 该 TDD，做调研就不需要。Harness 会按任务
  类型挑选阶段形态与技能组合。
- **蜂群是内建的，不是外挂。** 命名队友、持久化团队、DAG 流水线、圆桌
  讨论，全都和主会话并行运行。
- **TUI 不撒谎。** 多列实时 Tasks 面板加上 `/monitor` 全屏看板，让你
  一字一字看清每个 Agent 在做什么。

单进程、单包体、不需要守一个常驻进程。

## 快速上手

```bash
git clone https://github.com/kry4r/Nuka.git
cd Nuka
npm install
npm run build
npm link

nuka
```

首次启动通过 `/settings` 添加 Provider，或直接写 `~/.nuka/config.yaml`：

```yaml
providers:
  - id: anthropic
    type: anthropic
    apiKey: sk-ant-...
    model: claude-opus-4-7
defaultProvider: anthropic
```

没有 Provider 也能跑：Nuka 会进入离线模式 —— 适合先看看 TUI、玩玩
插件、跑跑测试，不烧 token。

## 界面一览

```
┌─ Conversation ──────────────────────────────────────┐
│ 欢迎屏 · 流式消息 · 工具调用折叠                    │
├─ Tasks (Ctrl+T) ────────────────────────────────────┤
│ Plan │ Subagents │ Pipeline │ Backgrounds │ Msgs    │
├─ Prompt ────────────────────────────────────────────┤
│ > _                                                 │
├─ Status ────────────────────────────────────────────┤
│ 模式 · 模型 · 路径 · 上下文 · 花费 · 回合时长       │
└─────────────────────────────────────────────────────┘
```

只要总线上来了一个 agent / message / harness 事件，Tasks 面板就会切到
五列布局；终端窄于 ~100 列时自动退化为单列简版。

| 按键           | 动作                                              |
|----------------|---------------------------------------------------|
| `/`            | 唤出斜杠命令面板                                  |
| `@`            | 引用文件                                          |
| `Ctrl+T`       | 折叠/展开 Tasks 面板                              |
| `Tab`          | 在 Tasks 列之间循环焦点（也用于补全斜杠候选）     |
| `j` `k`        | 在当前列里上下移动选中行                          |
| `Enter`        | 进入选中行的详情子菜单                            |
| `Esc`          | 关闭子菜单，或中断当前回合                        |
| `?`            | 帮助                                              |

## 斜杠命令

| 命令          | 作用                                                                  |
|---------------|-----------------------------------------------------------------------|
| `/monitor`    | 全屏看板，含 **DAG**、**Timeline**、**Tokens** 三个 Tab               |
| `/recap`      | 生成结构化的会话回顾，落盘到 `~/.nuka/recaps/`                        |
| `/harness`    | 驱动工作流状态机 —— `deep` · `fast` · `off` · `status` · `transition <stage>` |
| `/teams`      | 列出与查看 `~/.nuka/teams/` 下的持久化团队                            |
| `/settings`   | 内联编辑 Provider、模型、主题、特性开关                                |
| `/sessions`   | 浏览并恢复历史会话                                                    |
| `/stats`      | Token、花费、延迟统计                                                  |
| `/doctor`     | 体检：Provider、插件、LSP、磁盘布局是否健康                           |

按 `?` 看完整列表。

## 多 Agent 蜂群

```bash
# 进入蜂群协调模式
NUKA_COORDINATOR_MODE=1 nuka
```

此时主 Agent 的工具被收窄到协调集：`team_create`、`team_delete`、
`send_message`（点对点 / 限定 `team:X/Y` / 群发 `team:X/*`）、
`dispatch_agent`、`task_*`、`pipeline_run`、`roundtable`。被 dispatch
出去的 worker 拿到的还是完整工具集。

内置 5 个角色 Agent：`core:planner`、`core:skeptic`、`core:researcher`、
`core:implementer`、`core:reviewer`。

## 工作流 Harness

不同任务该走不同流程，Harness 把这件事写进了规则里：

| Profile     | Implement 阶段     |
|-------------|--------------------|
| `feature`   | 强制 TDD           |
| `fix`       | 强制 TDD           |
| `refactor`  | 强制 TDD           |
| `docs`      | 必经，但不强制 TDD |
| `config`    | 必经，但不强制 TDD |
| `explore`   | 跳过               |
| `research`  | 跳过               |

阶段：`brainstorm → spec → plan → search → implement → review → recap`。
每次切换都受三项原语把关 —— `sequential_thinking`、`search_and_verify`、
`ask_user_question` —— 想跳过反思往后走？没门。

## 写插件

放一份清单进去，重启即可。

```yaml
# plugin.yaml
name: my-plugin
version: 1.0.0

tools:         [tools/foo.js]
slashCommands: [slash/bar.js]
skills:        [skills/baz.md]
hooks:         hooks.json
bin:           { my-cli: ./bin/my-cli.js }
lspServers:    [{ name: ts, command: typescript-language-server }]

agents:
  - name: reviewer
    description: 严谨的代码审查者
    systemPrompt: 你是一名严格的代码审查者……
    allowedTools: [Read, Grep, Glob]
    keywords: [review, audit]
```

`examples/plugin-cli-tool/` 里有一个跑得起来的完整示例。

<details>
<summary>进程内工具</summary>

```js
// tools/echo.js
export default {
  name: 'echo',
  description: '把输入文本转成大写',
  parameters: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
  },
  source: 'plugin',
  tags: ['util'],
  needsPermission: () => 'none',
  async run({ text }) {
    return { output: text.toUpperCase(), isError: false }
  },
}
```
</details>

<details>
<summary>Spawn 包装的 CLI 工具</summary>

```js
// tools/git-log.js
export default {
  name: 'git-log',
  description: '最近 5 条 git 提交',
  parameters: { type: 'object', properties: {}, required: [] },
  source: 'plugin',
  tags: ['git', 'vcs.read'],
  runtime: {
    kind: 'spawn',
    command: 'git',
    args: () => ['log', '--oneline', '-n', '5'],
    parseOutput: (stdout) => ({ commits: stdout.trim().split('\n').filter(Boolean) }),
  },
  needsPermission: () => 'none',
  async run() { /* 由 spawn runtime 提供 */ },
}
```
</details>

<details>
<summary>Skill 能力标签</summary>

```markdown
---
name: deploy-helper
when:
  keyword: ["deploy", "release"]
requires: ["git", "vcs.read"]
---
建议发布分支前，用 git-log 看一眼最近的提交。
```

Skill 激活时拿到的工具集 = 核心工具 ∪ 「`tags` 与 `requires` 相交」的
工具。
</details>

## 无头测试运行器

```bash
nuka --test-plan test-plans/01-offline-boot.yaml
nuka --test-plan test-plans/01-offline-boot.yaml --reporter=tap
nuka --test-plan test-plans/01-offline-boot.yaml --update-snapshots
```

YAML 驱动、自带快照、可直接接 CI。示例计划覆盖离线启动、引导向导、
主题切换、统计视图、计划模式锁定，以及一个真实的插件回路。

## 磁盘布局

`~/.nuka/` 按需创建，每次启动会跑一次保留扫描：

| 目录            | 保留期 | 内容                                            |
|-----------------|--------|-------------------------------------------------|
| `tasks/`        | 14 天  | `<id>.log` + `<id>.meta.json` 每个后台任务       |
| `teams/<name>/` | —      | 单个团队的 `config.json`（zod 校验）             |
| `forks/<sess>/` | 24 小时| 缓存安全的 fork 快照                            |
| `recaps/`       | 90 天  | `/recap` 落盘的 Markdown                        |
| `events/`       | 7 天   | NDJSON 事件日志（默认关）                       |
| `harness/`      | —      | 单会话便签（上限 50 KB）                        |
| `memdir/`       | —      | autoDream 整理目标                              |

## 配置作用域

四层叠加，后者覆盖前者：

```
enterprise → user (~/.nuka/config.yaml) → project (.nuka/) → local (.nuka/local.yaml)
```

`nuka config show [--scope user]` 打印解析后的配置树。

## 项目结构

```
src/
  core/            tasks · agents · events · messaging · teams · pipeline · harness · recap
  tui/             Ink 组件 —— Conversation、Tasks、Monitor、子菜单
  slash/           内置斜杠命令
  cli.tsx          REPL 启动入口
docs/superpowers/  设计规约与实现计划
test-plans/        无头测试运行器的 YAML 场景
examples/          可运行的插件样例
```

## 贡献

欢迎 Issue 与 PR。重要变更先在 `docs/superpowers/` 下提交设计规约
与实现计划 —— 这本身就是 Harness 强制的工作流。

## License

待定。维护者另行声明前保留所有权利。
