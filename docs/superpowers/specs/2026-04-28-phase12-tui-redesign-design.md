# Phase 12 — TUI Redesign

**Date:** 2026-04-28
**Status:** Spec
**Author:** Brainstorming session 2026-04-28

## 1. Problem

Current TUI is a flat vertical stack — Welcome/Messages → PromptInput → StatusBar → Hud → StatusLine — with no visual center, no clear sectioning, ad-hoc dialog open/close behaviour, and a config UX that punts to `$EDITOR`. Three concrete pains:

1. **Three overlapping status surfaces** (`StatusBar`, `Hud`, `StatusLine`) compete for the bottom rows; user can't tell at a glance which is authoritative.
2. **Submenu navigation is inconsistent** — every dialog implements its own `onCancel` and there's no rule for what other chrome should hide while a dialog is open.
3. **No focus signalling** — every framed box uses the same color, so the user can't see where keyboard input goes.

Reference set the user wants Nuka to learn from: OpenCode (sst/opencode), Claude Code, Kilo Code, Haleclipse/codex. Common thread: **command-deck layout with clear sectioning + per-section focus rings + a single-stack submenu model**.

## 2. Goals

1. Adopt a four-zone layout: **Conversation → Tasks → Prompt → Status**.
2. Unify all overlay UI under one **Submenu** abstraction with a single-stack navigation model and per-submenu hide rules for the four zones.
3. Add a **Tasks** panel that surfaces three task kinds: current Plan checklist (from the `TodoState` store mutated by `TodoWrite`), in-flight Subagents (from `dispatch_agent` calls in `session.messages`), and Backgrounds (from `taskManager.list()` — both `local_bash` and `local_agent` kinds).
4. Rebuild Status as a **single six-line dense panel** with configurable layout and hideable rows; retire Hud + StatusLine as separate surfaces. Welcome stays *outside* the Conversation frame (rendered raw at first launch when `messages.length === 0`) so the centered avocado logo still has its full canvas.
5. Rebuild `/config` as a **left-nav + right-form** submenu (the canonical "rich submenu") so config UX stops requiring `$EDITOR`.
6. Rebuild `/` slash dropdown as a **grouped command list with arg-hint card** that takes over the Status slot (not floats above Prompt).
7. Introduce a **12-key semantic color palette** rooted in avocado green; every panel uses semantic roles instead of hard-coded ANSI colors. Focus ring uses `primary` on the active frame, `fg-muted` elsewhere.

## 3. Non-Goals

- No agent-loop, tool-system, or session-store changes — Phase 12 is render-layer only.
- No new slash commands, no new task kinds — Tasks panel only consumes existing `todoWrite`/`dispatch_agent`/`taskManager` data.
- No new theme files — the five seed themes get remapped to the new palette in-place.
- No mouse support, no width-responsive *layout* changes (just degradation rules at <80 cols).
- No animations beyond the existing spinner.

## 4. Architecture

### 4.1 Layout zones

Four stacked frames, top to bottom:

```
╭─ Conversation ──────────────────────────────────────────────╮
│ Welcome / Messages / streaming / tool folds                 │
╰─────────────────────────────────────────────────────────────╯
╭─ Tasks  (Ctrl+T 折叠) ──────────────────────────────────────╮
│ Plan checklist                                              │
│ ── Subagents ─────────────────────────────────────────────  │
│ ── Backgrounds ─────────────────────────────────────────────   │
╰─────────────────────────────────────────────────────────────╯
╭─ Prompt ────────────────────────────────────────────────────╮
│ > _                                                          │
│   Tab 补全 · ⏎ 发送 · Esc 取消 · / 命令 · @ 提及 · Ctrl+T 任务 │
╰─────────────────────────────────────────────────────────────╯
╭─ Status ────────────────────────────────────────────────────╮
│ ⬢ idle                                                       │
│ opus-4.7 · openai                                            │
│ ~/proj  main●                                                │
│ ▰▰▰▰▱▱▱▱  12k/200k                                          │
│ $0.04  ⏱ 2m14s                                               │
│ ⚙ 4 plugins · 0 agents · 1 background                       │
╰─────────────────────────────────────────────────────────────╯
```

- Conversation grows to fill available height; Tasks/Prompt/Status are fixed-height.
- Tasks panel collapses on `Ctrl+T` to a single summary line:
  ```
  ╭─ Tasks ▸  Plan 3/5 · 1 subagent · 1 background   (Ctrl+T 展开) ╮
  ╰────────────────────────────────────────────────────────────╯
  ```
- When Plan/Subagents/Backgrounds are all empty, the entire Tasks frame is hidden (zero height).

### 4.2 UI state machine

A single `UIState` discriminated union replaces the current scattered `dialog` + `slashOpen` flags:

```ts
type UIState =
  | { kind: 'normal' }
  | { kind: 'tasks-collapsed' }                          // user pressed Ctrl+T
  | { kind: 'slash'; mode: 'list' | 'arg-hint' }          // dropdown open
  | { kind: 'submenu'; submenu: SubmenuDescriptor }       // overlay
```

`SubmenuDescriptor` is a tagged union covering all current dialogs:

```ts
type SubmenuDescriptor =
  // full submenus — take over Tasks/Prompt/Status slots
  | { kind: 'config' }
  | { kind: 'model-picker' }
  | { kind: 'session-picker'; metas: SessionMeta[] | 'loading' }
  | { kind: 'wizard' }
  | { kind: 'stats' }
  | { kind: 'doctor'; report: DoctorReport }
  | { kind: 'message-selector'; messages: AssistantMessage[] }
  // inline submenus — take over only Prompt slot
  | { kind: 'permission'; call: PermissionCall; suggestedPattern?: string; ... }
  | { kind: 'plugin-config'; plugin: LoadedPlugin; fields: PluginUserConfigField[]; ... }
```

`Esc` always returns to `{ kind: 'normal' }` from any non-normal state. Single-layer stack: opening a new submenu closes any currently-open one. (Existing `model-picker → wizard` flow expressed via the picker's `onAddProvider` callback chain, no stack needed.)

### 4.3 Hide rules per UIState

| UIState                              | Conversation | Tasks       | Prompt      | Status      | Slash card | Submenu     |
|--------------------------------------|--------------|-------------|-------------|-------------|------------|-------------|
| `normal`                             | shown        | shown       | shown       | shown       | —          | —           |
| `tasks-collapsed`                    | shown        | summary row | shown       | shown       | —          | —           |
| `slash`                              | shown        | **hidden**  | shown (raised) | **replaced** | shown   | —           |
| `submenu` (full)                     | shown        | **hidden**  | **hidden**  | **hidden**  | —          | shown       |
| `submenu` (inline)                   | shown        | shown       | **hidden**  | shown       | —          | shown above prompt slot |

"Replaced" = same screen slot, different content. "Raised" = same content, moved up to where Tasks used to be (because Tasks is hidden in the slash state).

### 4.4 Tasks panel data model

Three data sources, each with its existing infrastructure:

- **Plan** — sourced from the `TodoState` shared store (`src/core/tools/todoWrite.ts` exports `createTodoStore()`; the store is mutated in place by the `TodoWrite` tool). The store shape is `{ items: { title: string; status: 'pending' | 'in_progress' | 'completed' }[] }`. **Note**: this store is currently created in `cli.tsx` and passed only to the tool factory; M3 must thread it through to `App.tsx` as a new prop (`todoStore: TodoState`). Items are rendered in order with index-based numbering.

- **Subagents** — derived from in-flight `dispatch_agent` calls in `session.messages` (scan logic mirrors `findLatestDispatchAgentCallId` in `App.tsx`, but returns *all* dispatch calls whose tool_result hasn't yet appeared). Each: `{ callId, label, startedAt }`. Status is `running` (no result yet) / `done` (result without isError) / `failed` (result with isError).

- **Backgrounds** — sourced from `props.taskManager.list()` (Phase 10 task system). Both task kinds (`local_bash` and `local_agent`) render here — there is no `monitor` kind in the codebase. Each: `{ id, description, state }` where state ∈ `pending|running|completed|failed|killed`.

Render order is fixed: Plan → Subagents → Backgrounds. Each section has a thin separator line `── <heading> (<n>) ──`. Empty sections are omitted entirely. Total panel height capped at 12 rows; overflow per section truncates with `… +N more`. Press `Enter` while panel is focused → expand to full submenu (deferred to Phase 13; Phase 12 ships read-only Tasks).

Status icons:
- Plan: `✓` completed · `▶` in_progress · `☐` pending  *(TodoState has no failed status; `✗` not used here)*
- Subagent: `▶` running · `✓` done · `✗` failed
- Background: `▶` running · `✓` completed · `✗` failed · `◉` killed · `☐` pending

### 4.5 Status panel — six-line dense layout

Six fixed segments with stable ids:

| id          | content                                                |
|-------------|--------------------------------------------------------|
| `mode`      | mode badge (`⬢ idle` / `⬢ running` / `⬢ awaiting` / `⬢ primed-quit`) |
| `model`     | `<model> · <provider>`                                 |
| `cwd`       | `<short-cwd>  <branch>●` (dot when dirty)              |
| `context`   | `▰▰▰▱▱▱▱▱  <used>k/<max>k`                             |
| `cost-time` | `$<cost>  ⏱ <elapsed>`                                 |
| `counts`    | `⚙ <n> plugins · <n> agents · <n> background`          |

`config.statusBar.hidden: string[]` filters by id. New: `config.statusBar.layout: 'dense' | 'compact' | 'oneline'` controls density:
- `dense` (default): all six rows shown, one per line.
- `compact`: rows folded to two: `mode/model/cwd/context` on row 1, `cost-time/counts` on row 2 with `·` separators.
- `oneline`: single line `mode · model · cwd · context · cost · counts`, ellipsised if it overflows terminal width.

Narrow-terminal degradation (<80 cols): `dense` automatically renders as `compact`, `compact` as `oneline`, `oneline` unchanged. This is automatic, not a config knob — keeps the user from having to know they're on a narrow terminal.

`Hud` and `StatusLine` are **deleted**. Token-split, run-elapsed, plugin/agent/background counts that lived in the Hud are folded into Status (`counts` segment) or `/stats` submenu.

### 4.6 Submenu system

Two physical layouts:

**Full submenu** — takes over Tasks/Prompt/Status slots. Title bar (`╭─ <name> ─────╮`) + body + footer with key hints (`⏎ 编辑   s 保存   o 外部编辑器   Esc 关闭`). Conversation stays at top (read-only context).

**Inline submenu** — replaces the Prompt slot (the dialog itself takes input via its own keybindings). Tasks and Status remain visible. Used for permission and plugin-config — both decisions where the user benefits from seeing live status (token budget, queue, etc.).

Mapping:

| Submenu            | Layout  | Rationale                                              |
|--------------------|---------|--------------------------------------------------------|
| `config`           | full    | rich form, needs space                                 |
| `model-picker`     | full    | scrollable list, comparison view                       |
| `session-picker`   | full    | scrollable list                                        |
| `wizard`           | full    | multi-step, owns the screen                            |
| `stats`            | full    | dense data, charts                                     |
| `doctor`           | full    | report list                                            |
| `message-selector` | full    | scrollable history                                     |
| `permission`       | inline  | quick decision; status context useful                  |
| `plugin-config`    | inline  | quick form; status context useful                      |

`Esc` → `{ kind: 'normal' }` for all submenus. No multi-level back-stack.

### 4.7 Config submenu — left nav + right form

```
╭─ Config ───────────────────────────────────────────────────╮
│ ▸ Provider      │  Provider:    openai             [▾]      │
│   Model         │  Base URL:    https://api.openai.com/v1   │
│   Theme         │  API Key:     ••••••••••••••••            │
│   StatusBar     │  Verify:      ✓ ok (2026-04-28)           │
│   Vim           │                                             │
│   Plugins       │                                             │
│   Skills        │                                             │
│   Welcome       │                                             │
│   Compact       │                                             │
│ ─────────────── │                                             │
│ j/k 切分类       │  ⏎ 编辑字段   s 保存   o 外部编辑器   Esc 关闭│
╰─────────────────────────────────────────────────────────────╯
```

- Left rail width: 18 cols, fixed. Right side fills remainder.
- Categories derive from top-level `Config` schema keys, in this fixed order: `Provider, Model, Theme, StatusBar, Vim, Plugins, Skills, Welcome, Compact`.
- Each category renders one `<CategoryForm>` component (e.g. `ProviderForm`, `StatusBarForm`). All forms share a tiny `Field` primitive: label + value + edit/view modes.
- Field types in scope for Phase 12: text, password (masked), select (single), toggle (bool). Multi-select / list editing → out of scope (out-of-scope for Phase 12; provider list editing reuses ModelPicker flow).
- `s` saves to `~/.nuka/config.yaml` via existing `save.ts`. Validation failure pops a transient error banner (`error`-colored 1.5s flash on the field's frame).
- `o` opens the file in `$EDITOR` (legacy escape hatch; closes the submenu first).
- **StatusBar form** is the canonical example: it edits `statusBar.layout` (radio: dense/compact/oneline) and `statusBar.hidden` (checklist of segment ids `mode/model/cwd/context/cost-time/counts`).

### 4.8 Slash dropdown — grouped + arg-hint card

Triggered by `value.startsWith('/')`. Opens UIState `slash`. Replaces Status slot (Tasks hidden, Prompt raised). Two modes:

**`list`** — typing `/` or `/<prefix>` (no space yet):

```
╭─ /  Commands ──────────────────────────────────────────────╮
│ builtins (8)                                                │
│   ▸ /help        显示帮助                          ?        │
│     /config      打开配置                                    │
│     /model       切换模型                                    │
│     ...                                                     │
│ ── plugins (2) ───────────────────────────────────────────  │
│     /deploy      插件: deploy-helper                         │
│ ── skills (3) ────────────────────────────────────────────  │
│     /brainstorm  Skill: brainstorming                       │
│                              ↑/↓ 选择  Tab 接受  ⏎ 执行  Esc │
╰─────────────────────────────────────────────────────────────╯
```

Grouping by `source: 'builtin' | 'plugin' | 'skill'`. Source already exists on `SlashCommand` registrations through registry tags; if not present, default to `builtin`. Selected row highlighted with `primary-deep` background. Bound shortcut shown on the right (e.g. `Ctrl+T` for `/tasks`, `?` for `/help`).

**`arg-hint`** — once user types a space after the command name, dropdown morphs into the arg-hint card:

```
╭─ /model  切换模型 ──────────────────────────────────────────╮
│ Usage:    /model [provider] [model]                         │
│                                                              │
│ Args:                                                        │
│   provider   openai · anthropic · azure · custom            │
│   model      (按 provider 自动补全)                           │
│                                                              │
│ Examples:                                                    │
│   /model openai opus-4.7                                    │
│   /model              (打开 picker)                         │
│                                                              │
│                                       ⏎ 执行  Esc 取消       │
╰─────────────────────────────────────────────────────────────╯
```

Driven by extended `SlashCommand`:

```ts
export interface SlashCommand {
  name: string
  description: string
  source?: 'builtin' | 'plugin' | 'skill'   // NEW (default 'builtin')
  shortcut?: string                          // NEW (display-only, e.g. 'Ctrl+T')
  usage?: string
  args?: { name: string; choices?: string[]; description?: string }[]   // NEW
  examples?: string[]                         // NEW
  run(args: string, ctx: SlashContext): Promise<SlashResult>
}
```

Commands without `args`/`examples` show a degenerate card: just `Usage: /<name>` line + footer.

### 4.9 Color palette

Twelve semantic keys; new `ThemeColors` shape (existing free-form keys deprecated; migration path in §5.4):

| key            | role                                                   | default-dark   |
|----------------|--------------------------------------------------------|----------------|
| `primary`      | focused frame, logo, selected highlight                | `#8FBF3F`      |
| `primaryDeep`  | pressed/active, progress filled                        | `#6B9A2E`      |
| `primarySoft`  | soft primary, secondary frame highlight                | `#B6D77A`      |
| `accentWarm`   | running tasks, vim mode badge                          | `#E0A23C`      |
| `accentCool`   | subagents, plan numbering, tool-call headers           | `#5FA8A8`      |
| `accentInfo`   | hints, group dividers, footer keys                     | `#7C9CC4`      |
| `success`      | done/ok                                                | `#5FB370`      |
| `warn`         | primed-quit, dirty git, killed task                    | `#D98E3C`      |
| `error`        | failed, denied, validation error                       | `#D5604E`      |
| `fg`           | primary text                                           | `#E6E4D9`      |
| `fgMuted`      | descriptions, placeholders, unfocused frame border     | `#7A7A6A`      |
| `fgFaint`      | timestamps, tokens, distant scrollback                 | `#5A5A4E`      |
| `bg`           | terminal background (transparent)                      | —              |
| `bgPanel`      | submenu/slash card subtle background (when supported)  | `#1B1F12`      |

Light theme (`default-light`) remaps **only** `fg / fgMuted / fgFaint / bg / bgPanel`; semantic colors (primary, accents, success/warn/error) stay constant so brand identity holds. Solarized-{dark,light} and high-contrast follow the same five-key remap pattern.

Focus ring rule: any panel renders its border with `primary` if the keyboard focus is within it, else `fgMuted`. In `slash` UIState the slash card uses `primary` and Prompt drops to `primarySoft` (input still goes there but visual center is the dropdown). In `submenu` UIState the submenu uses `primary` and Conversation uses `fgMuted`.

### 4.10 Component breakdown

```
src/tui/
  App.tsx                       (refactored: drives UIState)
  Conversation/
    Conversation.tsx            (was Messages container; renames Welcome+Messages cohabitation)
  Tasks/
    TasksPanel.tsx              (NEW)
    PlanList.tsx                (NEW)
    SubagentList.tsx            (NEW)
    BackgroundList.tsx             (NEW)
  PromptInput/                  (existing, slash-active integration changes)
  SlashCard/
    SlashCard.tsx               (NEW; replaces SlashSuggest's old position)
    CommandList.tsx             (NEW; grouped + selected highlight)
    ArgHint.tsx                 (NEW; arg-hint card)
  Status/
    StatusPanel.tsx             (NEW; replaces StatusBar+Hud+StatusLine)
  Submenu/
    SubmenuFrame.tsx            (NEW; common chrome for all submenus)
    config/
      ConfigSubmenu.tsx         (NEW; left-nav driver)
      Field.tsx                 (NEW; primitive)
      ProviderForm.tsx          (NEW)
      ModelForm.tsx             (NEW)
      ThemeForm.tsx             (NEW)
      StatusBarForm.tsx         (NEW)
      VimForm.tsx               (NEW)
      PluginsForm.tsx           (NEW)
      SkillsForm.tsx            (NEW)
      WelcomeForm.tsx           (NEW)
      CompactForm.tsx           (NEW)
  dialogs/                      (existing, wrapped in SubmenuFrame)
    ModelPicker.tsx
    SessionPicker.tsx
    PermissionDialog.tsx        (renders in inline slot)
    PluginConfigDialog.tsx      (renders in inline slot)
  Stats/StatsView.tsx           (existing; wrapped)
  Doctor/DoctorReport.tsx       (existing; wrapped)
  Onboarding/Wizard.tsx         (existing; wrapped)
  Rewind/MessageSelector.tsx    (existing; wrapped)
  Welcome/Welcome.tsx           (existing; rendered inside Conversation)
  theme.ts                      (palette refactor — see §5.4)
```

Files **deleted**:
- `src/tui/Status/Hud.tsx`
- `src/tui/StatusBar/StatusBar.tsx`
- `src/tui/StatusBar/Segments.tsx`
- `src/tui/StatusBar/HintLine.tsx`
- `src/tui/StatusLine/StatusLine.tsx`
- `src/tui/PromptInput/SlashSuggest.tsx` (replaced by SlashCard)

`config.statusLine` schema field is **kept** for now (legacy custom-format users). Its renderer moves into `StatusPanel` as a 7th optional row (`status-line` segment id, hideable via `statusBar.hidden`). The standalone `StatusLine.tsx` file is deleted; the format-string + spawn-command interpolation logic moves into a small helper `src/tui/Status/statusLine.ts`.

## 5. Schema & migration

### 5.1 Config additions (additive, non-breaking)

```ts
StatusBarConfigSchema = z.object({
  hidden: z.array(z.string()).default([]),
  layout: z.enum(['dense', 'compact', 'oneline']).default('dense'),  // NEW
}).optional()
```

Segment ids change from the old set (`model/cwd/git/ctx/cost/auto/queue/tasks/plugins/hint`) to the new set (`mode/model/cwd/context/cost-time/counts`). Migration: at config load, map old ids to new (`git → cwd`, `ctx → context`, `cost → cost-time`, `auto/queue/tasks/plugins/hint → counts` or dropped). Apply `Array.from(new Set(...))` post-mapping to dedupe collisions (e.g. both `git` and `cwd` already in `hidden`). This happens in `src/core/config/load.ts` once at boot and writes the migrated form back on next save.

### 5.2 SlashCommand additions (additive, non-breaking)

Existing commands compile unchanged. New optional fields populated only where useful (`/model`, `/skill`, `/config`, `/tasks`, `/sessions`, `/help`, `/stats`, `/doctor` get full arg-hint cards; the rest get a degenerate Usage line).

### 5.3 PluginManifest — no changes

Plugin tools still register via `defineTool({...})`; plugin slash via `slashCommands` array (existing). Phase 12 doesn't change plugin contracts.

### 5.4 Theme migration

`ThemeColors` is rewritten with the 12 semantic keys (§4.9). Existing free-form keys (`accent, plan, permission, userMsg, assistantMsg, diffAdd, diffDel, agent.{primary,alt}`) are **dropped**. Five seed themes (`default-dark`, `default-light`, `solarized-dark`, `solarized-light`, `high-contrast`) get rewritten in-place. Component callers migrate to new names. Old `theme.colors.accent` references → choose one of `accentCool` / `accentInfo` based on context.

`ThemeProvider` API (`useTheme()`) stays. `defaultPalette` export (`src/tui/theme.ts`) becomes a thin alias for the active theme's palette.

## 6. Testing strategy

### 6.1 Unit (vitest)

- `Tasks/PlanList`: renders `todoWrite` items with correct icons; truncation hint when >N.
- `Tasks/SubagentList`: renders running/done/failed icons; correct elapsed-time formatting.
- `Tasks/BackgroundList`: renders running/completed/failed/killed/pending from `taskManager`.
- `TasksPanel`: empty sections hidden; entire frame hidden when all empty.
- `Status/StatusPanel`: renders six rows in dense; folds to two in compact; folds to one in oneline; respects `hidden` filter; auto-degrades on narrow terminal.
- `SlashCard/CommandList`: groups by source; shows selected highlight; pagination ellipsis.
- `SlashCard/ArgHint`: renders Usage/Args/Examples for a fully-populated command; degenerate card for sparse one.
- `Submenu/config/ProviderForm`: edit/save/cancel field round-trip; validation error flashes border.
- `Submenu/SubmenuFrame`: Esc handler closes; full vs inline layout.
- `theme`: each seed theme exposes all 12 keys; light/dark remap only `fg/fgMuted/fgFaint/bg/bgPanel`.

### 6.2 Harness (existing `mountApp`)

- New `test/tui/Layout.harness.test.tsx`: renders App in `normal` UIState — asserts Conversation/Tasks/Prompt/Status all visible; asserts focus ring is on Prompt.
- `test/tui/SlashCard.harness.test.tsx`: types `/`, asserts Tasks hidden, slash card replaces Status slot, Prompt is right above slash card. Then types `/model `, asserts arg-hint card renders.
- `test/tui/Submenu.harness.test.tsx`: opens `/config`, asserts Tasks/Prompt/Status hidden, Conversation visible, focus ring on Config submenu. Esc → back to normal.
- `test/tui/Status.harness.test.tsx`: asserts dense/compact/oneline rendering; hidden segments dropped.
- `test/tui/Tasks.harness.test.tsx`: stubs `todoStore` with three items + injects an in-flight `dispatch_agent` tool_use into `session.messages` + stubs `taskManager.list()` returning two background tasks; asserts three sections in order; asserts collapse on Ctrl+T.

### 6.3 Regression

Existing `test/tui/PromptInput/SlashSuggest.harness.test.tsx` is **rewritten** against `SlashCard` (same assertions: dropdown shows on `/`, lists registered commands, paginates) — old assertions about hiding `StatusBar` need updating to "Status replaced by slash card". The four existing harness assertions (`/help`, `/exit`, `/theme`, paginate) all carry over.

All other existing tests must remain green; legacy components targeted for deletion (`Hud`, `StatusBar`, `StatusLine`) have their tests deleted alongside.

## 7. Rollout

Single phase, one PR per workstream merged sequentially on `main`. Each merge runs `pnpm vitest run && pnpm build` before launching the next.

## 8. Open questions / out of scope

- **Tasks panel focus mode** (press `Tab` from Prompt to focus Tasks, navigate with `j/k`, expand items): deferred to Phase 13. Phase 12 ships read-only Tasks.
- **Multi-select / list-editing fields** in config submenu (e.g. provider list): deferred. Provider editing reuses ModelPicker flow.
- **Mouse support** in slash card / config submenu: out of scope.
- **Theme plugin contribution** (third-party themes): out of scope (§3 already lists this).
- **Animated transitions** between UIStates: out of scope.

## 9. Appendix — UIState transition diagram

```
                       Esc / submenu close
              ┌─────────────────────────────────────────┐
              ▼                                         │
          ┌───────┐  Ctrl+T   ┌──────────────────┐      │
          │normal │ ────────► │tasks-collapsed  │       │
          │       │ ◄──────── │                  │       │
          └───┬───┘  Ctrl+T   └──────────────────┘       │
              │                                          │
              │ '/'                                      │
              ▼                                          │
          ┌────────────┐  ' ' typed   ┌──────────────┐   │
          │slash:list  │ ───────────► │slash:arg-hint│   │
          │            │ ◄─────────── │              │   │
          └─────┬──────┘  backspace   └──────┬───────┘   │
                │ Esc / Enter (cmd run)             │     │
                └──────────────────────────┬────────┘    │
                                           │             │
                                           ▼             │
                          ┌──────────────────┐           │
                          │ submenu (full or │ ──────────┘
                          │ inline)          │
                          └──────────────────┘
```

`Enter` in `slash:list` runs the highlighted command; if that command resolves to a `dialog` SlashResult, UIState transitions to the corresponding `submenu`. Otherwise back to `normal`.
