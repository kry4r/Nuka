# Nuka Phase 8 — Feature Evolution Design

**Status:** active. Successor to Phase 7. Baseline: `main` HEAD `422605a`, 966 tests, `dist/cli.js` 301.7 KB.

**Reference:** `/data/xtzhang/Nuka-Code` survey (Phase 8 candidate scope, 2026-04-25). Picked 5 high-value features; skipped task-system (deferred to Phase 9 infra).

## 1. Goals

| ID | Feature | Source |
|---|---|---|
| **8.1** | **Theme switcher** — `/theme` slash + theme registry + applied via `useTheme()` hook. Light/dark/contrast/solarized seed set. Persisted in `config.theme.name`. | Nuka-Code `commands/theme/` |
| **8.2** | **Stats** — `/stats` slash. Aggregates over `~/.nuka/cost.json` + `~/.nuka/sessions/`. Two tabs (Overview / Models). ASCII bar chart for tokens-by-model. Cycles ranges all/7d/30d via `r`. | Nuka-Code `commands/stats/` |
| **8.3** | **Rewind / checkpoints** — `/rewind` slash. Picks a prior assistant message; truncates session transcript at that point and resets cwd file checkpoints (when `config.rewind.fileCheckpointing: true`). | Nuka-Code `commands/rewind/` |
| **8.4** | **Plan mode** — `/plan on/off`. Forces `permission.mode = 'plan'` so writes/destructive tools are blocked; agent must produce a plan first. Plan persists to `.nuka/plan.md` per-cwd. `/plan apply` exits plan mode and lets the agent execute. | Nuka-Code `commands/plan/` |
| **8.5** | **IDE bridge** — `/ide`. Detects running IDEs (VS Code via `code --status`, JetBrains via lockfile, Cursor, Windsurf). Lists; on selection registers an `sse-ide` MCP server entry into the live `McpManager`. | Nuka-Code `commands/ide/` |

## 2. Non-goals

- `/ultraplan` (remote CCR integration). Deferred indefinitely — too coupled to Anthropic infra.
- Polymorphic task-system (7 kinds, kill/pause/notify semantics). Deferred to a future phase if/when long-running background work demands it; current dispatch_agent + parallel batches cover the agent-CLI use case.
- Per-IDE deep extensions (only the MCP `sse-ide` registration; no debug-protocol bridges).
- Theme animation / shimmer effects.
- Stats heatmap (calendar grid). ASCII bar for tokens-by-model is enough.

## 3. Module layout

### Existing modules touched
- `src/tui/App.tsx` — wrap children in a `ThemeProvider`; pass `useTheme()` colors to ToolCall / StatusBar / Hud.
- `src/core/permission/checker.ts` — already has `mode`; extend to honor `'plan'` mode by rejecting any tool with `annotations.destructive` or `annotations.openWorld` *and* writes (`Write` / `Edit` / `Bash`).
- `src/core/agent/loop.ts` — at session-end (rewind branch point), expose a `truncateAt(messageId)` API.
- `src/core/session/types.ts` — `Session` gains optional `rewindCheckpoints: Array<{messageId, ts, fileSnapshots: Record<path, sha1>}>`.
- `src/core/mcp/manager.ts` — `addServer(name, def)` and `removeServer(name)` for runtime registration (used by `/ide`).
- `src/core/cost/persist.ts` — gain `readByRange(range: 'all'|'7d'|'30d')` helper for `/stats`.

### New modules
- `src/core/theme/` — `themes.ts` (registry: `default-dark`, `default-light`, `solarized-dark`, `solarized-light`, `high-contrast`), `context.tsx` (React context + `useTheme`).
- `src/core/stats/` — `aggregate.ts` (load cost + session metas, group by model + day), `chart.ts` (ASCII bar with widths).
- `src/core/rewind/` — `checkpoint.ts` (snapshot file SHA1s for tracked files via git ls-files when in a git repo, fall back to a manual list), `restore.ts`.
- `src/core/plan/` — `state.ts` (per-cwd plan storage at `.nuka/plan.md` or `~/.nuka/plans/<sha1(cwd)>.md`), `gate.ts` (permission predicate).
- `src/core/ide/` — `detect.ts` (probes), `register.ts` (mutates McpManager).
- `src/slash/{theme,stats,rewind,plan,ide}.ts`.
- `src/tui/Stats/{StatsView,ModelChart,RangeTabs}.tsx`.
- `src/tui/Rewind/MessageSelector.tsx`.

## 4. Design decisions

### 4.1 Theme

A theme is a flat map of named tokens:
```ts
export type Theme = {
  name: string
  colors: {
    fg: string; bg: string; muted: string;
    accent: string; success: string; warn: string; error: string;
    plan: string; permission: string; userMsg: string; assistantMsg: string;
    diffAdd: string; diffDel: string;
    agent: { primary: string; alt: string }
  }
}
```
Render with `<ThemeProvider theme={resolved}>`; `useTheme()` returns the active object. ToolCall/Hud/StatusBar/MessageRow read colors via `useTheme()`. Component prop fallbacks unchanged so legacy tests keep passing.

`/theme` flow:
- `/theme list` → tabular list.
- `/theme <name>` → write to `config.theme.name`, hot-swap context.
- `/theme` (no args) → interactive picker (arrow keys + Enter).

### 4.2 Stats

Inputs:
- `~/.nuka/cost.json` for tokens/USD.
- `~/.nuka/sessions/*.json` metas for session count + duration + active days.

Output (two-tab view, `Tab` cycles):
```
[ Overview ]  Models
─────────────────────────────────────
 Sessions      42        Active days  18
 Total tokens  3.2M      Streak       7d
 Total cost    $12.41    Peak hr      14:00
 Avg / session 76k tok / $0.30
```

```
 Overview  [ Models ]
─────────────────────────────────────
 claude-opus-4-7   ████████████ 2.1M  $9.20
 claude-sonnet-4-6 ██████       0.8M  $2.40
 gpt-4o            ██           0.3M  $0.81
```

`r` cycles range (all / 30d / 7d). `Esc` exits.

### 4.3 Rewind

`Session.history[]` is the source of truth. `/rewind`:
1. Lists assistant messages with one-line previews (last 10).
2. User picks one; we drop everything after it from `Session.history[]`.
3. If `config.rewind.fileCheckpointing` and we're in a git repo, we offer `git stash` of current changes plus `git checkout` of the snapshotted SHA per file. (Off by default — too destructive for an MVP.)
4. Persist the truncated session and re-render the transcript.

### 4.4 Plan mode

`PermissionMode = 'normal'|'auto'|'plan'`. In `'plan'`:
- Reject `Write`, `Edit`, `Bash` (with non-readOnly bash policy not yet exposed — gate by tool name for now).
- Reject any MCP tool whose annotations declare `destructive` or `openWorld`.
- Read-only tools (Read/Glob/Grep/WebFetch/WebSearch + LSP read tools) pass.

`/plan on` writes `permission.mode = 'plan'` into the active session and shows a banner. `/plan write <text>` appends `<text>` to `~/.nuka/plans/<sha1(cwd)>.md`. `/plan show` cats it. `/plan apply` exits plan mode.

Plan content is auto-injected into the system prompt under `## Plan` when `permission.mode === 'plan'` AND the file exists.

### 4.5 IDE bridge

Detection probes (all best-effort, no exception escapes):
- VS Code: `which code` AND `code --status` returns 0.
- JetBrains: scan `~/.config/JetBrains/` and `~/Library/Application Support/JetBrains/` for `*.lock` files.
- Cursor: `which cursor`.
- Windsurf: `which windsurf`.

`/ide` lists detected IDEs; on selection, register an MCP server:
```yaml
mcpServers:
  ide:
    type: sse
    url: http://localhost:<port>/mcp
```
Port is fixed per IDE family (VS Code: 4096 default; user can override via env). When the IDE extension isn't installed, the SSE connect fails — surfaces a helpful error message linking to install instructions.

`/ide disconnect` removes the entry.

## 5. Failure modes

- Theme not found → fall back to `default-dark`; warn once.
- Stats with empty cost.json → show `(no data yet)`.
- Rewind on a session with <2 turns → no-op with hint.
- Plan-gate refuses a tool → emit `tool_result {isError:true}` with `"blocked: plan mode is active. Use /plan apply to execute."` so the agent can self-correct.
- IDE detect with no IDE → `(no IDEs detected — see docs/ide.md)`.

## 6. Acceptance

- `npm test` ≥ 1020 passing (966 baseline + ~60 new).
- `npm run typecheck` clean.
- `npm run build` ≤ 360 KB.
- `/theme`, `/stats`, `/rewind`, `/plan`, `/ide` slashes appear in `/help`.
- Plan-gate blocks a `Write` tool call with the expected error.
- Rewind truncates session.history[] correctly.
- Theme hot-swap visible in HUD on `/theme default-light`.

## 7. Out of scope (Phase 9 / 10)

- Task system.
- Ultraplan / remote CCR.
- Embedded debugger / IDE protocol bridges.
- Heatmap calendar in Stats.
- Theme shimmer / animations.
- File-checkpointing rewind (default off; full impl in Phase 10 once stash/checkout safety is proven).
