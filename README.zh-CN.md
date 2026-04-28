# Nuka

插件优先的 CLI 编程助手。流式 TUI、多 Agent 调度、LSP 工具，单包约
285 KB。

[English](README.md) · [简体中文](README.zh-CN.md)

## 安装

```bash
git clone https://github.com/kry4r/Nuka.git
cd Nuka
npm install
npm run build
npm link
```

## 配置

`~/.nuka/config.yaml`：

```yaml
providers:
  - id: anthropic
    type: anthropic
    apiKey: sk-ant-...
    model: claude-opus-4-7
defaultProvider: anthropic
```

未配置 Provider 时 Nuka 进入离线模式，可通过 `/config` 或直接编辑配置
文件添加。

## 运行

```bash
nuka
```

输入消息回车发送，或键入 `/` 调用斜杠命令，`?` 查看帮助。

## TUI 概览

自上而下的四区布局：

```
+- Conversation ---------------------+
| 欢迎屏 / 消息流 / 工具调用折叠     |
+------------------------------------+
+- Tasks ----------------------------+    （Ctrl+T 折叠）
| Plan 清单                          |
| Subagents                          |
| Backgrounds                        |
+------------------------------------+
+- Prompt ---------------------------+
| > _                                |
+------------------------------------+
+- Status ---------------------------+
| mode | model | cwd | ctx | $ | ⏱   |
+------------------------------------+
```

`Conversation` 撑满剩余高度；`Tasks`、`Prompt`、`Status` 高度固定。
`Tasks` 三栏全空时整体隐藏。

按键：

| 按键     | 动作                                             |
|----------|--------------------------------------------------|
| `/`      | 打开斜杠命令列表                                 |
| `@`      | 引用文件                                         |
| `Ctrl+T` | 折叠/展开 Tasks 面板                              |
| `Esc`    | 关闭当前子菜单，或取消正在进行的回合              |
| `Tab`    | 接受斜杠候选                                     |
| `?`      | `/help`                                          |

斜杠命令和各类对话框（模型选择、配置编辑、会话、统计、诊断）都以
单层子菜单形式渲染，接管下方区域；按 `Esc` 即返回常规布局。

## 插件开发

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
    description: 严谨的代码审查
    systemPrompt: 你是一名严格的审查者...
    allowedTools: [Read, Grep, Glob]
    keywords: [review, audit]

userConfig:    { fields: [{ name: token, type: string, required: true }] }
dependencies:  [{ name: shared-lib, required: true }]
```

完整可运行示例见 `examples/plugin-cli-tool/`。

### 进程内工具

```js
// tools/echo.js
export default {
  name: 'echo',
  description: '将输入文本转为大写',
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

### Spawn 包装的 CLI 工具

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

### Skill `requires`

Skill frontmatter 可声明能力 tag。激活时，Nuka 会在核心工具集基础上
叠加 `tags` 与之相交的工具：

```markdown
---
name: deploy-helper
when:
  keyword: ["deploy", "release"]
requires: ["git", "vcs.read"]
---
建议发布分支前，使用 git-log 查看最近提交。
```

## 测试框架

Nuka 内置无头 TUI 运行器，由 YAML 计划驱动：

```bash
nuka --test-plan test-plans/01-offline-boot.yaml
nuka --test-plan test-plans/01-offline-boot.yaml --reporter=tap
nuka --test-plan test-plans/01-offline-boot.yaml --update-snapshots
npx vitest run test/integration/samplePlans.test.ts
```

`test-plans/` 中包含若干示例计划：离线启动、引导向导、主题切换、
状态视图、计划模式锁定。

## 配置作用域

配置按四层叠加（后者覆盖前者）：

```
enterprise -> user (~/.nuka/config.yaml) -> project (.nuka/) -> local (.nuka/local.yaml)
```

`nuka config show [--scope user]` 打印解析后的配置树。

## 贡献

欢迎 Issue 与 PR。每个重要变更都附带 `docs/superpowers/` 下的设计
规约与实现计划。

## License

待定。在维护者另行声明前保留所有权利。
