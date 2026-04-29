# Phase 13 — Welcome / Status redesign + deferred-item closeout

**Date:** 2026-04-29
**Status:** Spec
**Author:** Brainstorming session 2026-04-29 (Phase 12 follow-up)

## 1. Problem

Phase 12 landed the four-zone TUI but two zones still feel rough, and three deferred items from Phase 12 §8 remain open:

1. **Welcome screen is barren and left-aligned.** Logo is wrapped in a paddingless `Box`; tips/version/model/cwd stack in a single column without a visual frame; no "what's new" or "recent" surface. Reference is Claude Code's launch home — centered hero + sidebar with updates + recent.
2. **Status panel is left-crammed.** Six rows all flush-left; nothing balances the right margin; runtime elapsed (`⏱`) is noise the user doesn't act on; the `context` row hides actually useful info (no input/output split, no percentage). No icon-vs-text toggle for users on terminals without Nerd-font / unicode glyphs.
3. **StatsView async-timing flake** has dogged three Phases — `test/tui/testing/harness.test.tsx > /stats opens dialog` flips between `Loading…` and `no data yet` non-deterministically.
4. **Tasks panel is read-only** — no Tab focus, no `j/k` navigation, no Enter expansion (deferred from Phase 12 §8).
5. **Config submenu has no list-editing** — provider list, plugin enable list etc. fall back to `$EDITOR` (deferred from Phase 12 §8).

## 2. Goals

1. **Welcome redesign**: 2/3 left "Welcome" framed panel (centered Logo + NUKA + minimal one-line model/cwd + key hint) + 1/3 right column split vertically into "Updates" (top half) and "Recent" (bottom half), each its own framed panel.
2. **Status redesign**: balanced left-right layout (left column: mode/model/cwd; right column: context detail / cost / counts); drop time tracking; expand context row to show `<used>k / <max>k · <pct>% · in:<n> out:<n>`; introduce **icon vs text** mode toggleable via new `/status-hub` slash command.
3. **Fix StatsView flake** properly so it stays green across runs.
4. **Tasks focus mode**: Tab from Prompt enters Tasks focus, `j/k` navigates items, `Enter` expands the focused item to a `tasks` full submenu, Esc returns to normal.
5. **Multi-select / list-editing fields** in Config submenu — at minimum `providers` list (add/remove/edit) and `plugins.enabled` checklist.

## 3. Non-Goals

- No agent-loop / tool-system / session changes.
- No new theme, no new submenu kinds beyond the planned `tasks` expansion.
- No mouse support.
- No animated transitions.

## 4. Architecture

### 4.1 Welcome screen (M2)

Two top-level horizontal regions, **2:1** width split:

```
╭─ Welcome ────────────────────────────────────────────╮ ╭─ Updates ──────────────╮
│                                                      │ │ v0.1.3 · 2026-04-29    │
│              <Logo braille glyph, 11 rows>           │ │ • Welcome redesign     │
│                                                      │ │ • /status-hub toggle   │
│                       NUKA                           │ │ • Tasks focus mode     │
│                                                      │ │                        │
│                  <model>  ·  <cwd>  <branch>         │ │ v0.1.2 · 2026-04-28    │
│                                                      │ │ • Phase 12 TUI redesign│
│                Type / for commands                   │ │ • avocado palette      │
│                                                      │ ╰────────────────────────╯
│                                                      │ ╭─ Recent ───────────────╮
│                                                      │ │ ↩ refactor tool registry│
│                                                      │ │   2026-04-29 14:02     │
│                                                      │ │ ↩ phase12 tui redesign │
│                                                      │ │   2026-04-29 11:30     │
│                                                      │ │ ↩ phase11 mcp removal  │
│                                                      │ │   2026-04-28 22:15     │
╰──────────────────────────────────────────────────────╯ ╰────────────────────────╯
```

- **Width split**: left flexBasis 2, right flexBasis 1 (Ink flex). Right column min-width 24 cols, max 32; left always takes the remainder.
- **Right column inner split**: two stacked panels each with `flexGrow={1}`, identical height. Updates on top, Recent on bottom.
- **Centering inside Welcome**: vertical block centered via top-padding computed from `useTerminalSize` rows minus 4-zone reserved height. Horizontal centering via `<Box justifyContent="center">`. Logo, NUKA wordmark, model line, hint line — all centered.
- **Welcome contents** (top to bottom, all centered):
  1. Logo (11-row braille glyph; existing `<Logo>` component reused).
  2. blank row.
  3. `NUKA` wordmark in `primary` bold.
  4. blank row.
  5. `<model>  ·  <cwd>  <branch>` in `fgMuted`, no labels (the "minimal one line"). Branch suffix `●` if dirty.
  6. blank row.
  7. `Type / for commands` in `fgMuted` with `/` highlighted in `primary`. (No tip, no `?` and `esc` hint — those live in the Prompt footer once the user starts typing.)
- **Border**: all three frames use `fgMuted` (welcome screen has no focus target).
- **Narrow-terminal degradation (<100 cols)**: right column is hidden; Welcome takes 100% width; same vertical centering.
- **No-data degradation**: if Updates source is empty, Updates frame still renders with one line `(no updates)` in `fgFaint`. Same for Recent. Both being empty does NOT collapse the column — it would unbalance the 2:1 split mid-launch.

#### 4.1.1 Updates data source

`~/.nuka/updates.json` — hand-curated by maintainer, optional. Schema:

```ts
type UpdatesFile = { entries: UpdateEntry[] }
type UpdateEntry = {
  version: string             // "0.1.3"
  date: string                // ISO date "2026-04-29"
  bullets: string[]           // ≤4 entries; each ≤44 chars before truncation
}
```

Loaded by `src/core/updates/load.ts` (new). Returns `[]` if file missing, malformed, or empty. Renderer shows up to 6 entries; each entry displays version + date heading + up to 4 bullets prefixed by `•`. Bullets longer than panel width are truncated with `…`.

Repository ships a starter `~/.nuka/updates.json` template via the onboarding wizard / first-run scaffold (out of Phase 13 scope; for now, document creation in README).

#### 4.1.2 Recent data source

`~/.nuka/sessions/*.json` (existing Phase 5 session store). New helper `src/core/session/recent.ts` (or extend `manager.ts`):

```ts
function listRecentSummaries(home: string, limit: number): Promise<RecentItem[]>
type RecentItem = {
  id: string
  firstUserText: string  // first user message, truncated to 36 chars
  ts: number             // session.ts or first message ts
}
```

Sort newest-first. Render up to 6 items: `↩ <text…>` + sub-line `<formatted ts>` in `fgFaint`. Empty store → `(no recent sessions)`.

### 4.2 Status panel redesign (M3)

#### 4.2.1 New layout shape

Replace the current vertical-stack `dense` layout with a **two-column** dense layout. Existing `compact` (two folded rows with `·`) and `oneline` modes are kept for narrow-terminal degradation; the user-facing density still advertises three values: `dense | compact | oneline`.

```
╭───────────────────────────────────────────────────────────╮
│ ⬢ idle              │  ▰▰▰▰▱▱▱▱  12k/200k · 6% · in:8k out:4k │
│ opus-4.7 · openai   │  $0.04                                  │
│ ~/proj  main●       │  ⚙ 4 plugins · 0 agents · 1 background  │
╰───────────────────────────────────────────────────────────╯
```

- Two `<Box flexDirection="column">` siblings inside the row container, `flexBasis={1}` each (`flexGrow={1}` so they share space evenly).
- **Left column** (3 rows): `mode`, `model`, `cwd`.
- **Right column** (3 rows): `context`, `cost`, `counts`.
- Vertical separator `│` between columns rendered as a 1-col `<Box>` with `borderStyle="single"` left edge — or simpler, a one-char column of `│` characters per row using `fgMuted`.
- Drop the `cost-time` segment; cost moves to its own row, time tracking is removed entirely (no `⏱`).

#### 4.2.2 Expanded context row

New format: `<bar>  <used>k/<max>k · <pct>% · in:<n>k out:<n>k`. Same single-line; the bar still renders `▰▰▰▰▱▱▱▱` (8-char). Used+max already in props; in/out tokens come from `session.totalUsage.{inputTokens, outputTokens}` — must be plumbed through to `StatusPanel` (new `StatusPanelProps` fields `inputTokens: number`, `outputTokens: number`). Color rule unchanged: 80% → warn, 95% → error.

#### 4.2.3 Icon ↔ text mode toggle

New `config.statusBar.iconMode: 'icon' | 'text'`, default `'icon'`. Toggled live by new `/status-hub` slash command (cycles between modes; no args = toggle, `/status-hub icon` / `/status-hub text` = explicit).

| Segment    | icon mode                                             | text mode                                            |
|------------|-------------------------------------------------------|------------------------------------------------------|
| mode       | `⬢ idle` / `⬢ running` / `⬢ awaiting`                  | `[idle]` / `[running]` / `[awaiting]`                |
| model      | `<model> · <provider>`                                 | `model: <model> · provider: <provider>`              |
| cwd        | `<cwd> <branch>●`                                     | `dir: <cwd> · branch: <branch> (dirty)`              |
| context    | `▰▰▰▰▱▱▱▱  12k/200k · 6% · in:8k out:4k`               | `context: 12k/200k (6%) in: 8k out: 4k`              |
| cost       | `$0.04`                                               | `cost: $0.04`                                        |
| counts     | `⚙ 4 plugins · 0 agents · 1 background`               | `plugins: 4 · agents: 0 · background: 1`             |

The Nerd-font glyphs (`⬢`, `●`, `⚙`, `↩`, `⏱`) remain unicode characters that any modern terminal renders; "icon mode" doesn't require Nerd-font specifically — the toggle exists for users who simply prefer plaintext labels (terminals on Windows ConHost, screen readers, etc.). The bar `▰▰▱▱` is unicode block-fill and renders in both modes; only the leading badge characters and unit prefixes change.

Schema:

```ts
StatusBarConfigSchema = z.object({
  hidden: z.array(z.string()).default([]),
  layout: z.enum(['dense', 'compact', 'oneline']).default('dense'),
  iconMode: z.enum(['icon', 'text']).default('icon'),  // NEW
}).optional()
```

`/status-hub` slash command source: builtin. Args: optional `icon` | `text`. Persists via `saveConfigPatch`.

#### 4.2.4 Segment-id changes

`cost-time` segment is split — `cost` becomes its own id; `time` is removed (not just hidden — deleted from segment registry). Migration in `src/core/config/load.ts`: any existing `hidden` entry equal to `cost-time` is mapped to `cost`. `time` was never a real id, so no mapping needed.

### 4.3 StatsView flake fix (M1)

Root cause investigation lives in M1; the fix is whatever the root cause requires. Hypothesis: the test asserts the `no data yet` placeholder text but `StatsView` renders `Loading…` until an internal Promise (cost-tracker `byProvider()` query) resolves; if the harness frame is sampled before resolution, `Loading…` lingers. Hypothesised fix:

- Make `StatsView` render `(no data yet)` synchronously when `costTracker?.byProvider()` returns `[]` rather than going through a `Loading…` intermediate.
- OR: have the harness test use `waitFor({ contains: 'no data yet' })` instead of `pop()`-ing the latest frame immediately.

Pick whichever the investigation finds cleaner; document in commit message.

### 4.4 Tasks focus mode (M4)

New UIState: `{ kind: 'tasks-focused'; cursor: number }`. Reachable from `normal` via `Tab` (when Tasks panel is non-empty). Inside `tasks-focused`:

- `j` / `↓`: cursor++.
- `k` / `↑`: cursor--.
- `Enter`: open `{ kind: 'submenu'; submenu: { kind: 'tasks'; focusItem: cursor } }` (new full submenu).
- `Esc` / `Tab`: return to `normal`.

`SubmenuDescriptor` adds `{ kind: 'tasks'; focusItem: number }`. New full submenu component `src/tui/Submenu/TasksSubmenu.tsx` shows a richer view — full plan title + description, full subagent log tail, full background task output file path. Read-only (Phase 13 doesn't add task-control verbs).

Tasks panel adds focus-ring rule: when `tasks-focused`, the cursor row gets `primaryDeep` background; the panel border itself uses `primary`. Other UIStates keep current behaviour.

### 4.5 Multi-select / list-editing fields (M5)

Two list-editing forms join the Config submenu:

#### 4.5.1 ProvidersForm (replaces ProviderForm)

Top: list of provider entries (`<id> · <baseUrl>`), with cursor. Bottom: action footer `a 添加 · e 编辑 · d 删除 · ⏎ 设为 active · Esc 关闭`. Editing a provider opens an inline subform with the existing fields (id, baseUrl, apiKey, format, models[]). Delete prompts a one-key confirm.

#### 4.5.2 PluginsForm (multi-select)

Renders all `loadedPlugins` as a checklist. Space toggles enable/disable per plugin (writes to `config.plugins.enabled`). Save persists the array.

Both lists live in the existing left-rail; "Provider" category in the rail becomes "Providers" (plural).

#### 4.5.3 New Field type

`Field.tsx` gains a `list` field type variant whose value is an array of strings; renders as a vertical checklist with cursor. Existing `text/password/select/toggle` types unchanged.

## 5. Schema & migration

### 5.1 Config additions (additive)

```ts
StatusBarConfigSchema:
  iconMode: z.enum(['icon','text']).default('icon')   // NEW
```

Migration: load `cost-time → cost` in `hidden` (`Array.from(new Set(...))` dedupe). Already-present `cost` short-circuits.

### 5.2 SlashCommand additions

`/status-hub` registered as a new builtin. No interface changes.

### 5.3 New files / deletions

| New                                     | Purpose                                          |
|------------------------------------------|--------------------------------------------------|
| `src/tui/Welcome/UpdatesPanel.tsx`       | Right-column upper frame                         |
| `src/tui/Welcome/RecentPanel.tsx`        | Right-column lower frame                         |
| `src/core/updates/load.ts`               | Read `~/.nuka/updates.json`                       |
| `src/core/session/recent.ts`             | List recent session summaries                    |
| `src/tui/Submenu/TasksSubmenu.tsx`       | Full submenu for focused task                    |
| `src/tui/Submenu/config/ProvidersForm.tsx` | Replaces ProviderForm                          |
| `src/slash/statusHub.ts`                 | New `/status-hub` slash                           |
| `test/tui/Welcome.harness.test.tsx`      | Welcome layout test                              |
| `test/tui/Status.iconMode.test.tsx`      | Status icon ↔ text mode test                     |
| `test/tui/Tasks.focus.test.tsx`          | Tasks focus mode test                            |

| Modified                                 | Purpose                                          |
|------------------------------------------|--------------------------------------------------|
| `src/tui/Welcome/Welcome.tsx`            | Centered hero + 2:1 layout                        |
| `src/tui/App.tsx`                        | Welcome integration; tasks-focused UIState; Tab handler |
| `src/tui/Status/StatusPanel.tsx`         | Two-column layout; icon mode; expanded context    |
| `src/tui/Tasks/TasksPanel.tsx`           | Focus ring + cursor row                          |
| `src/tui/Submenu/config/Field.tsx`       | New `list` field type                             |
| `src/tui/Submenu/config/ConfigSubmenu.tsx` | Wire Providers/Plugins forms                    |
| `src/core/config/schema.ts`              | iconMode field                                   |
| `src/core/config/load.ts`                | cost-time → cost migration                       |
| `src/cli.tsx`                            | Register `/status-hub`; pass updates+recent to App |

| Deleted                                  | Purpose                                          |
|------------------------------------------|--------------------------------------------------|
| `src/tui/Submenu/config/ProviderForm.tsx`| Replaced by ProvidersForm                        |

## 6. Testing strategy

- **Welcome harness**: assert 2:1 split renders; right column has both Updates and Recent frames; narrow-terminal degradation hides right column.
- **Updates loader unit**: missing file → `[]`; malformed JSON → `[]` + stderr warn; valid file → parsed array.
- **Recent loader unit**: empty session dir → `[]`; multiple sessions → newest first.
- **Status iconMode**: render in icon mode → asserts `⬢ idle` present; render in text mode → asserts `[idle]` present, `⬢` absent. Switching via `/status-hub` updates `config.statusBar.iconMode` and re-renders.
- **Status two-column**: left column has 3 rows, right column has 3 rows, separator visible. Vertical degradation on narrow → falls back to compact.
- **Status context expansion**: with input/output tokens supplied, asserts `in:8k` and `out:4k` present.
- **StatsView flake**: write a deterministic test that explicitly waits for the resolved state; the flake test stays green over 100 consecutive runs (`vitest run --reporter=basic --repeat 5` as a smoke check).
- **Tasks focus**: Tab transitions UIState to `tasks-focused`; `j`/`k` move cursor; Enter opens `tasks` submenu; Esc returns to normal.
- **ProvidersForm**: add/edit/delete round-trip; save persists.
- **PluginsForm**: space toggles enabled list; save persists.

## 7. Rollout

Five sequential workstreams; each merge runs `npx vitest run && npm run build` post-merge.

## 8. Open questions / out of scope

- Updates JSON template / scaffolding into onboarding wizard — Phase 14.
- Search / filter in Tasks submenu — Phase 14.
- Provider-list re-ordering UX — Phase 14.
- Mouse support, animations — not planned.
