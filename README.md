# Nuka

A plugin-first CLI coding assistant. Stream-rendered TUI, multi-agent
swarm, harness-driven workflow, monitor dashboard, recap & dream — in a
single ~376 KB bundle.

[English](README.md) · [简体中文](README.zh-CN.md)

## Highlights (Phase 14)

- **Multi-agent swarm** — named teammates with persisted teams (`team_create`,
  `team_delete`), `send_message` (bare / `team:X/Y` / broadcast `team:X/*`),
  Kahn-topo DAG `pipeline_run`, K-round `roundtable`, coordinator mode that
  filters lead tools to the swarm-internal whitelist while workers see the
  full set. Five default role agents: `core:planner`, `core:skeptic`,
  `core:researcher`, `core:implementer`, `core:reviewer`.
- **`/monitor` dashboard** — five-column Tasks panel (Plan / Subagents /
  Pipeline / Backgrounds / Messages) with `Tab` / `j` `k` / `Enter` focus,
  plus a full-screen view with DAG / Timeline / Tokens tabs that subscribe
  live to the EventBus.
- **`/recap` command** — nine field reducers (completed, in-flight, file
  diffs, tool timeline, messages, pipelines, tokens, decisions, next-step
  via fork-call) rendered to Markdown and persisted under
  `~/.nuka/recaps/`. Idle returns surface an `AwaySummaryCard` (1–3
  sentences). `autoDream` consolidates memdir on a 30-min tick.
- **`/harness` workflow** — profile-aware stage matrix (brainstorm → spec
  → plan → search → implement → review → recap). TDD is mandatory **only**
  for `feature` / `fix` / `refactor` profiles; `explore` / `research` /
  `docs` / `config` use leaner stage shapes. Three soft-gate primitives
  (`sequential_thinking`, `search_and_verify`, `ask_user_question`)
  enforce reflection before stage exit. Editor agent (`core:editor`) is
  denied Edit/Write/Bash and only dispatches workers.

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
| Plan | Subagents | Pipeline |      |
| Backgrounds | Messages              |
+------------------------------------+
+- Prompt ---------------------------+
| > _                                |
+------------------------------------+
+- Status ---------------------------+
| mode | model | cwd | ctx | $ | ⏱   |
+------------------------------------+
```

The Tasks panel auto-switches to the five-column layout once any swarm /
agent / message / harness event lands on the bus; below ~100 cols it
falls back to the legacy single-column view.

Key bindings:

| Key       | Action                                              |
|-----------|-----------------------------------------------------|
| `/`       | Open slash command list                             |
| `@`       | File mention                                        |
| `Ctrl+T`  | Collapse / expand the Tasks panel                   |
| `Tab`     | Cycle column focus inside Tasks (also accepts slash candidates) |
| `j` / `k` | Move row focus inside the focused Tasks column      |
| `Enter`   | Open the focused row's detail submenu (Subagent / Pipeline / Message) |
| `Esc`     | Close the open submenu, or cancel the running turn  |
| `?`       | `/help`                                             |

Slash commands and dialogs (model picker, config editor, sessions,
stats, doctor, monitor) render as a single-stack submenu that takes
over the lower zones; `Esc` returns to the normal layout.

## Swarm & workflow commands

| Slash         | Purpose |
|---------------|---------|
| `/monitor`    | Full-screen dashboard with DAG / Timeline / Tokens tabs |
| `/recap`      | Build a structured recap of the current session, persist to `~/.nuka/recaps/<date>-<sess>.md` |
| `/harness`    | Drive a profile-aware workflow stage machine: `deep` / `fast` / `off` / `reset` / `status` / `transition <stage>` |
| `/teams`      | List / inspect persisted teams under `~/.nuka/teams/` |

In coordinator mode (`NUKA_COORDINATOR_MODE=1`) the lead session is
restricted to `team_create` / `team_delete` / `send_message` /
`dispatch_agent` / `task_*` / `synthetic_output`. Workers dispatched via
`dispatch_agent` see the full tool set.

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

## On-disk layout

Nuka boots `~/.nuka/` lazily and runs a once-per-process retention sweep:

| Dir              | Retention | Contents                                       |
|------------------|-----------|------------------------------------------------|
| `tasks/`         | 14 days   | `<id>.log` + `<id>.meta.json` per background task |
| `teams/<name>/`  | n/a       | `config.json` (zod-validated) per team         |
| `forks/<sess>/`  | 24 hours  | `<fork-id>.json` for prompt-cache-safe forks   |
| `recaps/`        | 90 days   | Persisted `/recap` Markdown                    |
| `events/`        | 7 days    | Optional NDJSON event log (off by default)     |
| `harness/`       | n/a       | Per-session scratchpad (50 KB cap)             |
| `memdir/`        | n/a       | autoDream consolidation target                 |

## Contributing

Issues and pull requests are welcome. Each significant change is
preceded by a design spec and an implementation plan under
`docs/superpowers/`.

## License

TBD. All rights reserved by the maintainer until declared.
