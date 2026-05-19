<div align="center">

<img src="assets/logo.png" alt="Nuka" width="160" />

# Nuka

**A plugin-first coding assistant in your terminal.**

Streaming TUI · Multi-agent swarm · Hook-driven extensibility · Zero MCP

[English](README.md) · [简体中文](README.zh-CN.md)

[![bundle](https://img.shields.io/badge/bundle-706_KB-brightgreen)](#)
[![tests](https://img.shields.io/badge/tests-4605_passing-success)](#)
[![node](https://img.shields.io/badge/node-%E2%89%A518-blue)](#)
[![license](https://img.shields.io/badge/license-TBD-lightgrey)](#license)

</div>

---

## Why Nuka

Most coding agents either lock you into their own runtime or reduce every task to the same TDD-shaped loop. Nuka takes the other path.

- **Plugin-first** — Tools, slash commands, skills, hooks, LSP servers, sub-agents all live in YAML manifests you drop into a folder
- **Hook-driven** — 7 built-in handlers + user `.nuka/hooks.config.{js,mjs}` + plugin `inProcessHooks:` field, with pipeline composition
- **Profile-aware** — A bug fix needs TDD; an exploration doesn't. The harness picks the stage shape that fits the task
- **Swarm built-in** — Named teammates, persisted teams, DAG pipelines, roundtables run alongside the main session
- **TUI tells the truth** — Live multi-column tasks panel + full-screen `/monitor` shows every agent token-by-token
- **Zero MCP** — Deliberately not supported; cleaner provider surface, no protocol overhead

Single-process, single bundle, no daemon.

## Quick start

```bash
git clone https://github.com/kry4r/Nuka.git
cd Nuka
npm install
npm run build
npm link

nuka
```

Add a provider on first launch via `/settings`, or write `~/.nuka/config.yaml`:

```yaml
providers:
  - id: anthropic
    type: anthropic
    apiKey: ${env:ANTHROPIC_API_KEY}   # resolved from env, never written to disk
    model: claude-opus-4-7
defaultProvider: anthropic
```

> **Security note** — Nuka writes config files with mode `0600`. Project-scope `.nuka/` is gitignored. Prefer the `${env:VAR}` form over inline keys.

No provider configured? Nuka boots offline — perfect for trying the TUI, plugins, and the test runner without burning tokens.

## Features at a glance

### Core runtime

| Feature | What it does |
|---|---|
| **Hook system** | 7 built-in handlers (recentFiles / auto-truncate / apply-diff-permission / pathDisplay / jsonFormat / wordWrap / urlExtract) + plugin `inProcessHooks:` + pipeline composition (default) |
| **Lifecycle events** | 7 fire points: `sessionStart` / `sessionEnd` / `promptSubmit` / `afterTurn` / `beforeAutoCompact` / `afterAssistantMessage` (with `replaceText` mutation) / `shellHookExecuted` |
| **Plan mode** | `EnterPlanMode` → `PermissionHint='ask'` → state flip → `PermissionChecker` gating + TUI badge with dedicated `variant: 'planMode'` dialog |
| **Cron** | Scheduler tick (`NUKA_CRON_SCHEDULER=1`) + `lastFiredAt` persistence + REPL prompt injection on fire |
| **AutoCompact** | Pure orchestrator + session-aware wrapper, `{skip:true}` veto hook |
| **AwaySummary** | Idle watcher + LLM recap + persistent TUI banner; first keystroke dismisses |
| **Worktree** | `EnterWorktree` swaps `cwd` for all subsequent tool calls; sub-agents inherit by default |
| **LSP** | 7 actions: definition / references / hover / documentSymbols / workspaceSymbol / implementation / callHierarchy |
| **Sub-agents** | Dispatch with hookRegistry threading, YAML/JSON definitions in `.nuka/subagents/` |

### Tool surface

38+ agent-callable tools, lazy-loaded into a sidecar bundle (only what you call gets imported):

- **File ops** — ApplyDiff / FindReplace / FileSearch / RecentFiles / Glob
- **Text utils** — TextStats / Whitespace / CaseConvert / JsonFormat / JsonEscape / CodeBlocks / Truncate / WrapText / Slug / UrlExtract / StringWidth / AnsiStyle
- **Code intel** — LSPQuery (7 actions)
- **Token mgmt** — TokenCount / StructuredOutput
- **Tools mgmt** — HookList / ToolSearch / ToolSummary
- **Time / lifecycle** — Sleep / AwaySummary / FormatDuration
- **Cron** — CronCreate / CronList / CronDelete
- **Worktree** — EnterWorktree / ExitWorktree
- **Plan mode** — EnterPlanMode / ExitPlanMode / IsInPlanMode
- **Tasks** — TaskOutput / TaskStop / TaskList / TaskCreate
- **Web** — WebFetch (private-IP filtered, redirect-rechecked)
- **Sub-agent** — dispatchAgent / Brief

### TUI

| Component | Behavior |
|---|---|
| **Three-slot layout** | Status pin / messages / input always pinned to bottom |
| **Tasks panel** | 5-column (`Plan` / `Subagents` / `Pipeline` / `Backgrounds` / `Msgs`), compact fallback under ~100 cols |
| **Persistent banners** | `AwaySummary` / `EmergencyTip` / `CronMissed` all in BOTTOM slot, auto-dismiss after first user message |
| **Prompt mentions** | `@` triggers palette; file / diff / staged / git / url references resolved through `promptContextReferences` |
| **Theme** | 12-key semantic palette × 5 themes via `useColors` / `useTheme` |
| **Loading** | ⚡ rotating glyph (Nuka signature) |

### Extensibility

| Mechanism | Path |
|---|---|
| User hooks | `~/.nuka/hooks.config.{js,mjs}` or `./.nuka/hooks.config.{js,mjs}` |
| Sub-agents | `.nuka/subagents/*.{yaml,yml,json}` |
| Output styles | `.nuka/output-styles/*.md` (markdown + YAML frontmatter, `NUKA_OUTPUT_STYLE=<name>` to activate) |
| Skills | `.nuka/skills/*.md` (registry + disk loader) |
| Plugin hooks | `plugin.yaml inProcessHooks: <path-to-js>` — namespaced ID `plugin:<name>:<entry-id>` |

## Tour

```
┌─ Conversation ──────────────────────────────────────┐
│ Welcome · streamed messages · folded tool calls     │
├─ Tasks (Ctrl+T) ────────────────────────────────────┤
│ Plan │ Subagents │ Pipeline │ Backgrounds │ Msgs    │
├─ Banners (persistent) ──────────────────────────────┤
│ AwaySummary · EmergencyTip · CronMissed             │
├─ Prompt ────────────────────────────────────────────┤
│ > _                                                 │
├─ Status ────────────────────────────────────────────┤
│ mode · model · cwd · ctx · cost · turn time         │
└─────────────────────────────────────────────────────┘
```

| Key            | Action                                              |
|----------------|-----------------------------------------------------|
| `/`            | Slash command palette                               |
| `@`            | Prompt mention (file / diff / git / url / image)    |
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
| `/recap`      | Build a structured recap of the session, persisted to `~/.nuka/recaps/`      |
| `/harness`    | Drive the workflow stage machine — `deep` · `fast` · `off` · `status`        |
| `/teams`      | List and inspect teams persisted under `~/.nuka/teams/`                      |
| `/settings`   | Edit providers, models, theme, and feature flags inline                      |
| `/sessions`   | Browse and resume prior sessions                                             |
| `/stats`      | Token, cost, and latency rollups                                             |
| `/doctor`     | Health check of providers, plugins, LSP, and on-disk layout                  |

Hit `?` for the full list.

## Plugin manifest

Drop a manifest, restart, done.

```yaml
# plugin.yaml
name: my-plugin
version: 1.0.0

tools:         [tools/foo.js]
slashCommands: [slash/bar.js]
skills:        [skills/baz.md]
hooks:         hooks.json
inProcessHooks: hooks/index.mjs    # in-process hook handlers
bin:           { my-cli: ./bin/my-cli.js }
lspServers:    [{ name: ts, command: typescript-language-server }]

agents:
  - name: reviewer
    description: Strict code reviewer
    systemPrompt: You are a strict reviewer...
    allowedTools: [Read, Grep, Glob]
    keywords: [review, audit]
```

Runnable examples live in `examples/plugins/`. See `docs/plugin-hooks.md` for the in-process hook handler contract.

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
<summary>Skill with capability tags</summary>

```markdown
---
name: deploy-helper
when:
  keyword: ["deploy", "release"]
requires: ["git", "vcs.read"]
---
Use git-log to inspect recent commits before suggesting a release branch.
```

A skill exposes the core tool set plus any tools whose `tags` intersect the skill's `requires` list.
</details>

## Configuration

Four layers, later overrides earlier:

```
enterprise → user (~/.nuka/config.yaml) → project (.nuka/) → local (.nuka/local.yaml)
```

`nuka config show [--scope user]` prints the resolved tree.

### Environment variables

| Variable | Effect |
|---|---|
| `NUKA_HOOK_PIPELINE_MODE=last-write-wins` | Opt out of pipeline composition for `afterToolCall` hooks (default: pipeline) |
| `NUKA_PATH_DISPLAY_HOOK=1` | Enable path-display rewriter |
| `NUKA_JSON_FORMAT_HOOK=1` | Pretty-print compact JSON tool output |
| `NUKA_WORD_WRAP_HOOK=1` (`NUKA_WORD_WRAP_WIDTH=<int>`) | Wrap long lines to terminal width |
| `NUKA_URL_EXTRACT_HOOK=1` | Annotate tool results with extracted URLs |
| `NUKA_WHITESPACE_HOOK=1` | Normalize whitespace in assistant messages |
| `NUKA_APPLY_DIFF_ALLOWED_ROOTS=<paths>` | Restrict ApplyDiff to allowlist (comma-separated) |
| `NUKA_CRON_SCHEDULER=1` | Start cron tick loop in REPL |
| `NUKA_CRON_INJECT_PROMPTS=1` | Inject cron-fired prompts into agent input |
| `NUKA_OUTPUT_STYLE=<name>` | Activate an output style from `.nuka/output-styles/` |
| `NUKA_WEBFETCH_ALLOW_LOCAL=1` | Allow WebFetch to hit private IPs (default: blocked) |
| `NUKA_COORDINATOR_MODE=1` | Restrict lead agent to coordination tools |

## Headless test runner

```bash
nuka --test-plan test-plans/01-offline-boot.yaml
nuka --test-plan test-plans/01-offline-boot.yaml --reporter=tap
nuka --test-plan test-plans/01-offline-boot.yaml --update-snapshots
```

YAML-driven, snapshot-friendly, CI-ready. Sample plans cover offline boot, onboarding, theme switching, stats, plan-mode lockout, and a real plugin loop.

## On-disk layout

Nuka lays out `~/.nuka/` lazily and runs a once-per-process retention sweep:

| Directory       | Retention | Contents                                          |
|-----------------|-----------|---------------------------------------------------|
| `tasks/`        | 14 days   | `<id>.log` + `<id>.meta.json` per background task |
| `teams/<name>/` | —         | `config.json` (zod-validated) per team            |
| `forks/<sess>/` | 24 hours  | Cache-safe fork snapshots                         |
| `recaps/`       | 90 days   | Persisted `/recap` Markdown                       |
| `events/`       | 7 days    | Optional NDJSON event log (off by default)        |
| `harness/`      | —         | Per-session scratchpad (50 KB cap)                |
| `memory/<cwd>/` | —         | autoDream consolidation target + project memory   |
| `subagents/`    | —         | YAML/JSON sub-agent definitions                   |
| `output-styles/`| —         | Markdown system-prompt extensions                 |
| `skills/`       | —         | Markdown skill manifests                          |
| `plugins/`      | —         | Installed plugins                                 |
| `recent-files.json` | —     | MRU file list                                     |
| `config.yaml`   | —         | User config (mode 0600)                           |

## Project layout

```
src/
  core/            tasks · agents · events · messaging · teams · pipeline · harness · recap · hooks · outputStyles · skill · memdir · worktree · cron · ...
  tui/             Ink components — Conversation · Tasks · Monitor · Submenus · Status banners
  slash/           built-in slash commands
  promptContextReferences/   @ mention resolver
  cli.tsx          REPL boot
docs/plans/        design specs and implementation plans
test-plans/        YAML scenarios for the headless runner
examples/plugins/  runnable plugin samples
```

## Status

Built across 14 autonomous `/loop` evolution turns (2026-05). Plan-doc: `docs/plans/2026-05-17-nuka-feature-port-status.md` tracks the full feature inventory, every trade-off accepted, and follow-ups still on the table.

- **96 features** ported from upstream (Nuka-Code)
- **+ 17 features** in turns 11-14 closing P0/P1 deferred follow-ups
- **300+ new tests** across the evolution series
- **MCP residue purged** (zero functional references)
- **strict TS** / **zero new deps** / **additive over replacement**
- **ink-ui-explorer shipped** (Phase 9.5) — L0/L1/L2/L3/L4 explorer verbs + skill packaging; see `docs/superpowers/index.md`

## Contributing

Issues and pull requests welcome. Significant changes start with a design spec and an implementation plan under `docs/plans/` — matching the workflow the harness itself enforces.

## License

TBD. All rights reserved by the maintainer until declared.
