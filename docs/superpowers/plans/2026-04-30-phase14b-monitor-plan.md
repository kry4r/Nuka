# Phase 14b Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the Tasks-panel multi-column extension (Plan / Subagents / Pipeline / Backgrounds / Messages) with Tab/jk/Enter interactivity, the four per-subtype detail submenus, and the `/monitor` full-screen dashboard with DAG / Timeline / Tokens tabs.

**Architecture:** Eight milestones. Layer 1 — pure reducers (column / focus / dag / timeline / tokens) → Layer 2 — Ink components binding via `useTasksColumns` hook → Layer 3 — submenus + slash command. All data flows from EventBus (no direct TaskManager polls). Reducers are unit-tested with synthetic event records; component tests use ink-testing-library.

**Tech Stack:** Ink 6.8, React 19.2, TypeScript, vitest, ink-testing-library, foundation EventBus + TaskManager + ProgressTracker, phase14a swarm primitives (pipeline / roundtable / messages).

**Source-of-truth spec:** `docs/superpowers/specs/2026-04-30-phase14b-monitor-design.md`

---

## File Structure

**New files:**

```
src/tui/Tasks/
  columns/PlanColumn.tsx
  columns/SubagentColumn.tsx
  columns/PipelineColumn.tsx
  columns/BackgroundColumn.tsx
  columns/MessageColumn.tsx
  columnReducer.ts                 § 5.1 — pure reducer over EventRecord
  focusReducer.ts                  § 5.2 — Tab/jk/Enter state machine
  useTasksColumns.ts               § 6.6 — bus → state hook
  SubagentDetail.tsx               § 6.2
  PipelineDetail.tsx               § 6.3
  MessageDetail.tsx                § 6.4
  dagLayout.ts                     pure (level, col) coord computation
src/tui/Monitor/
  MonitorView.tsx                  § 6.5 — submenu root, tab switcher
  DagView.tsx
  TimelineView.tsx
  TokensView.tsx
  bucketTimeline.ts                pure 1-min bucketer
  rollupTokens.ts                  pure per-agent rollup
src/slash/monitor.ts               § 6.5 — slash command

test/tui/Tasks/
  columnReducer.test.ts
  focusReducer.test.ts
  TasksPanel.test.tsx              ink snapshot
  SubagentDetail.test.tsx
  PipelineDetail.test.tsx
  MessageDetail.test.tsx
  dagLayout.test.ts
test/tui/Monitor/
  bucketTimeline.test.ts
  rollupTokens.test.ts
  MonitorView.test.tsx
test/integration/
  phase14b-monitor.test.tsx        M8 — events → panel + dashboard
```

**Modified files:**

```
src/tui/Tasks/TasksPanel.tsx       rewrite to 5-column layout
src/slash/registry.ts              register monitorCommand
src/tui/Submenu/registry.ts        register subagent-detail / pipeline-detail / message-detail / monitor
```

**Bundle budget:** phase14a (365 KB) + 45 KB UI = 410 KB.

---

## Task 1: Column reducer

**Files:**
- Create: `src/tui/Tasks/columnReducer.ts`
- Create: `test/tui/Tasks/columnReducer.test.ts`

- [ ] **Step 1: Test**

```ts
// test/tui/Tasks/columnReducer.test.ts
import { describe, it, expect } from 'vitest'
import { columnReducer, initialColumns } from '../../../src/tui/Tasks/columnReducer'

describe('columnReducer', () => {
  it('task.created adds row to subagent column when kind=in_process_teammate', () => {
    const s0 = initialColumns()
    const s1 = columnReducer(s0, { topic: 'task', payload: { type: 'task.created', task: { id: 't1', kind: 'in_process_teammate', description: 'd', state: 'running', outputFile: '', spec: {} as never, agentName: 'alice', teamName: 'demo' } as never } })
    expect(s1.subagent.rows.length).toBe(1)
    expect(s1.subagent.rows[0]!.id).toBe('t1')
  })

  it('task.state updates row status', () => {
    const s0 = initialColumns()
    const s1 = columnReducer(s0, { topic: 'task', payload: { type: 'task.created', task: { id: 't1', kind: 'local_bash', description: 'd', state: 'running', outputFile: '', spec: {} as never } as never } })
    const s2 = columnReducer(s1, { topic: 'task', payload: { type: 'task.state', id: 't1', from: 'running', to: 'completed' } })
    expect(s2.background.rows[0]!.status).toBe('completed')
  })

  it('task.evicted removes row', () => {
    const s0 = initialColumns()
    const s1 = columnReducer(s0, { topic: 'task', payload: { type: 'task.created', task: { id: 't1', kind: 'local_bash', description: 'd', state: 'completed', outputFile: '', spec: {} as never } as never } })
    const s2 = columnReducer(s1, { topic: 'task', payload: { type: 'task.evicted', id: 't1' } })
    expect(s2.background.rows.length).toBe(0)
  })

  it('message.sent adds to messages column', () => {
    const s0 = initialColumns()
    const s1 = columnReducer(s0, { topic: 'message', payload: { type: 'message.sent', envelope: { id: 'm1', from: 'lead', to: 'team:demo/alice', summary: 'hi', message: 'hi', sentAt: 0 } } })
    expect(s1.message.rows.length).toBe(1)
    expect(s1.message.rows[0]!.primary).toContain('lead')
  })

  it('caps each column at 16', () => {
    let s = initialColumns()
    for (let i = 0; i < 25; i++) {
      s = columnReducer(s, { topic: 'message', payload: { type: 'message.sent', envelope: { id: `m${i}`, from: 'a', to: 'b', summary: `s${i}`, message: 'x', sentAt: i } } })
    }
    expect(s.message.rows.length).toBe(16)
    expect(s.message.rows[0]!.id).toBe('m24')        // newest first
  })
})
```

- [ ] **Step 2: Run — fails**

Run: `npx vitest run test/tui/Tasks/columnReducer.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/tui/Tasks/columnReducer.ts
import type { EventRecord } from '../../core/events/types'
import type { Task } from '../../core/tasks/types'

export type ColumnKind = 'plan' | 'subagent' | 'pipeline' | 'background' | 'message'

export type Row = {
  id: string
  primary: string
  secondary: string
  status: string
  tokens?: { in: number; out: number }
  startedAt?: number
}

export type ColumnsState = Record<ColumnKind, { rows: Row[] }>

const CAP = 16

export function initialColumns(): ColumnsState {
  return { plan: { rows: [] }, subagent: { rows: [] }, pipeline: { rows: [] }, background: { rows: [] }, message: { rows: [] } }
}

function classify(kind: Task['kind']): ColumnKind {
  switch (kind) {
    case 'in_process_teammate': return 'subagent'
    case 'remote_agent': return 'subagent'
    case 'local_bash':
    case 'local_shell':
    case 'dream':
    case 'local_agent':
    default: return 'background'
  }
}

function addRow(state: ColumnsState, col: ColumnKind, row: Row): ColumnsState {
  const next = { ...state[col] }
  next.rows = [row, ...state[col].rows.filter(r => r.id !== row.id)].slice(0, CAP)
  return { ...state, [col]: next }
}

function updateRow(state: ColumnsState, col: ColumnKind, id: string, patch: Partial<Row>): ColumnsState {
  const next = { ...state[col] }
  next.rows = state[col].rows.map(r => r.id === id ? { ...r, ...patch } : r)
  return { ...state, [col]: next }
}

function removeRow(state: ColumnsState, col: ColumnKind, id: string): ColumnsState {
  const next = { ...state[col] }
  next.rows = state[col].rows.filter(r => r.id !== id)
  return { ...state, [col]: next }
}

export function columnReducer(state: ColumnsState, rec: { topic: string; payload: any }): ColumnsState {
  const p = rec.payload
  if (rec.topic === 'task' && p.type === 'task.created') {
    const col = classify(p.task.kind)
    return addRow(state, col, {
      id: p.task.id,
      primary: p.task.agentName ?? p.task.description,
      secondary: p.task.teamName ?? p.task.kind,
      status: p.task.state,
      startedAt: p.task.startedAt,
    })
  }
  if (rec.topic === 'task' && p.type === 'task.state') {
    for (const col of ['subagent', 'background', 'pipeline'] as ColumnKind[]) {
      if (state[col].rows.find(r => r.id === p.id)) return updateRow(state, col, p.id, { status: p.to })
    }
    return state
  }
  if (rec.topic === 'task' && p.type === 'task.progress') {
    for (const col of ['subagent', 'background', 'pipeline'] as ColumnKind[]) {
      if (state[col].rows.find(r => r.id === p.id)) {
        return updateRow(state, col, p.id, { tokens: { in: p.snapshot.latestInputTokens, out: p.snapshot.cumulativeOutputTokens } })
      }
    }
    return state
  }
  if (rec.topic === 'task' && p.type === 'task.evicted') {
    for (const col of ['subagent', 'background', 'pipeline'] as ColumnKind[]) {
      if (state[col].rows.find(r => r.id === p.id)) return removeRow(state, col, p.id)
    }
    return state
  }
  if (rec.topic === 'message' && p.type === 'message.sent') {
    return addRow(state, 'message', {
      id: p.envelope.id,
      primary: `${p.envelope.from} → ${p.envelope.to}`,
      secondary: p.envelope.summary,
      status: 'sent',
      startedAt: p.envelope.sentAt,
    })
  }
  if (rec.topic === 'message' && p.type === 'message.delivered') {
    return updateRow(state, 'message', p.envelopeId, { status: 'delivered' })
  }
  return state
}
```

- [ ] **Step 4: Run — passes**

Run: `npx vitest run test/tui/Tasks/columnReducer.test.ts`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tui/Tasks/columnReducer.ts test/tui/Tasks/columnReducer.test.ts
git commit -m "feat(phase14b/m1): pure column reducer over event records"
```

---

## Task 2: Focus reducer

**Files:**
- Create: `src/tui/Tasks/focusReducer.ts`
- Create: `test/tui/Tasks/focusReducer.test.ts`

- [ ] **Step 1: Test**

```ts
// test/tui/Tasks/focusReducer.test.ts
import { describe, it, expect } from 'vitest'
import { focusReducer, initialFocus } from '../../../src/tui/Tasks/focusReducer'

describe('focusReducer', () => {
  const cols = ['plan','subagent','pipeline','background','message'] as const

  it('Tab from prompt → plan', () => {
    expect(focusReducer(initialFocus(), { type: 'tab' })).toEqual({ kind: 'tasks-column', column: 'plan', selectedIndex: 0 })
  })
  it('Tab cycles columns', () => {
    let s = initialFocus()
    for (const c of cols) {
      s = focusReducer(s, { type: 'tab' })
      expect(s.kind).toBe('tasks-column')
      expect((s as any).column).toBe(c)
    }
    s = focusReducer(s, { type: 'tab' })
    expect(s.kind).toBe('prompt')
  })
  it('Down moves selectedIndex within column', () => {
    let s: any = focusReducer(initialFocus(), { type: 'tab' })
    s = focusReducer(s, { type: 'down' })
    expect(s.selectedIndex).toBe(1)
  })
  it('Enter transitions to tasks-row', () => {
    let s: any = focusReducer(initialFocus(), { type: 'tab' })
    s = focusReducer(s, { type: 'enter', rowId: 'r1' })
    expect(s).toEqual({ kind: 'tasks-row', column: 'plan', rowId: 'r1' })
  })
  it('Esc from tasks-row returns to tasks-column', () => {
    const s: any = focusReducer({ kind: 'tasks-row', column: 'plan', rowId: 'r1' }, { type: 'esc' })
    expect(s).toEqual({ kind: 'tasks-column', column: 'plan', selectedIndex: 0 })
  })
  it('Esc from tasks-column returns to prompt', () => {
    const s: any = focusReducer({ kind: 'tasks-column', column: 'plan', selectedIndex: 0 }, { type: 'esc' })
    expect(s).toEqual({ kind: 'prompt' })
  })
})
```

- [ ] **Step 2: Run — fails**

Run: `npx vitest run test/tui/Tasks/focusReducer.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/tui/Tasks/focusReducer.ts
export type ColumnKind = 'plan' | 'subagent' | 'pipeline' | 'background' | 'message'
const ORDER: ColumnKind[] = ['plan', 'subagent', 'pipeline', 'background', 'message']

export type FocusState =
  | { kind: 'prompt' }
  | { kind: 'tasks-column'; column: ColumnKind; selectedIndex: number }
  | { kind: 'tasks-row'; column: ColumnKind; rowId: string }

export type FocusEvent =
  | { type: 'tab' }
  | { type: 'shift-tab' }
  | { type: 'up' }
  | { type: 'down' }
  | { type: 'enter'; rowId?: string }
  | { type: 'esc' }

export const initialFocus = (): FocusState => ({ kind: 'prompt' })

export function focusReducer(state: FocusState, e: FocusEvent): FocusState {
  if (e.type === 'tab') {
    if (state.kind === 'prompt') return { kind: 'tasks-column', column: ORDER[0]!, selectedIndex: 0 }
    if (state.kind === 'tasks-column') {
      const idx = ORDER.indexOf(state.column)
      const next = ORDER[idx + 1]
      return next ? { kind: 'tasks-column', column: next, selectedIndex: 0 } : { kind: 'prompt' }
    }
    return state
  }
  if (e.type === 'shift-tab') {
    if (state.kind === 'prompt') return { kind: 'tasks-column', column: ORDER[ORDER.length - 1]!, selectedIndex: 0 }
    if (state.kind === 'tasks-column') {
      const idx = ORDER.indexOf(state.column)
      const prev = ORDER[idx - 1]
      return prev ? { kind: 'tasks-column', column: prev, selectedIndex: 0 } : { kind: 'prompt' }
    }
    return state
  }
  if (e.type === 'down' && state.kind === 'tasks-column') return { ...state, selectedIndex: state.selectedIndex + 1 }
  if (e.type === 'up' && state.kind === 'tasks-column') return { ...state, selectedIndex: Math.max(0, state.selectedIndex - 1) }
  if (e.type === 'enter' && state.kind === 'tasks-column' && e.rowId) return { kind: 'tasks-row', column: state.column, rowId: e.rowId }
  if (e.type === 'esc') {
    if (state.kind === 'tasks-row') return { kind: 'tasks-column', column: state.column, selectedIndex: 0 }
    if (state.kind === 'tasks-column') return { kind: 'prompt' }
  }
  return state
}
```

- [ ] **Step 4: Run + commit**

```bash
npx vitest run test/tui/Tasks/focusReducer.test.ts
git add src/tui/Tasks/focusReducer.ts test/tui/Tasks/focusReducer.test.ts
git commit -m "feat(phase14b/m2): focus reducer for Tab/jk/Enter"
```

---

## Task 3: useTasksColumns hook

**Files:**
- Create: `src/tui/Tasks/useTasksColumns.ts`

- [ ] **Step 1: Implement**

```ts
// src/tui/Tasks/useTasksColumns.ts
import { useEffect, useReducer } from 'react'
import { columnReducer, initialColumns, type ColumnsState } from './columnReducer'
import type { EventBus } from '../../core/events/bus'

type Action = { topic: string; payload: any }

export function useTasksColumns(bus: EventBus): ColumnsState {
  const [state, dispatch] = useReducer(
    (s: ColumnsState, a: Action) => columnReducer(s, a),
    null,
    () => initialColumns(),
  )
  useEffect(() => {
    const offs = ['task', 'agent', 'message', 'harness'].map(topic =>
      bus.subscribe(topic as any, (payload: any) => dispatch({ topic, payload })),
    )
    return () => offs.forEach(off => off())
  }, [bus])
  return state
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tui/Tasks/useTasksColumns.ts
git commit -m "feat(phase14b/m1): useTasksColumns hook (bus → reducer)"
```

---

## Task 4: Five column components + TasksPanel rewrite

**Files:**
- Create: 5 column component files
- Modify: `src/tui/Tasks/TasksPanel.tsx`
- Create: `test/tui/Tasks/TasksPanel.test.tsx`

- [ ] **Step 1: Test (snapshot at 120 cols)**

```tsx
// test/tui/Tasks/TasksPanel.test.tsx
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import * as React from 'react'
import { TasksPanel } from '../../../src/tui/Tasks/TasksPanel'
import { initialColumns } from '../../../src/tui/Tasks/columnReducer'

describe('TasksPanel layout', () => {
  it('renders 5 column headers', () => {
    const { lastFrame } = render(<TasksPanel state={initialColumns()} focus={{ kind: 'prompt' }} cols={120} />)
    const out = lastFrame() ?? ''
    expect(out).toContain('Plan')
    expect(out).toContain('Subagents')
    expect(out).toContain('Pipeline')
    expect(out).toContain('Backgrounds')
    expect(out).toContain('Messages')
  })

  it('shows (no <kind>) when column empty', () => {
    const out = (render(<TasksPanel state={initialColumns()} focus={{ kind: 'prompt' }} cols={120} />).lastFrame() ?? '')
    expect(out.toLowerCase()).toContain('no plan')
    expect(out.toLowerCase()).toContain('no message')
  })

  it('narrow terminal collapses to single column', () => {
    const out = render(<TasksPanel state={initialColumns()} focus={{ kind: 'prompt' }} cols={80} />).lastFrame() ?? ''
    expect(out.toLowerCase()).toContain('[plan|sub|pipe|bg|msg]')
  })
})
```

- [ ] **Step 2: Implement column components (skeleton each)**

```tsx
// src/tui/Tasks/columns/PlanColumn.tsx
import * as React from 'react'
import { Box, Text } from 'ink'
import type { ColumnsState, Row } from '../columnReducer'

export function PlanColumn(props: { rows: Row[]; focused: boolean; selectedIndex?: number }): React.ReactNode {
  return (
    <Box flexDirection="column" minWidth={18} flexGrow={1} borderStyle="round" borderColor={props.focused ? 'primary' : 'fgMuted'}>
      <Text bold>Plan</Text>
      {props.rows.length === 0
        ? <Text dimColor>(no plan)</Text>
        : props.rows.map((r, i) => (
            <Text key={r.id} color={props.selectedIndex === i ? 'primary' : undefined}>{r.primary}</Text>
          ))
      }
    </Box>
  )
}
```

(Repeat for Subagent / Pipeline / Background / Message columns with appropriate label and any column-specific decoration like a `●` for `running`.)

- [ ] **Step 3: TasksPanel.tsx rewrite**

```tsx
// src/tui/Tasks/TasksPanel.tsx
import * as React from 'react'
import { Box, Text } from 'ink'
import { PlanColumn } from './columns/PlanColumn'
import { SubagentColumn } from './columns/SubagentColumn'
import { PipelineColumn } from './columns/PipelineColumn'
import { BackgroundColumn } from './columns/BackgroundColumn'
import { MessageColumn } from './columns/MessageColumn'
import type { ColumnsState } from './columnReducer'
import type { FocusState } from './focusReducer'

export function TasksPanel(props: { state: ColumnsState; focus: FocusState; cols: number }): React.ReactNode {
  const focusedCol = props.focus.kind === 'tasks-column' ? props.focus.column : undefined
  const selectedIndex = props.focus.kind === 'tasks-column' ? props.focus.selectedIndex : undefined

  if (props.cols < 100) {
    const order = ['plan', 'subagent', 'pipeline', 'background', 'message'] as const
    const active = focusedCol ?? 'plan'
    const idx = order.indexOf(active)
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="fgMuted">
        <Text>[plan|sub|pipe|bg|msg] ({idx + 1}/5)</Text>
        {/* render only the active column body */}
        {active === 'plan'       && <PlanColumn rows={props.state.plan.rows} focused selectedIndex={selectedIndex} />}
        {active === 'subagent'   && <SubagentColumn rows={props.state.subagent.rows} focused selectedIndex={selectedIndex} />}
        {active === 'pipeline'   && <PipelineColumn rows={props.state.pipeline.rows} focused selectedIndex={selectedIndex} />}
        {active === 'background' && <BackgroundColumn rows={props.state.background.rows} focused selectedIndex={selectedIndex} />}
        {active === 'message'    && <MessageColumn rows={props.state.message.rows} focused selectedIndex={selectedIndex} />}
      </Box>
    )
  }
  return (
    <Box flexDirection="row">
      <PlanColumn       rows={props.state.plan.rows}       focused={focusedCol === 'plan'}       selectedIndex={focusedCol === 'plan' ? selectedIndex : undefined} />
      <SubagentColumn   rows={props.state.subagent.rows}   focused={focusedCol === 'subagent'}   selectedIndex={focusedCol === 'subagent' ? selectedIndex : undefined} />
      <PipelineColumn   rows={props.state.pipeline.rows}   focused={focusedCol === 'pipeline'}   selectedIndex={focusedCol === 'pipeline' ? selectedIndex : undefined} />
      <BackgroundColumn rows={props.state.background.rows} focused={focusedCol === 'background'} selectedIndex={focusedCol === 'background' ? selectedIndex : undefined} />
      <MessageColumn    rows={props.state.message.rows}    focused={focusedCol === 'message'}    selectedIndex={focusedCol === 'message' ? selectedIndex : undefined} />
    </Box>
  )
}
```

- [ ] **Step 4: Run + commit**

```bash
npx vitest run test/tui/Tasks/TasksPanel.test.tsx
git add src/tui/Tasks/columns/*.tsx src/tui/Tasks/TasksPanel.tsx test/tui/Tasks/TasksPanel.test.tsx
git commit -m "feat(phase14b/m1): TasksPanel 5-column layout + narrow fallback"
```

---

## Task 5: Subagent detail submenu

**Files:**
- Create: `src/tui/Tasks/SubagentDetail.tsx`
- Create: `test/tui/Tasks/SubagentDetail.test.tsx`

- [ ] **Step 1: Test (smoke)**

```tsx
// test/tui/Tasks/SubagentDetail.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import * as React from 'react'
import { SubagentDetail } from '../../../src/tui/Tasks/SubagentDetail'

describe('SubagentDetail', () => {
  it('renders header + activity rail', () => {
    const out = render(<SubagentDetail
      taskId="t1" agentName="alice" teamName="demo" status="running"
      conversation={[{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }]}
      activities={[{ toolName: 'Read', input: { file: 'x.ts' }, activityDescription: 'Reading x.ts' }]}
      planAwaitingApproval={undefined}
      onInjectMessage={vi.fn()} onPause={vi.fn()} onKill={vi.fn()} onShutdown={vi.fn()}
      onApprovePlan={vi.fn()} onRejectPlan={vi.fn()}
    />).lastFrame() ?? ''
    expect(out).toContain('alice')
    expect(out).toContain('demo')
    expect(out).toContain('Reading x.ts')
  })

  it('shows plan-approval prompt when present', () => {
    const out = render(<SubagentDetail
      taskId="t1" agentName="alice" teamName="demo" status="idle"
      conversation={[]} activities={[]}
      planAwaitingApproval={{ plan: 'do A then B', requestId: 'r1' }}
      onInjectMessage={() => {}} onPause={() => {}} onKill={() => {}} onShutdown={() => {}}
      onApprovePlan={() => {}} onRejectPlan={() => {}}
    />).lastFrame() ?? ''
    expect(out.toLowerCase()).toContain('approve')
    expect(out).toContain('do A then B')
  })
})
```

- [ ] **Step 2: Implement**

```tsx
// src/tui/Tasks/SubagentDetail.tsx
import * as React from 'react'
import { Box, Text } from 'ink'

type Props = {
  taskId: string; agentName: string; teamName: string; status: string
  conversation: Array<{ role: string; content: string }>
  activities: Array<{ toolName: string; input: Record<string, unknown>; activityDescription?: string }>
  planAwaitingApproval?: { plan: string; requestId: string }
  onInjectMessage: (text: string) => void
  onPause: () => void
  onKill: () => void
  onShutdown: () => void
  onApprovePlan: (requestId: string) => void
  onRejectPlan: (requestId: string, feedback: string) => void
}

export function SubagentDetail(p: Props): React.ReactNode {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="primary">
      <Text bold>{p.agentName} · {p.teamName} · {p.status}</Text>
      <Box flexDirection="column" marginY={1}>
        {p.conversation.slice(-30).map((m, i) => (
          <Text key={i} dimColor={m.role === 'user'}>{m.role === 'user' ? '> ' : '◌ '}{m.content}</Text>
        ))}
      </Box>
      <Box flexDirection="column">
        <Text bold>Activity</Text>
        {p.activities.map((a, i) => <Text key={i} dimColor>{a.activityDescription ?? a.toolName}</Text>)}
      </Box>
      {p.planAwaitingApproval && (
        <Box flexDirection="column" borderStyle="single" borderColor="warning" padding={1}>
          <Text bold>Plan awaiting approval:</Text>
          <Text>{p.planAwaitingApproval.plan}</Text>
          <Text dimColor>[a]pprove · [r]eject</Text>
        </Box>
      )}
      <Box marginTop={1}><Text dimColor>[i] inject · [p] pause · [k] kill · [s] shutdown · [esc] back</Text></Box>
    </Box>
  )
}
```

- [ ] **Step 3: Run + commit**

```bash
npx vitest run test/tui/Tasks/SubagentDetail.test.tsx
git add src/tui/Tasks/SubagentDetail.tsx test/tui/Tasks/SubagentDetail.test.tsx
git commit -m "feat(phase14b/m3): SubagentDetail submenu"
```

---

## Task 6: DAG layout

**Files:**
- Create: `src/tui/Tasks/dagLayout.ts`
- Create: `test/tui/Tasks/dagLayout.test.ts`

- [ ] **Step 1: Test**

```ts
// test/tui/Tasks/dagLayout.test.ts
import { describe, it, expect } from 'vitest'
import { dagLayout } from '../../../src/tui/Tasks/dagLayout'

describe('dagLayout', () => {
  it('places diamond a → b,c → d on 3 levels', () => {
    const out = dagLayout([
      { id: 'a', parents: [] }, { id: 'b', parents: ['a'] },
      { id: 'c', parents: ['a'] }, { id: 'd', parents: ['b', 'c'] },
    ])
    expect(out.find(n => n.id === 'a')!.level).toBe(0)
    expect(out.find(n => n.id === 'b')!.level).toBe(1)
    expect(out.find(n => n.id === 'c')!.level).toBe(1)
    expect(out.find(n => n.id === 'd')!.level).toBe(2)
  })

  it('throws on cycle', () => {
    expect(() => dagLayout([{ id: 'a', parents: ['b'] }, { id: 'b', parents: ['a'] }])).toThrow(/cycle/i)
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/tui/Tasks/dagLayout.ts
export type DagInputNode = { id: string; parents: string[] }
export type DagPlacedNode = { id: string; level: number; column: number; parents: string[] }

export function dagLayout(nodes: DagInputNode[]): DagPlacedNode[] {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const level = new Map<string, number>()
  const visiting = new Set<string>()
  const compute = (id: string): number => {
    if (level.has(id)) return level.get(id)!
    if (visiting.has(id)) throw new Error(`cycle through ${id}`)
    visiting.add(id)
    const n = byId.get(id); if (!n) throw new Error(`missing ${id}`)
    const lv = n.parents.length === 0 ? 0 : 1 + Math.max(...n.parents.map(compute))
    visiting.delete(id); level.set(id, lv)
    return lv
  }
  for (const n of nodes) compute(n.id)
  // Pack columns within a level by insertion order
  const byLevel = new Map<number, string[]>()
  for (const n of nodes) {
    const lv = level.get(n.id)!
    const arr = byLevel.get(lv) ?? []
    arr.push(n.id); byLevel.set(lv, arr)
  }
  const out: DagPlacedNode[] = []
  for (const [lv, ids] of byLevel) {
    ids.forEach((id, col) => out.push({ id, level: lv, column: col, parents: byId.get(id)!.parents }))
  }
  return out
}
```

- [ ] **Step 3: Run + commit**

```bash
npx vitest run test/tui/Tasks/dagLayout.test.ts
git add src/tui/Tasks/dagLayout.ts test/tui/Tasks/dagLayout.test.ts
git commit -m "feat(phase14b/m4): dagLayout pure function"
```

---

## Task 7: Pipeline detail submenu

**Files:**
- Create: `src/tui/Tasks/PipelineDetail.tsx`
- Create: `test/tui/Tasks/PipelineDetail.test.tsx`

- [ ] **Step 1: Test (smoke)**

```tsx
// test/tui/Tasks/PipelineDetail.test.tsx
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import * as React from 'react'
import { PipelineDetail } from '../../../src/tui/Tasks/PipelineDetail'

describe('PipelineDetail', () => {
  it('renders DAG nodes with status', () => {
    const out = render(<PipelineDetail
      pipelineId="pipe-1"
      nodes={[
        { id: 'r', agentName: 'core:researcher', status: 'completed', parents: [] },
        { id: 'p', agentName: 'core:planner',    status: 'running',   parents: ['r'] },
        { id: 'i', agentName: 'core:implementer', status: 'pending',  parents: ['p'] },
      ]}
    />).lastFrame() ?? ''
    expect(out).toContain('researcher')
    expect(out).toContain('planner')
    expect(out).toContain('implementer')
  })
})
```

- [ ] **Step 2: Implement**

```tsx
// src/tui/Tasks/PipelineDetail.tsx
import * as React from 'react'
import { Box, Text } from 'ink'
import { dagLayout } from './dagLayout'

type Node = { id: string; agentName: string; status: string; parents: string[] }

export function PipelineDetail(p: { pipelineId: string; nodes: Node[] }): React.ReactNode {
  const placed = React.useMemo(() => {
    try { return dagLayout(p.nodes.map(n => ({ id: n.id, parents: n.parents }))) }
    catch (e) { return null }
  }, [p.nodes])
  if (!placed) return <Text color="warning">Cycle detected — pipeline corrupt</Text>
  const maxLevel = Math.max(...placed.map(n => n.level))
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="primary">
      <Text bold>Pipeline {p.pipelineId}</Text>
      {Array.from({ length: maxLevel + 1 }, (_, lv) => (
        <Box key={lv} flexDirection="row">
          {placed.filter(n => n.level === lv).map(pn => {
            const node = p.nodes.find(n => n.id === pn.id)!
            const symbol = node.status === 'completed' ? '✅' : node.status === 'running' ? '▶' : node.status === 'failed' ? '✗' : '○'
            return (
              <Box key={pn.id} marginRight={2} borderStyle="single" padding={0}>
                <Text>{symbol} {node.agentName}</Text>
              </Box>
            )
          })}
        </Box>
      ))}
    </Box>
  )
}
```

- [ ] **Step 3: Run + commit**

```bash
npx vitest run test/tui/Tasks/PipelineDetail.test.tsx
git add src/tui/Tasks/PipelineDetail.tsx test/tui/Tasks/PipelineDetail.test.tsx
git commit -m "feat(phase14b/m4): PipelineDetail submenu with DAG render"
```

---

## Task 8: Message detail submenu

**Files:**
- Create: `src/tui/Tasks/MessageDetail.tsx`
- Create: `test/tui/Tasks/MessageDetail.test.tsx`

- [ ] **Step 1: Test + impl (concise)**

```tsx
// test/tui/Tasks/MessageDetail.test.tsx
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import * as React from 'react'
import { MessageDetail } from '../../../src/tui/Tasks/MessageDetail'

describe('MessageDetail', () => {
  it('renders envelope inspector', () => {
    const out = render(<MessageDetail envelope={{
      id: 'm1', from: 'lead', to: 'team:demo/alice', summary: 'kickoff', message: 'do thing', sentAt: 0,
    }} />).lastFrame() ?? ''
    expect(out).toContain('lead')
    expect(out).toContain('alice')
    expect(out).toContain('do thing')
  })
})
```

```tsx
// src/tui/Tasks/MessageDetail.tsx
import * as React from 'react'
import { Box, Text } from 'ink'
import type { MessageEnvelope } from '../../core/messaging/types'

export function MessageDetail(p: { envelope: MessageEnvelope }): React.ReactNode {
  const body = typeof p.envelope.message === 'string' ? p.envelope.message : JSON.stringify(p.envelope.message, null, 2)
  return (
    <Box flexDirection="column" borderStyle="round">
      <Text bold>{p.envelope.from} → {p.envelope.to}</Text>
      <Text dimColor>{new Date(p.envelope.sentAt).toISOString()}</Text>
      <Text>{p.envelope.summary}</Text>
      <Box marginY={1}><Text>{body}</Text></Box>
      <Text dimColor>[r] reply · [esc] back</Text>
    </Box>
  )
}
```

- [ ] **Step 2: Run + commit**

```bash
npx vitest run test/tui/Tasks/MessageDetail.test.tsx
git add src/tui/Tasks/MessageDetail.tsx test/tui/Tasks/MessageDetail.test.tsx
git commit -m "feat(phase14b/m5): MessageDetail submenu"
```

---

## Task 9: Timeline bucketer

**Files:**
- Create: `src/tui/Monitor/bucketTimeline.ts`
- Create: `test/tui/Monitor/bucketTimeline.test.ts`

- [ ] **Step 1: Test**

```ts
// test/tui/Monitor/bucketTimeline.test.ts
import { describe, it, expect } from 'vitest'
import { bucketTimeline } from '../../../src/tui/Monitor/bucketTimeline'

describe('bucketTimeline', () => {
  it('places events into 1-min bins by topic', () => {
    const t0 = 1700000000000             // arbitrary epoch ms aligned to a minute
    const events = [
      { t: t0, topic: 'task' as const }, { t: t0 + 30_000, topic: 'task' as const },
      { t: t0 + 60_000, topic: 'agent' as const },
      { t: t0 + 90_000, topic: 'message' as const },
    ]
    const buckets = bucketTimeline(events, t0, 3)
    expect(buckets.length).toBe(3)
    expect(buckets[0]!.task).toBe(2)
    expect(buckets[1]!.agent).toBe(1)
    expect(buckets[1]!.message).toBe(1)
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/tui/Monitor/bucketTimeline.ts
export type TimelineBucket = { bucketStart: number; task: number; agent: number; message: number; harness: number }

export function bucketTimeline(
  events: Array<{ t: number; topic: 'task' | 'agent' | 'message' | 'harness' }>,
  startMs: number,
  bucketCount: number,
): TimelineBucket[] {
  const aligned = Math.floor(startMs / 60_000) * 60_000
  const out: TimelineBucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    bucketStart: aligned + i * 60_000, task: 0, agent: 0, message: 0, harness: 0,
  }))
  for (const e of events) {
    const idx = Math.floor((e.t - aligned) / 60_000)
    if (idx < 0 || idx >= bucketCount) continue
    ;(out[idx] as any)[e.topic]++
  }
  return out
}
```

- [ ] **Step 3: Run + commit**

```bash
npx vitest run test/tui/Monitor/bucketTimeline.test.ts
git add src/tui/Monitor/bucketTimeline.ts test/tui/Monitor/bucketTimeline.test.ts
git commit -m "feat(phase14b/m7): timeline 1-min bucketer"
```

---

## Task 10: Token rollup

**Files:**
- Create: `src/tui/Monitor/rollupTokens.ts`
- Create: `test/tui/Monitor/rollupTokens.test.ts`

- [ ] **Step 1: Test**

```ts
// test/tui/Monitor/rollupTokens.test.ts
import { describe, it, expect } from 'vitest'
import { rollupTokens } from '../../../src/tui/Monitor/rollupTokens'

describe('rollupTokens', () => {
  it('accumulates per-agent input/output tokens', () => {
    const r = rollupTokens([
      { agentName: 'alice', inputTokens: 100, outputTokens: 50 },
      { agentName: 'alice', inputTokens: 200, outputTokens: 80 },
      { agentName: 'bob', inputTokens: 50, outputTokens: 25 },
    ])
    expect(r.alice.inputTokens).toBe(200)        // latest input wins
    expect(r.alice.outputTokens).toBe(130)
    expect(r.bob.inputTokens).toBe(50)
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/tui/Monitor/rollupTokens.ts
export type AgentTokenRollup = { inputTokens: number; outputTokens: number }

export function rollupTokens(events: Array<{ agentName: string; inputTokens: number; outputTokens: number }>): Record<string, AgentTokenRollup> {
  const out: Record<string, AgentTokenRollup> = {}
  for (const e of events) {
    if (!out[e.agentName]) out[e.agentName] = { inputTokens: 0, outputTokens: 0 }
    out[e.agentName]!.inputTokens = e.inputTokens                        // latest wins
    out[e.agentName]!.outputTokens += e.outputTokens                     // sum
  }
  return out
}
```

- [ ] **Step 3: Run + commit**

```bash
npx vitest run test/tui/Monitor/rollupTokens.test.ts
git add src/tui/Monitor/rollupTokens.ts test/tui/Monitor/rollupTokens.test.ts
git commit -m "feat(phase14b/m7): per-agent token rollup"
```

---

## Task 11: MonitorView submenu

**Files:**
- Create: `src/tui/Monitor/MonitorView.tsx`
- Create: `src/tui/Monitor/DagView.tsx`
- Create: `src/tui/Monitor/TimelineView.tsx`
- Create: `src/tui/Monitor/TokensView.tsx`
- Create: `test/tui/Monitor/MonitorView.test.tsx`

- [ ] **Step 1: Test (smoke + tab cycling)**

```tsx
// test/tui/Monitor/MonitorView.test.tsx
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import * as React from 'react'
import { MonitorView } from '../../../src/tui/Monitor/MonitorView'

describe('MonitorView', () => {
  it('renders DAG tab by default', () => {
    const out = render(<MonitorView events={[]} dagNodes={[]} />).lastFrame() ?? ''
    expect(out).toContain('DAG')
  })
  it('shows "terminal too narrow" below 80 cols', () => {
    const out = render(<MonitorView events={[]} dagNodes={[]} cols={70} />).lastFrame() ?? ''
    expect(out.toLowerCase()).toContain('too narrow')
  })
})
```

- [ ] **Step 2: Implement**

```tsx
// src/tui/Monitor/MonitorView.tsx
import * as React from 'react'
import { Box, Text } from 'ink'
import { DagView } from './DagView'
import { TimelineView } from './TimelineView'
import { TokensView } from './TokensView'

type Tab = 'dag' | 'timeline' | 'tokens'

export function MonitorView(p: {
  events: Array<{ t: number; topic: 'task' | 'agent' | 'message' | 'harness' }>
  dagNodes: Array<{ id: string; agentName: string; status: string; parents: string[] }>
  agentUsage?: Array<{ agentName: string; inputTokens: number; outputTokens: number }>
  cols?: number
}): React.ReactNode {
  const [tab, setTab] = React.useState<Tab>('dag')
  const cols = p.cols ?? 120
  if (cols < 80) return <Text color="warning">Terminal too narrow ({cols} cols) — Monitor needs ≥ 80.</Text>
  return (
    <Box flexDirection="column">
      <Box>
        <Text bold inverse={tab === 'dag'}> DAG </Text>
        <Text bold inverse={tab === 'timeline'}> Timeline </Text>
        <Text bold inverse={tab === 'tokens'}> Tokens </Text>
        <Text dimColor>  [Tab] cycle · [Esc] close</Text>
      </Box>
      {tab === 'dag'      && <DagView nodes={p.dagNodes} />}
      {tab === 'timeline' && <TimelineView events={p.events} />}
      {tab === 'tokens'   && <TokensView usage={p.agentUsage ?? []} />}
    </Box>
  )
}
```

```tsx
// src/tui/Monitor/DagView.tsx
import * as React from 'react'
import { PipelineDetail } from '../Tasks/PipelineDetail'
export function DagView(p: { nodes: Array<{ id: string; agentName: string; status: string; parents: string[] }> }): React.ReactNode {
  return <PipelineDetail pipelineId="live" nodes={p.nodes} />
}
```

```tsx
// src/tui/Monitor/TimelineView.tsx
import * as React from 'react'
import { Box, Text } from 'ink'
import { bucketTimeline } from './bucketTimeline'

export function TimelineView(p: { events: Array<{ t: number; topic: 'task' | 'agent' | 'message' | 'harness' }> }): React.ReactNode {
  const startMs = Date.now() - 60 * 60_000
  const buckets = bucketTimeline(p.events, startMs, 60)
  const bar = (n: number): string => '▆'.repeat(Math.min(n, 8))
  return (
    <Box flexDirection="column">
      {buckets.slice(-30).map(b => (
        <Box key={b.bucketStart}>
          <Text dimColor>{new Date(b.bucketStart).toISOString().slice(11, 16)} </Text>
          <Text color="primary">{bar(b.task)}</Text>
          <Text color="warning">{bar(b.agent)}</Text>
          <Text color="cyan">{bar(b.message)}</Text>
        </Box>
      ))}
    </Box>
  )
}
```

```tsx
// src/tui/Monitor/TokensView.tsx
import * as React from 'react'
import { Box, Text } from 'ink'
import { rollupTokens } from './rollupTokens'

export function TokensView(p: { usage: Array<{ agentName: string; inputTokens: number; outputTokens: number }> }): React.ReactNode {
  const r = rollupTokens(p.usage)
  return (
    <Box flexDirection="column">
      {Object.entries(r).map(([name, t]) => (
        <Text key={name}>{name.padEnd(20)} in: {t.inputTokens}  out: {t.outputTokens}</Text>
      ))}
    </Box>
  )
}
```

- [ ] **Step 3: Run + commit**

```bash
npx vitest run test/tui/Monitor/MonitorView.test.tsx
git add src/tui/Monitor/*.tsx src/tui/Monitor/*.ts test/tui/Monitor/MonitorView.test.tsx
git commit -m "feat(phase14b/m6+m7): /monitor view with DAG/Timeline/Tokens tabs"
```

---

## Task 12: `/monitor` slash command

**Files:**
- Create: `src/slash/monitor.ts`
- Modify: `src/slash/registry.ts`

- [ ] **Step 1: Implement**

```ts
// src/slash/monitor.ts
import type { SlashCommand } from './types'

export const monitorCommand: SlashCommand = {
  name: 'monitor',
  description: 'Open the swarm monitor dashboard (DAG / Timeline / Tokens)',
  async handler(ctx) {
    ctx.openSubmenu({ kind: 'monitor' })
    return { ok: true }
  },
}
```

In `src/slash/registry.ts` (or wherever slash commands are registered at boot), add:

```ts
import { monitorCommand } from './monitor'
slashRegistry.register(monitorCommand)
```

- [ ] **Step 2: Commit**

```bash
git add src/slash/monitor.ts src/slash/registry.ts
git commit -m "feat(phase14b/m6): /monitor slash command"
```

---

## Task 13: Tasks-panel keyboard wiring

**Files:**
- Modify: `src/tui/Tasks/TasksPanel.tsx` or App-level input dispatch
- Modify: input dispatch (likely `src/tui/App.tsx` or a hook)

- [ ] **Step 1: Wire input dispatch**

Wherever the App reads keyboard events, route Tab/Shift-Tab/j/k/Up/Down/Enter/Esc through `focusReducer`:

```tsx
useInput((input, key) => {
  if (key.tab && !key.shift) setFocus(focusReducer(focus, { type: 'tab' }))
  else if (key.tab && key.shift) setFocus(focusReducer(focus, { type: 'shift-tab' }))
  else if (key.downArrow || input === 'j') setFocus(focusReducer(focus, { type: 'down' }))
  else if (key.upArrow || input === 'k') setFocus(focusReducer(focus, { type: 'up' }))
  else if (key.return && focus.kind === 'tasks-column') {
    const col = state[focus.column]
    const row = col.rows[focus.selectedIndex]
    if (row) setFocus(focusReducer(focus, { type: 'enter', rowId: row.id }))
  }
  else if (key.escape) setFocus(focusReducer(focus, { type: 'esc' }))
})
```

When `focus.kind === 'tasks-row'`, route the row's `column` + `rowId` to open the corresponding detail submenu via existing submenu registry.

- [ ] **Step 2: Smoke test manually**

Boot Nuka, press Ctrl+T to expand tasks panel, then Tab/jk/Enter cycle through. Verify Esc returns.

- [ ] **Step 3: Commit**

```bash
git add src/tui/Tasks/TasksPanel.tsx src/tui/App.tsx
git commit -m "feat(phase14b/m2): keyboard wiring for Tab/jk/Enter/Esc focus"
```

---

## Task 14: M8 — End-to-end integration

**Files:**
- Create: `test/integration/phase14b-monitor.test.tsx`

- [ ] **Step 1: Test**

```tsx
// test/integration/phase14b-monitor.test.tsx
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import * as React from 'react'
import { TasksPanel } from '../../src/tui/Tasks/TasksPanel'
import { columnReducer, initialColumns } from '../../src/tui/Tasks/columnReducer'

describe('phase14b end-to-end', () => {
  it('synthetic events → 5-column render', () => {
    let s = initialColumns()
    s = columnReducer(s, { topic: 'task', payload: { type: 'task.created', task: { id: 't1', kind: 'in_process_teammate', description: 'd', state: 'running', outputFile: '', spec: {} as never, agentName: 'alice', teamName: 'demo' } as never } })
    s = columnReducer(s, { topic: 'task', payload: { type: 'task.created', task: { id: 't2', kind: 'local_bash', description: 'echo', state: 'completed', outputFile: '', spec: {} as never } as never } })
    s = columnReducer(s, { topic: 'message', payload: { type: 'message.sent', envelope: { id: 'm1', from: 'lead', to: 'team:demo/alice', summary: 'go', message: 'go', sentAt: 0 } } })
    const out = render(<TasksPanel state={s} focus={{ kind: 'prompt' }} cols={120} />).lastFrame() ?? ''
    expect(out).toContain('alice')
    expect(out).toContain('echo')
    expect(out).toContain('lead')
  })
})
```

- [ ] **Step 2: Run + audit**

```bash
npx vitest run test/integration/phase14b-monitor.test.tsx
npm run typecheck && npm test && npm run build
git add test/integration/phase14b-monitor.test.tsx
git commit -m "test(phase14b/m8): integration — events to 5-column panel"
```

Expected: green; bundle ≤ 410 KB.

---

## Self-Review

**1. Spec coverage:**

| Spec section | Plan task |
|--------------|-----------|
| § 6.1 TasksPanel multi-column | Task 1, 4 |
| § 6.2 SubagentDetail | Task 5 |
| § 6.3 PipelineDetail + dagLayout | Task 6, 7 |
| § 6.4 MessageDetail | Task 8 |
| § 6.5 MonitorView | Task 11 |
| § 6.6 useTasksColumns | Task 3 |
| § 5.2 Focus model | Task 2, 13 |
| timeline + tokens | Task 9, 10 |
| /monitor slash | Task 12 |
| narrow term degradation | Task 4 |

**2. Placeholder scan:** No "TBD" / "implement later". Color names (`primary`, `fgMuted`, `warning`) reference Nuka's existing theme — implementer should confirm they exist via `Read src/tui/theme.ts`.

**3. Type consistency:** `Row`, `ColumnKind` consistent across reducer + components; `EventRecord` from foundation; `MessageEnvelope` from foundation.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-30-phase14b-monitor-plan.md`. Two execution options: subagent-driven (recommended) or inline. Which approach?
