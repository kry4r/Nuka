<div align="center">

<img src="assets/logo.png" alt="Nuka" width="160" />

# Nuka

**A plugin-first coding assistant in your terminal.**

Streaming TUI · Multi-agent swarm · Profile-aware harness · Live monitor · Recap & dream

[English](README.md) · [简体中文](README.zh-CN.md)

[![bundle](https://img.shields.io/badge/bundle-376_KB-brightgreen)](#)
[![tests](https://img.shields.io/badge/tests-1421_passing-success)](#)
[![node](https://img.shields.io/badge/node-%E2%89%A518-blue)](#)
[![license](https://img.shields.io/badge/license-TBD-lightgrey)](#license)

</div>

---

## Why Nuka

Most coding agents either lock you into their own runtime or reduce
every task to the same TDD-shaped loop. Nuka takes the other path:

- **Plugins are first-class.** Tools, slash commands, skills, hooks, LSP
  servers, sub-agents — all live in YAML manifests you can drop into a
  folder.
- **Workflows are profile-aware.** A bug fix needs TDD; an exploration
  doesn't. The harness picks the stage shape and skill bundle that fits
  the task.
- **Swarm is built in, not bolted on.** Named teammates, persisted
  teams, DAG pipelines, and roundtables run alongside your main session.
- **The TUI tells the truth.** A live, multi-column tasks panel and a
  full-screen `/monitor` dashboard show exactly what every agent is
  doing — token by token.

Single-process, single bundle, no daemon to babysit.

## Quick start

```bash
git clone https://github.com/kry4r/Nuka.git
cd Nuka
npm install
npm run build
npm link

nuka
```

Add a provider on first launch via `/config`, or write `~/.nuka/config.yaml`:

```yaml
providers:
  - id: anthropic
    type: anthropic
    apiKey: sk-ant-...
    model: claude-opus-4-7
defaultProvider: anthropic
```

No provider configured? Nuka boots offline — perfect for trying the TUI,
plugins, and the test runner without burning tokens.

## Tour

```
┌─ Conversation ──────────────────────────────────────┐
│ Welcome · streamed messages · folded tool calls     │
├─ Tasks (Ctrl+T) ────────────────────────────────────┤
│ Plan │ Subagents │ Pipeline │ Backgrounds │ Msgs    │
├─ Prompt ────────────────────────────────────────────┤
│ > _                                                 │
├─ Status ────────────────────────────────────────────┤
│ mode · model · cwd · ctx · cost · turn time         │
└─────────────────────────────────────────────────────┘
```

The Tasks panel switches to the five-column layout the moment any
agent / message / harness event lands on the bus. Below ~100 columns it
collapses to a compact single-column fallback.

| Key            | Action                                              |
|----------------|-----------------------------------------------------|
| `/`            | Slash command palette                               |
| `@`            | File mention                                        |
| `Ctrl+T`       | Collapse / expand the Tasks panel                   |
| `Tab`          | Cycle column focus (also accepts slash candidates)  |
| `j` `k`        | Move row focus inside the focused column            |
| `Enter`        | Open the focused row's detail submenu               |
| `Esc`          | Close submenu, or cancel the running turn           |
| `?`            | Help                                                |

## Slash commands

| Command       | What it does                                                                 |
|---------------|------------------------------------------------------------------------------|
| `/monitor`    | Full-screen dashboard with **DAG**, **Timeline**, **Tokens** tabs            |
| `/recap`      | Build a structured recap of the session, persisted to `~/.nuka/recaps/`     |
| `/harness`    | Drive the workflow stage machine — `deep` · `fast` · `off` · `status` · `transition <stage>` |
| `/teams`      | List and inspect teams persisted under `~/.nuka/teams/`                      |
| `/config`     | Edit providers, models, theme, and feature flags inline                      |
| `/sessions`   | Browse and resume prior sessions                                             |
| `/stats`      | Token, cost, and latency rollups                                             |
| `/doctor`     | Health check of providers, plugins, LSP, and on-disk layout                  |

Hit `?` for the full list.

## Multi-agent swarm

```bash
# Inside a session, the lead agent in coordinator mode can spawn a team
NUKA_COORDINATOR_MODE=1 nuka
```

The lead is then restricted to coordination tools: `team_create`,
`team_delete`, `send_message` (point-to-point, qualified `team:X/Y`, or
broadcast `team:X/*`), `dispatch_agent`, `task_*`, `pipeline_run`,
`roundtable`. Workers dispatched through `dispatch_agent` see the full
tool set.

Five role agents ship out of the box: `core:planner`, `core:skeptic`,
`core:researcher`, `core:implementer`, `core:reviewer`.

## Workflow harness

Different tasks deserve different workflows. The harness encodes that:

| Profile     | Implement stage |
|-------------|-----------------|
| `feature`   | TDD mandatory   |
| `fix`       | TDD mandatory   |
| `refactor`  | TDD mandatory   |
| `docs`      | Required, no TDD|
| `config`    | Required, no TDD|
| `explore`   | Forbidden       |
| `research`  | Forbidden       |

Stages: `brainstorm → spec → plan → search → implement → review → recap`.
Each transition is gated by primitives (`sequential_thinking`,
`search_and_verify`, `ask_user_question`) — no escaping a stage without
the reflection it demands.

## Plugins

Drop a manifest, restart, done.

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
    description: Strict code reviewer
    systemPrompt: You are a strict reviewer...
    allowedTools: [Read, Grep, Glob]
    keywords: [review, audit]
```

A complete runnable example lives in `examples/plugin-cli-tool/`.

<details>
<summary>In-process tool</summary>

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
</details>

<details>
<summary>Spawn-wrapped CLI tool</summary>

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
</details>

<details>
<summary>Skill capability tags</summary>

```markdown
---
name: deploy-helper
when:
  keyword: ["deploy", "release"]
requires: ["git", "vcs.read"]
---
Use git-log to inspect recent commits before suggesting a release branch.
```

A skill exposes the core tool set plus any tools whose `tags` intersect
the skill's `requires` list.
</details>

## Headless test runner

```bash
nuka --test-plan test-plans/01-offline-boot.yaml
nuka --test-plan test-plans/01-offline-boot.yaml --reporter=tap
nuka --test-plan test-plans/01-offline-boot.yaml --update-snapshots
```

YAML-driven, snapshot-friendly, CI-ready. Sample plans cover offline
boot, onboarding, theme switching, stats, plan-mode lockout, and a real
plugin loop.

## On-disk layout

Nuka lays out `~/.nuka/` lazily and runs a once-per-process retention
sweep:

| Directory       | Retention | Contents                                       |
|-----------------|-----------|------------------------------------------------|
| `tasks/`        | 14 days   | `<id>.log` + `<id>.meta.json` per background task |
| `teams/<name>/` | —         | `config.json` (zod-validated) per team         |
| `forks/<sess>/` | 24 hours  | Cache-safe fork snapshots                      |
| `recaps/`       | 90 days   | Persisted `/recap` Markdown                    |
| `events/`       | 7 days    | Optional NDJSON event log (off by default)     |
| `harness/`      | —         | Per-session scratchpad (50 KB cap)             |
| `memdir/`       | —         | autoDream consolidation target                 |

## Configuration scopes

Four layers, later overrides earlier:

```
enterprise → user (~/.nuka/config.yaml) → project (.nuka/) → local (.nuka/local.yaml)
```

`nuka config show [--scope user]` prints the resolved tree.

## Project layout

```
src/
  core/            tasks · agents · events · messaging · teams · pipeline · harness · recap
  tui/             Ink components — Conversation, Tasks, Monitor, Submenus
  slash/           built-in slash commands
  cli.tsx          REPL boot
docs/superpowers/  specs and implementation plans
test-plans/        YAML scenarios for the headless runner
examples/          runnable plugin samples
```

## Contributing

Issues and pull requests are welcome. Significant changes start with a
design spec and an implementation plan under `docs/superpowers/` —
matching the workflow the harness itself enforces.

## License

TBD. All rights reserved by the maintainer until declared.
