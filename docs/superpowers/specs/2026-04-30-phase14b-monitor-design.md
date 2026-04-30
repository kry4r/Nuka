# Phase 14b — Monitor: Tasks panel multi-column + interactive zoom + `/monitor` dashboard

**Date:** 2026-04-30
**Status:** Spec
**Depends on:** `2026-04-30-phase14-foundation-design.md` (EventBus, ProgressTracker, MessageRouter), `2026-04-30-phase14a-swarm-design.md` (in-process teammates produce the events Monitor renders)
**Author:** Brainstorming session 2026-04-30

## 1. Problem

After phase14a lands, Nuka can spawn named teammates, run pipelines, and exchange messages — but the user has zero visibility into what's happening. The current `Tasks` panel (Plan / Subagents / Backgrounds three sections, Ctrl+T to toggle) is **read-only**:

- No Tab focus, no `j/k` navigation, no Enter to drill into a single agent
- No way to **inject a message** into a running teammate (you'd have to wait for it to finish, lose context)
- No **DAG view** — pipelines are invisible; the user only sees the parent task running
- No **token/cost surface** beyond a flat row in the Status bar
- No **message digest** — `send_message` traffic is dropped on the floor from a UI perspective
- No **timeline view** for "what happened in the last 5 minutes" — useful when the user steps away

Phase14b uses the foundation's EventBus + ProgressTracker as the data layer and builds the missing surface in two places, agreed by user: (i) extend the existing `Tasks` panel (Ctrl+T) with new columns and interactive focus; (ii) ship a new `/monitor` full-screen dashboard for the deeper view (DAG, timeline, token panels).

## 2. Goals

1. **Tasks panel — multi-column layout**: extend `src/tui/Tasks/TasksPanel.tsx` from 3 lists (Plan/Subagents/Backgrounds) to **5 lists** by adding `Pipeline` and `Messages` columns. Each column is a focusable list with rows scrolled independently.
2. **Tasks panel — interactive zoom**: Tab cycles focus across columns; `j/k` (also `↑/↓`) moves selection within a column; Enter on a row opens a **detail submenu** for that subtype.
3. **Per-subtype detail submenus**:
   - `subagent` row → `SubagentDetail` (live conversation feed; inject-message input; pause/kill buttons; plan-mode approval prompt when applicable)
   - `pipeline` row → `PipelineDetail` (DAG ASCII rendering with stage statuses; node click drills into that node's subagent detail)
   - `message` row → `MessageDetail` (envelope inspector with body, sender, timestamp; reply button → opens injection of a reply message)
   - `background` row → existing background detail (no change beyond hooking into bus)
4. **`/monitor` slash command — full-screen dashboard**: new submenu kind `monitor`, takes over the conversation+tasks zones. Three tabs (cycled with Tab):
   - **Tab 1 — DAG**: live pipeline graph (nodes are agents, edges are `handoff` messages); collapsed when no pipeline active
   - **Tab 2 — Timeline**: minute-bucketed event histogram of `task.*`, `agent.*`, `message.*` topics; scrollable horizontally
   - **Tab 3 — Tokens**: per-agent token + cost rollup with sparkline (rendered ASCII)
5. **Live data binding**: all panels subscribe to EventBus (no direct TaskManager polling). Replay last N events on mount so the panel is non-empty even right after `/monitor` opens.
6. **Empty/degraded states**: each column shows `(no <thing>)` in `fgFaint` when empty (no swallowing the column, layout stays balanced).
7. **Narrow terminal degradation**: when `cols < 100`, the Tasks panel collapses to single-column scrollable list (existing column rules retained); `/monitor` always uses full width and ignores cols < 80 by showing a "terminal too narrow" message.

## 3. Non-Goals

- ❌ No mouse support (Nuka has never had it)
- ❌ No animated transitions; redraws are tick-based (1s)
- ❌ No persistence of monitor view state across sessions (reopen = fresh)
- ❌ No streaming of teammate's exact output to the Tasks-panel column row (zoom view shows that; the column row is just summary + tracker numbers)
- ❌ No multi-select across columns (each column has its own selection)
- ❌ No editing of pipeline DAG from the UI (read-only; create via `pipeline_run` tool)

## 4. High-level architecture

```
                 ┌──────────────── App.tsx ────────────────┐
                 │                                          │
                 │  Conversation │ Tasks (Ctrl+T) │ Prompt │ Status
                 │                                          │
                 │   Tasks panel:                           │
                 │   ┌──────┬──────────┬──────────┬────────┬─────────┐
                 │   │ Plan │ Subagents│ Pipeline │Backgnds│ Messages│
                 │   ├──────┼──────────┼──────────┼────────┼─────────┤
                 │   │ ...  │  alice  │ build    │ shell-1│ alice→bob│
                 │   │      │ ●bob ←  │ ⤷ test  │ ...    │ lead→*   │
                 │   │      │  carol  │ ⤷ docs  │        │ ...      │
                 │   └──────┴──────────┴──────────┴────────┴─────────┘
                 │       ↑ Tab cycles columns; jk picks row; Enter zoom
                 │
                 │  /monitor (submenu):
                 │   ┌────── DAG ──────┬── Timeline ──┬── Tokens ──┐
                 │   │ research        │ 14:00 ▆▆     │ alice 12k │
                 │   │   ↘             │ 14:01 ▆▆▆▆   │ bob   3k  │
                 │   │     plan        │ 14:02 ▆      │ carol 7k  │
                 │   │       ↘         │ ...          │ ...       │
                 │   │         impl    │              │           │
                 │   │            ↘    │              │           │
                 │   │              rev│              │           │
                 │   └─────────────────┴──────────────┴───────────┘
                 │                                          │
                 └──────────────────────────────────────────┘

      Data flow:  EventBus subscribe → React useReducer → render
      No direct TaskManager polling from UI.
```

**Architectural choices:**

- The Tasks panel and the `/monitor` submenu both consume the EventBus. The Tasks panel keeps a small ring (16 entries per column) for live rendering; `/monitor` keeps a larger ring (1024 entries) plus reads `events/*.ndjson` if the flusher is on.
- All view-models are pure functions: `(events: EventRecord[]) => ColumnState`. No mutation in render path.
- DAG rendering uses **box-drawing chars only** (no Unicode beyond what phase13 already ships); fixed-cell layout, levels stacked vertically, edges are 90° corners.

## 5. Component schemas

### 5.1 Column models

```ts
type ColumnKind = 'plan' | 'subagent' | 'pipeline' | 'background' | 'message'

type RowBase = {
  id: string                  // task id or envelope id
  primary: string             // line 1 (bold)
  secondary: string           // line 2 (fgMuted)
  status: 'running' | 'idle' | 'completed' | 'failed' | 'killed' | 'sent' | 'delivered' | 'failed-msg'
  tokens?: { in: number; out: number }
  startedAt?: number
}

type ColumnState = {
  kind: ColumnKind
  rows: RowBase[]            // newest first
  scrollOffset: number       // top-most visible row index
  selectedIndex: number | null  // null when column is unfocused
}
```

### 5.2 Tasks panel focus model

```ts
type FocusTarget =
  | { kind: 'prompt' }
  | { kind: 'tasks-column'; column: ColumnKind }
  | { kind: 'tasks-row'; column: ColumnKind; rowId: string }     // detail open

type TasksFocusReducer = (state: TasksFocusState, evt: TasksFocusEvent) => TasksFocusState

type TasksFocusEvent =
  | { type: 'tab' }                  // cycle column
  | { type: 'shift-tab' }
  | { type: 'down' }
  | { type: 'up' }
  | { type: 'enter' }
  | { type: 'esc' }
```

Focus rotation cycle: `prompt → plan → subagent → pipeline → background → message → prompt` (Tab); shift-Tab reverses.

### 5.3 `/monitor` view-model

```ts
type MonitorTab = 'dag' | 'timeline' | 'tokens'

type DagNodeView = {
  nodeId: string
  agentName: string
  status: TaskState
  tokens?: { in: number; out: number }
  level: number              // for stacking
  parents: string[]
}

type TimelineBucket = {
  bucketStart: number        // ms epoch, minute-aligned
  task: number
  agent: number
  message: number
  harness: number
}

type TokenRollup = {
  agentName: string
  inputTokens: number
  outputTokens: number
  cost?: number
  sparkline: number[]        // last 16 sample points
}
```

## 6. Component contracts

### 6.1 Tasks panel — `src/tui/Tasks/TasksPanel.tsx` (rewrite)

Top-level layout:

```tsx
<Box flexDirection="row" borderStyle="round" borderColor={isFocused ? 'primary' : 'fgMuted'}>
  <PlanColumn       state={state.plan}        focused={focusedCol === 'plan'} />
  <SubagentColumn   state={state.subagent}    focused={focusedCol === 'subagent'} />
  <PipelineColumn   state={state.pipeline}    focused={focusedCol === 'pipeline'} />
  <BackgroundColumn state={state.background}  focused={focusedCol === 'background'} />
  <MessageColumn    state={state.message}     focused={focusedCol === 'message'} />
</Box>
```

Each column has min-width 18, flex-grow 1. When `cols < 100`, fall back to single-column with a `[plan|sub|pipe|bg|msg]` header strip and `←/→` to switch column.

### 6.2 Subagent detail — `src/tui/Tasks/SubagentDetail.tsx` (new submenu)

```tsx
<Submenu kind="subagent-detail">
  <Header>{agentName} · {teamName} · {status}</Header>
  <ConversationFeed messages={taskState.conversation.slice(-30)} />
  <ToolActivityRail activities={tracker.recentActivities} />
  {planAwaitingApproval && (
    <PlanApprovalPrompt
      plan={planAwaitingApproval.plan}
      onApprove={() => router.send(approveEnvelope(planAwaitingApproval))}
      onReject={(feedback) => router.send(rejectEnvelope(planAwaitingApproval, feedback))}
    />
  )}
  <InjectMessageInput onSubmit={(text) => taskManager.injectMessage(taskId, text)} />
  <Actions>
    <Button onClick={pause}>Pause</Button>
    <Button onClick={kill}>Kill</Button>
    <Button onClick={() => router.send(shutdownEnvelope(taskId))}>Graceful shutdown</Button>
  </Actions>
</Submenu>
```

### 6.3 Pipeline detail — `src/tui/Tasks/PipelineDetail.tsx`

ASCII DAG rendering using a topo-sort + level-based grid. Each node 18x4. Selection moves between nodes via `j/k/h/l`; Enter on a node opens that node's `SubagentDetail`.

### 6.4 Message detail — `src/tui/Tasks/MessageDetail.tsx`

Plain envelope inspector with copyable body. Reply button injects a new `send_message` into the calling teammate's pending queue (only available if the user is reviewing as the lead — gated by current focus context).

### 6.5 `/monitor` submenu — `src/tui/Monitor/MonitorView.tsx` (new)

Three sub-views, switchable via Tab:

- **DAG view** uses `dagLayout(events)` to compute (level, column) coords for each pipeline node, then renders lines.
- **Timeline view** buckets events into 1-minute bins (last 60 mins), renders an ASCII bar per bin per topic, color-coded.
- **Tokens view** lists per-agent token+cost; sparkline = last 16 minute-bucketed samples.

Slash command:

```ts
// src/slash/monitor.ts
export const monitorCommand: SlashCommand = {
  name: 'monitor',
  description: 'Open the swarm monitor dashboard (DAG / timeline / tokens)',
  async handler(ctx) {
    ctx.openSubmenu({ kind: 'monitor' })
  },
}
```

### 6.6 EventBus → view-model glue

```ts
// src/tui/Tasks/useTasksColumns.ts
export function useTasksColumns(deps: { bus: EventBus; tasks: TaskManager }): TasksColumnsState {
  const [state, dispatch] = useReducer(reducer, () => buildInitialState(deps))
  useEffect(() => {
    const offs = [
      deps.bus.subscribe('task',    e => dispatch({ type: 'task', e })),
      deps.bus.subscribe('agent',   e => dispatch({ type: 'agent', e })),
      deps.bus.subscribe('message', e => dispatch({ type: 'message', e })),
    ]
    return () => offs.forEach(off => off())
  }, [deps.bus])
  return state
}
```

Reducer is a pure function over event records — easily unit-tested without rendering.

## 7. Testing strategy

| Area | Test type | Coverage |
|------|-----------|----------|
| Column reducer | unit | task.created adds row; task.state updates row; task.evicted removes; ring-cap at 16 per column |
| Focus reducer | unit | Tab/Shift-Tab/Up/Down/Enter/Esc transitions; column-empty skipped on Tab |
| TasksPanel render | ink-testing-library snapshot | 5-column layout at 120 cols; single-column at 80 cols; selection chevron renders |
| SubagentDetail | ink-testing-library | inject-message submits; plan-approval emits envelope; kill confirms |
| PipelineDetail layout | unit on `dagLayout` | 3-level diamond DAG produces correct (level, col) coords; cycle detection asserts |
| /monitor DAG | ink-testing-library | DAG renders with 4 nodes; selected node highlighted; tab switch to Timeline |
| /monitor Timeline | unit on bucketer | events distributed correctly into 1-min bins; out-of-range events dropped |
| /monitor Tokens | unit on rollup | usage events accumulate per agent; sparkline 16-point window |
| Empty state | unit + render | each column shows `(no <kind>)` in `fgFaint` when 0 rows |
| Narrow term degradation | unit + render | < 100 cols collapses to single column with header strip |

CI gate: `npm run typecheck && npm test`. Bundle budget: foundation+swarm+monitor ≤ 410 KB.

## 8. Milestones

| M | Subject | Touches |
|---|---------|---------|
| M1 | Column reducer + view-model + 5-column layout (no interactivity yet) | `tui/Tasks/{TasksPanel.tsx, columns/*.tsx, useTasksColumns.ts}` |
| M2 | Focus reducer + Tab/jk/Enter wiring; column ring + scrolling | `tui/Tasks/focusReducer.ts`, `tui/hooks/useTasksFocus.ts` |
| M3 | Subagent detail submenu (inject + plan-approval + kill) | `tui/Tasks/SubagentDetail.tsx`, `tui/Submenu/registry.ts` |
| M4 | Pipeline detail submenu (DAG render + node drill-in) | `tui/Tasks/PipelineDetail.tsx`, `tui/Tasks/dagLayout.ts` |
| M5 | Message detail submenu | `tui/Tasks/MessageDetail.tsx` |
| M6 | `/monitor` slash command + DAG view | `slash/monitor.ts`, `tui/Monitor/MonitorView.tsx`, `tui/Monitor/DagView.tsx` |
| M7 | Timeline view + Tokens view + tab switching in `/monitor` | `tui/Monitor/{TimelineView, TokensView}.tsx` |
| M8 | Polish + narrow-terminal fallback + close-out audit | various |

## 9. Risks

| Risk | Mitigation |
|------|------------|
| 1s re-render tick causes flicker on slow terminals | Render only changed columns (React reconciler handles); use `Box.shouldComponentUpdate` equivalent (Ink memoization) |
| Long teammate transcripts blow memory | conversation cap of 200 in foundation; column ring cap of 16 |
| DAG layout breaks on cyclic input (shouldn't happen but defensive) | `dagLayout` throws on cycle; render shows "Cycle detected — pipeline corrupt" panel |
| Inject-message races against teammate turn boundary | `TaskManager.injectMessage` queues into `pendingUserMessages`; teammate picks it up at next turn boundary; UI shows "queued" indicator until consumed |
| Plan-approval prompt left dangling if user closes detail | Approval is independent of UI focus — envelope is queued in router; user can re-open detail and respond, OR ignore (5-min auto-reject) |
| Sparkline math off by one when events span minute boundary | Bucket boundary on `Math.floor(t/60_000) * 60_000`; unit-tested at boundary |
| `/monitor` opening replays 1024 events synchronously and freezes UI | Replay is sliced into 64-event chunks via `setTimeout(0)`; UI shows "loading…" until done |

## 10. Open questions

- Whether DAG view should auto-fit when > 12 nodes (zoom out) or scroll horizontally — defer until real pipelines exceed 6 nodes
- Cost calc requires per-model rates; reuse existing `cost-tracker` rates table or add a separate one — defer to phase14b M7
- Whether to add a `Hooks` column for hook executions — defer; not requested
