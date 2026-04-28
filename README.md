# Nuka

A plugin-first CLI coding assistant. Stream-rendered TUI, multi-agent
dispatch, LSP-aware tools, in a single ~285 KB bundle.

[English](README.md) · [简体中文](README.zh-CN.md)

## Install

```bash
git clone https://github.com/kry4r/Nuka.git
cd Nuka
npm install
npm run build
npm link
```

## Configure

`~/.nuka/config.yaml`:

```yaml
providers:
  - id: anthropic
    type: anthropic
    apiKey: sk-ant-...
    model: claude-opus-4-7
defaultProvider: anthropic
```

If no provider is configured Nuka launches in offline mode and you can
add one through `/config` or by editing the file.

## Run

```bash
nuka
```

Type a message and press enter, or `/` for slash commands. Press `?` for
help.

## TUI overview

Four stacked zones, top to bottom:

```
+- Conversation ---------------------+
| Welcome / Messages / tool folds    |
+------------------------------------+
+- Tasks ----------------------------+    (Ctrl+T to collapse)
| Plan checklist                     |
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

`Conversation` grows to fill height; `Tasks`, `Prompt`, `Status` are
fixed. `Tasks` is hidden when there is nothing to show.

Key bindings:

| Key      | Action                                             |
|----------|----------------------------------------------------|
| `/`      | Open slash command list                            |
| `@`      | File mention                                       |
| `Ctrl+T` | Collapse / expand the Tasks panel                  |
| `Esc`    | Close the open submenu, or cancel the running turn |
| `Tab`    | Accept a slash candidate                           |
| `?`      | `/help`                                            |

Slash commands and dialogs (model picker, config editor, sessions,
stats, doctor) render as a single-stack submenu that takes over the
lower zones; `Esc` returns to the normal layout.

## Plugin authoring

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
    description: Reviews code for style + correctness
    systemPrompt: You are a strict reviewer...
    allowedTools: [Read, Grep, Glob]
    keywords: [review, audit]

userConfig:    { fields: [{ name: token, type: string, required: true }] }
dependencies:  [{ name: shared-lib, required: true }]
```

A complete runnable example lives in `examples/plugin-cli-tool/`.

### In-process tool

```js
// tools/echo.js
export default {
  name: 'echo',
  description: 'Echo input text uppercase',
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

### Spawn-wrapped CLI tool

```js
// tools/git-log.js
export default {
  name: 'git-log',
  description: 'Last 5 git commits',
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
  async run() { /* provided by spawn runtime */ },
}
```

### Skill `requires`

A skill's frontmatter can list capability tags. On activation, Nuka
exposes the core tool set plus any tools whose `tags` intersect
`requires`:

```markdown
---
name: deploy-helper
when:
  keyword: ["deploy", "release"]
requires: ["git", "vcs.read"]
---
Use git-log to inspect recent commits before suggesting a release branch.
```

## Test harness

Nuka ships a headless TUI runner driven by YAML plans:

```bash
nuka --test-plan test-plans/01-offline-boot.yaml
nuka --test-plan test-plans/01-offline-boot.yaml --reporter=tap
nuka --test-plan test-plans/01-offline-boot.yaml --update-snapshots
npx vitest run test/integration/samplePlans.test.ts
```

Sample plans (`test-plans/`): offline boot, onboarding wizard, theme
surface, stats view, plan-mode lockout.

## Configuration scopes

Config is layered in four scopes (later overrides earlier):

```
enterprise -> user (~/.nuka/config.yaml) -> project (.nuka/) -> local (.nuka/local.yaml)
```

`nuka config show [--scope user]` prints the resolved tree.

## Contributing

Issues and pull requests are welcome. Each significant change is
preceded by a design spec and an implementation plan under
`docs/superpowers/`.

## License

TBD. All rights reserved by the maintainer until declared.
