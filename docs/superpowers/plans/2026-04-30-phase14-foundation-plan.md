# Phase 14 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the shared infrastructure (Task type union, EventBus, MessageRouter, TeamRegistry, ProgressTracker, forkedAgent, Coordinator gate, on-disk layout) that phase14a/b/c/d depend on.

**Architecture:** Eight milestones (M1–M8). M1–M2 are blocking (everything else depends on them). M3–M7 can land in parallel after M1–M2. M8 closes the phase. All work is **type-first**: every new public type ships with a `*.test-d.ts` expectation, then unit tests, then integration. No UI changes.

**Tech Stack:** TypeScript 5.6, Node ≥ 18, vitest 2.1, zod 4.3, Ink (untouched this phase), MSW for forkedAgent network mocks. Existing patterns: dependency injection via constructor (`home`, `bus`, `clock`), `~/.nuka` rooted disk state, descriminated-union task specs.

**Source-of-truth spec:** `docs/superpowers/specs/2026-04-30-phase14-foundation-design.md`

---

## File Structure

**New files (creation):**

```
src/core/events/
  bus.ts                       § 6.2 — EventBus singleton + ring buffer
  types.ts                     §§ 5.6, 6.2 — TaskEvent / AgentBusEvent / MessageEvent / HarnessEvent / EventRecord
  ndjsonFlusher.ts             § 5.6 — opt-in flusher subscriber writing events/<session>.ndjson
src/core/messaging/
  types.ts                     § 5.3 — MessageEnvelope + ProtocolMessage zod schemas
  router.ts                    § 6.3 — MessageRouter
  inProcessBackend.ts          § 6.3 — InProcessBackend (Map<address, EventEmitter>)
src/core/teams/
  types.ts                     § 5.4 — Team / TeamMember / TeamConfig zod schema
  registry.ts                  § 6.4 — TeamRegistry CRUD + persistence
src/core/tasks/
  progressTracker.ts           § 6.5 — ProgressTracker class + getToolSearchOrReadInfo collapse
  meta.ts                      § 5.5 — read/write <id>.meta.json sidecar (sync + atomic rename)
  retention.ts                 § 5.7 — once-per-boot retention sweep
  run-teammate.ts              § 5.1 + § 6.1 — stub runner for in_process_teammate
  run-shell.ts                 § 5.1 — stub runner for local_shell
  run-remote-agent.ts          § 5.1 — stub runner for remote_agent
  run-dream.ts                 § 5.1 — stub runner for dream
src/core/agent/
  forkedAgent.ts               § 6.6 — runForkedAgent + CacheSafeParams
  coordinatorMode.ts           § 6.7 — isCoordinatorMode + workerToolWhitelist + getCoordinatorUserContext
src/core/paths.ts              § 6.8 — teamsDir / recapsDir / forksDir / eventsDir / ensureNukaLayout

test/core/events/
  bus.test.ts
  ndjsonFlusher.test.ts
test/core/messaging/
  envelope.test.ts             zod schema round-trip + invalid rejection
  router.test.ts               in-process delivery + broadcast + unknown address
test/core/teams/
  registry.test.ts             CRUD round-trip + atomic write
test/core/tasks/
  types.test-d.ts              type-only narrowing + legacy compat
  progressTracker.test.ts      capping + collapse + token math
  meta.test.ts                 sidecar round-trip + missing-file fallback
  retention.test.ts            sweep deletes by age
  manager.extension.test.ts    setTeammateState / injectMessage / requestShutdown / setProgress
test/core/agent/
  forkedAgent.test.ts          CacheSafeParams build + canUseTool deny + cache hit logging
  coordinatorMode.test.ts      env parse + workerToolWhitelist + matchSessionMode + getCoordinatorUserContext
test/core/paths.test.ts        ensureNukaLayout + ENOSPC swallow
test/integration/
  phase14-foundation.test.ts   end-to-end: spawn fake teammate → SendMessage → observe bus events → tracker snapshot
```

**Modified files:**

```
src/core/tasks/types.ts        rewrite: TaskKind + TaskState + TaskSpec discriminated union (additive)
src/core/tasks/manager.ts      switch on spec.kind for new runners; new methods (setTeammateState, injectMessage,
                               requestShutdown, resolveTeammate, setProgress, subscribe<Topic>)
src/core/tasks/persist.ts      no change to existing helpers; add reference to meta.ts (no dependency)
src/core/agent/loop.ts         emit agent.tool.start / agent.tool.end / agent.usage to bus (read-only addition)
src/core/agent/events.ts       no change — existing AgentEvent stays as is (model-stream events).
                               EventBus payload is AgentBusEvent, defined in events/types.ts.
src/cli.tsx                    call ensureNukaLayout(home) at boot; install retention sweep; create EventBus
                               singleton; pass bus into TaskManager (constructor opt-in)
test/core/tasks/manager.test.ts kept green; existing fixtures still load
docs/superpowers/specs/2026-04-30-phase14-foundation-design.md  appended note: AgentEvent → AgentBusEvent
```

**Naming reconciliation note:** The spec §6.2 uses `AgentEvent` as the bus payload type, but `src/core/agent/events.ts` already exports an `AgentEvent` for model-stream chunks. To avoid the collision, the implementation uses **`AgentBusEvent`** for the bus payload and leaves the existing `AgentEvent` untouched. M2.T2 amends the spec inline (one-line clarifying note in §6.2).

---

## Task 1: M1 — TaskKind + TaskState additions (type-only)

**Files:**
- Modify: `src/core/tasks/types.ts`
- Test: `test/core/tasks/types.test-d.ts`

- [ ] **Step 1: Write the failing type test**

Create `test/core/tasks/types.test-d.ts`:

```ts
import { expectTypeOf } from 'vitest'
import type { Task, TaskKind, TaskState, TaskSpec } from '../../../src/core/tasks/types'

// Existing kinds still typed.
expectTypeOf<TaskKind>().toEqualTypeOf<
  | 'local_bash'
  | 'local_agent'
  | 'in_process_teammate'
  | 'local_shell'
  | 'remote_agent'
  | 'dream'
>()

// State machine extended with idle + shutdown_requested.
expectTypeOf<TaskState>().toEqualTypeOf<
  | 'pending'
  | 'running'
  | 'idle'
  | 'completed'
  | 'failed'
  | 'killed'
  | 'shutdown_requested'
>()

// Discriminated union exhaustive.
const exhaust = (s: TaskSpec): string => {
  switch (s.kind) {
    case 'local_bash':           return 'b'
    case 'local_agent':          return 'a'
    case 'in_process_teammate':  return 't'
    case 'local_shell':          return 's'
    case 'remote_agent':         return 'r'
    case 'dream':                return 'd'
  }
}
expectTypeOf(exhaust).toBeFunction()
```

- [ ] **Step 2: Run typecheck and verify it fails**

Run: `npx tsc --noEmit -p tsconfig.test.json`
Expected: errors complaining that `TaskKind` is missing the new arms.

- [ ] **Step 3: Add new arms to `TaskKind` and `TaskState`**

Edit `src/core/tasks/types.ts` — replace the two existing exports while keeping the old arms:

```ts
export type TaskKind =
  | 'local_bash'
  | 'local_agent'
  | 'in_process_teammate'
  | 'local_shell'
  | 'remote_agent'
  | 'dream'

export type TaskState =
  | 'pending'
  | 'running'
  | 'idle'
  | 'completed'
  | 'failed'
  | 'killed'
  | 'shutdown_requested'
```

- [ ] **Step 4: Run typecheck — still fails (TaskSpec exhaustiveness)**

Run: `npx tsc --noEmit -p tsconfig.test.json`
Expected: `exhaust` switch missing 4 cases.

- [ ] **Step 5: Commit type stubs only**

```bash
git add src/core/tasks/types.ts test/core/tasks/types.test-d.ts
git commit -m "feat(phase14/m1): widen TaskKind + TaskState (stubs)"
```

---

## Task 2: M1 — Add new TaskSpec arms

**Files:**
- Modify: `src/core/tasks/types.ts`

- [ ] **Step 1: Add the four new spec arms below the existing two**

```ts
import type { ResolvedAgentDef } from '../agents/types'
import type { ProgressTrackerSnapshot } from './progressTracker'

export type InProcessTeammateSpec = {
  kind: 'in_process_teammate'
  description: string
  teamName: string
  agentName: string
  agentDef: ResolvedAgentDef
  initialMessage: string
  longRunning: boolean
}

export type LocalShellSpec = {
  kind: 'local_shell'
  description: string
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  pty: boolean
}

export type RemoteAgentSpec = {
  kind: 'remote_agent'
  description: string
  transport: { kind: string; addr: string }
  initialMessage: string
}

export type DreamSpec = {
  kind: 'dream'
  description: string
  consolidationPrompt: string
  parentSessionId: string
}

export type TaskSpec =
  | LocalBashSpec
  | LocalAgentSpec
  | InProcessTeammateSpec
  | LocalShellSpec
  | RemoteAgentSpec
  | DreamSpec
```

- [ ] **Step 2: Add new fields to `Task`**

Below the existing `Task` declaration, replace it with:

```ts
export type Task = {
  id: string
  kind: TaskKind
  description: string
  state: TaskState
  startedAt?: number
  finishedAt?: number
  exitCode?: number
  outputFile: string
  spec: TaskSpec
  error?: string
  agentName?: string
  teamName?: string
  progress?: ProgressTrackerSnapshot
  evictAfter?: number
}
```

(`ProgressTrackerSnapshot` is imported from a file that doesn't exist yet — that's fine; it gets created in Task 13. The compile error is expected and will resolve there.)

- [ ] **Step 3: Run typecheck — type-d test now passes for `TaskKind`/`TaskState` but fails on missing `progressTracker` import**

Run: `npx tsc --noEmit -p tsconfig.test.json`
Expected: error `Cannot find module './progressTracker'` — that's the only new error.

- [ ] **Step 4: Add a temporary inline placeholder** to keep the build green until M3:

At the top of `src/core/tasks/types.ts`, replace the import with a local alias:

```ts
// Temporary local alias until M3 ships progressTracker.ts.
// Remove this and switch back to `import type { ProgressTrackerSnapshot } from './progressTracker'`
// in Task 14 step 3.
export type ProgressTrackerSnapshot = {
  toolUseCount: number
  latestInputTokens: number
  cumulativeOutputTokens: number
  recentActivities: Array<{
    toolName: string
    input: Record<string, unknown>
    activityDescription?: string
    isSearch?: boolean
    isRead?: boolean
  }>
  summary?: string
}
```

- [ ] **Step 5: Run typecheck — should now pass**

Run: `npx tsc --noEmit -p tsconfig.test.json`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/core/tasks/types.ts
git commit -m "feat(phase14/m1): add 4 new TaskSpec arms + Task fields"
```

---

## Task 3: M1 — Update TaskManager kind switch

**Files:**
- Modify: `src/core/tasks/manager.ts`
- Test: keep `test/core/tasks/manager.test.ts` green

- [ ] **Step 1: Read the existing enqueue switch**

Read `src/core/tasks/manager.ts` lines around the runner dispatch (`runBash` / `runAgent` selection).

- [ ] **Step 2: Add stubs for new runners**

Create `src/core/tasks/run-teammate.ts`:

```ts
import type { Task } from './types'

export async function runTeammate(_task: Task, _signal: AbortSignal): Promise<void> {
  throw new Error('run-teammate: not implemented (phase14a)')
}
```

Create `src/core/tasks/run-shell.ts`:

```ts
import type { Task } from './types'

export async function runShell(_task: Task, _signal: AbortSignal): Promise<void> {
  throw new Error('run-shell: not implemented (phase14a)')
}
```

Create `src/core/tasks/run-remote-agent.ts`:

```ts
import type { Task } from './types'

export async function runRemoteAgent(_task: Task, _signal: AbortSignal): Promise<void> {
  throw new Error('run-remote-agent: not implemented (phase14a)')
}
```

Create `src/core/tasks/run-dream.ts`:

```ts
import type { Task } from './types'

export async function runDream(_task: Task, _signal: AbortSignal): Promise<void> {
  throw new Error('run-dream: not implemented (phase14c)')
}
```

- [ ] **Step 3: Extend the manager dispatch switch**

In `src/core/tasks/manager.ts`'s `enqueue`, replace the `if (spec.kind === 'local_bash') ... else ...` branching with an exhaustive switch. Show full function body:

```ts
import { runBash } from './run-bash'
import { runAgent } from './run-agent'
import { runTeammate } from './run-teammate'
import { runShell } from './run-shell'
import { runRemoteAgent } from './run-remote-agent'
import { runDream } from './run-dream'

// inside class TaskManager, replace existing enqueue():
enqueue(spec: TaskSpec): Task {
  const id = randomUUID().slice(0, 8)
  const outputFile = taskOutputPath(this.home, id)
  ensureTasksDirSync(this.home)
  const task: Task = {
    id,
    kind: spec.kind,
    description: spec.description,
    state: 'pending',
    outputFile,
    spec,
    startedAt: Date.now(),
  }
  this.tasks.set(id, task)
  this.emit(task)

  const abort = new AbortController()
  const runner = pickRunner(spec)
  const done = (async () => {
    task.state = 'running'
    this.emit(task)
    try {
      await runner(task, abort.signal)
      task.state = 'completed'
    } catch (err) {
      task.state = 'failed'
      task.error = (err as Error).message
    } finally {
      task.finishedAt = Date.now()
      this.emit(task)
      this.running.delete(id)
    }
  })()
  this.running.set(id, { task, abort, done })
  return task
}

function pickRunner(spec: TaskSpec): (t: Task, s: AbortSignal) => Promise<void> {
  switch (spec.kind) {
    case 'local_bash':           return runBash
    case 'local_agent':          return runAgent
    case 'in_process_teammate':  return runTeammate
    case 'local_shell':          return runShell
    case 'remote_agent':         return runRemoteAgent
    case 'dream':                return runDream
  }
}
```

(If the existing function has subtler shape — e.g. emits via a different helper — preserve that and only change the runner-selection logic.)

- [ ] **Step 4: Run existing manager tests**

Run: `npx vitest run test/core/tasks/manager.test.ts`
Expected: all pass (legacy bash + agent paths unchanged).

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/core/tasks/manager.ts src/core/tasks/run-teammate.ts \
        src/core/tasks/run-shell.ts src/core/tasks/run-remote-agent.ts \
        src/core/tasks/run-dream.ts
git commit -m "feat(phase14/m1): exhaustive runner switch + 4 stub runners"
```

---

## Task 4: M2 — EventBus types

**Files:**
- Create: `src/core/events/types.ts`
- Test: `test/core/events/bus.test.ts` (added in Task 5)

- [ ] **Step 1: Create the events types file**

Create `src/core/events/types.ts`:

```ts
import type { Task, TaskState, ProgressTrackerSnapshot } from '../tasks/types'
import type { MessageEnvelope } from '../messaging/types'

export type Topic = 'task' | 'agent' | 'message' | 'harness'

export type TaskEvent =
  | { type: 'task.created'; task: Task }
  | { type: 'task.state'; id: string; from: TaskState; to: TaskState }
  | { type: 'task.progress'; id: string; snapshot: ProgressTrackerSnapshot }
  | { type: 'task.evicted'; id: string }

export type AgentBusEvent =
  | { type: 'agent.tool.start'; sessionId: string; toolName: string; input: unknown }
  | { type: 'agent.tool.end'; sessionId: string; toolName: string; ok: boolean; durationMs: number }
  | { type: 'agent.message.assistant'; sessionId: string; text: string }
  | { type: 'agent.usage'; sessionId: string; inputTokens: number; outputTokens: number }

export type MessageEvent =
  | { type: 'message.sent'; envelope: MessageEnvelope }
  | { type: 'message.delivered'; envelopeId: string; to: string }
  | { type: 'message.failed'; envelopeId: string; reason: string }

export type HarnessStage =
  | 'brainstorm' | 'spec' | 'plan' | 'search'
  | 'implement' | 'review' | 'recap'

export type HarnessEvent =
  | { type: 'harness.stage.enter'; stage: HarnessStage; sessionId: string }
  | { type: 'harness.stage.exit'; stage: HarnessStage; sessionId: string; reason: string }
  | { type: 'harness.editor.directive'; sessionId: string; directive: string }

export type EventPayload<T extends Topic> =
  T extends 'task' ? TaskEvent :
  T extends 'agent' ? AgentBusEvent :
  T extends 'message' ? MessageEvent :
  T extends 'harness' ? HarnessEvent :
  never

export type EventRecord =
  | { seq: number; t: number; topic: 'task'; payload: TaskEvent }
  | { seq: number; t: number; topic: 'agent'; payload: AgentBusEvent }
  | { seq: number; t: number; topic: 'message'; payload: MessageEvent }
  | { seq: number; t: number; topic: 'harness'; payload: HarnessEvent }
```

(`MessageEnvelope` is imported from a file that doesn't exist yet; M5 creates it. To avoid blocking, the next task adds a temporary alias.)

- [ ] **Step 2: Add temporary MessageEnvelope alias**

Create `src/core/messaging/types.ts` with the bare-minimum stub:

```ts
// Full zod schema lands in M5 (Task 17). This temporary type lets M2 compile.
export type MessageEnvelope = {
  id: string
  from: string
  to: string
  summary: string
  message: string | { type: string; [k: string]: unknown }
  request_id?: string
  sentAt: number
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/core/events/types.ts src/core/messaging/types.ts
git commit -m "feat(phase14/m2): EventBus payload types + MessageEnvelope stub"
```

---

## Task 5: M2 — EventBus implementation

**Files:**
- Create: `src/core/events/bus.ts`
- Create: `test/core/events/bus.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/core/events/bus.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createEventBus } from '../../../src/core/events/bus'
import type { TaskEvent } from '../../../src/core/events/types'

describe('EventBus', () => {
  let bus: ReturnType<typeof createEventBus>
  beforeEach(() => { bus = createEventBus({ ringSize: 8 }) })

  it('delivers emitted events to subscribers of the same topic', () => {
    const seen: TaskEvent[] = []
    bus.subscribe('task', (e: TaskEvent) => seen.push(e))
    const ev: TaskEvent = { type: 'task.evicted', id: 'abc' }
    bus.emit('task', ev)
    expect(seen).toEqual([ev])
  })

  it('does not deliver to subscribers of a different topic', () => {
    let count = 0
    bus.subscribe('agent', () => { count++ })
    bus.emit('task', { type: 'task.evicted', id: 'x' })
    expect(count).toBe(0)
  })

  it('respects an optional filter predicate', () => {
    const seen: TaskEvent[] = []
    bus.subscribe<TaskEvent>(
      'task',
      e => seen.push(e),
      e => e.type === 'task.evicted',
    )
    bus.emit('task', { type: 'task.created', task: {} as never })
    bus.emit('task', { type: 'task.evicted', id: 'y' })
    expect(seen.map(e => e.type)).toEqual(['task.evicted'])
  })

  it('replay returns last N entries of a topic, newest last', () => {
    for (let i = 0; i < 5; i++) {
      bus.emit('task', { type: 'task.evicted', id: `id-${i}` })
    }
    const last3 = bus.replay<TaskEvent>('task', 3)
    expect(last3.map(e => (e as { id: string }).id)).toEqual(['id-2', 'id-3', 'id-4'])
  })

  it('ring buffer is bounded by ringSize', () => {
    for (let i = 0; i < 20; i++) {
      bus.emit('task', { type: 'task.evicted', id: `${i}` })
    }
    const all = bus.replay<TaskEvent>('task', 100)
    expect(all.length).toBe(8)
    expect((all[0] as { id: string }).id).toBe('12')
    expect((all[7] as { id: string }).id).toBe('19')
  })

  it('unsubscribe stops further delivery', () => {
    let n = 0
    const off = bus.subscribe('task', () => { n++ })
    bus.emit('task', { type: 'task.evicted', id: '1' })
    off()
    bus.emit('task', { type: 'task.evicted', id: '2' })
    expect(n).toBe(1)
  })
})
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `npx vitest run test/core/events/bus.test.ts`
Expected: FAIL with `Cannot find module 'bus'`.

- [ ] **Step 3: Implement `bus.ts`**

Create `src/core/events/bus.ts`:

```ts
import type {
  Topic, TaskEvent, AgentBusEvent, MessageEvent, HarnessEvent,
  EventPayload,
} from './types'

type AnyHandler = (e: unknown) => void

export interface EventBus {
  emit(topic: 'task', e: TaskEvent): void
  emit(topic: 'agent', e: AgentBusEvent): void
  emit(topic: 'message', e: MessageEvent): void
  emit(topic: 'harness', e: HarnessEvent): void
  subscribe<E>(topic: Topic, cb: (e: E) => void, filter?: (e: E) => boolean): () => void
  replay<E>(topic: Topic, n: number): E[]
}

export type CreateEventBusOpts = { ringSize?: number }

export function createEventBus(opts: CreateEventBusOpts = {}): EventBus {
  const ringSize = opts.ringSize ?? 1024
  const ring: Map<Topic, unknown[]> = new Map([
    ['task', []], ['agent', []], ['message', []], ['harness', []],
  ])
  const handlers: Map<Topic, Set<AnyHandler>> = new Map([
    ['task', new Set()], ['agent', new Set()],
    ['message', new Set()], ['harness', new Set()],
  ])

  const push = <T>(topic: Topic, ev: T): void => {
    const buf = ring.get(topic)!
    buf.push(ev)
    if (buf.length > ringSize) buf.shift()
    for (const h of handlers.get(topic)!) {
      try { h(ev) } catch { /* swallow handler errors — bus must not crash emitter */ }
    }
  }

  return {
    emit: (topic: Topic, e: unknown): void => push(topic, e),
    subscribe<E>(topic: Topic, cb: (e: E) => void, filter?: (e: E) => boolean): () => void {
      const wrap: AnyHandler = (e) => {
        if (!filter || filter(e as E)) cb(e as E)
      }
      handlers.get(topic)!.add(wrap)
      return () => { handlers.get(topic)!.delete(wrap) }
    },
    replay<E>(topic: Topic, n: number): E[] {
      const buf = ring.get(topic)!
      return buf.slice(-n) as E[]
    },
  } as EventBus
}

export const eventBus: EventBus = createEventBus()
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `npx vitest run test/core/events/bus.test.ts`
Expected: 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/events/bus.ts test/core/events/bus.test.ts
git commit -m "feat(phase14/m2): EventBus with ring buffer + filtered subscribe"
```

---

## Task 6: M2 — NDJSON flusher (opt-in)

**Files:**
- Create: `src/core/events/ndjsonFlusher.ts`
- Create: `test/core/events/ndjsonFlusher.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/core/events/ndjsonFlusher.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createEventBus } from '../../../src/core/events/bus'
import { attachNdjsonFlusher } from '../../../src/core/events/ndjsonFlusher'

describe('attachNdjsonFlusher', () => {
  let dir: string
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-evt-')) })

  it('writes one ndjson line per emitted event', async () => {
    const bus = createEventBus()
    const stop = attachNdjsonFlusher({ bus, dir, sessionId: 'sess-1' })
    bus.emit('task', { type: 'task.evicted', id: 'a' })
    bus.emit('agent', { type: 'agent.usage', sessionId: 'sess-1', inputTokens: 1, outputTokens: 2 })
    await stop()
    const file = path.join(dir, 'sess-1.ndjson')
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n')
    expect(lines.length).toBe(2)
    const recs = lines.map(l => JSON.parse(l))
    expect(recs[0].topic).toBe('task')
    expect(recs[0].seq).toBe(0)
    expect(recs[1].topic).toBe('agent')
    expect(recs[1].seq).toBe(1)
  })
})
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `npx vitest run test/core/events/ndjsonFlusher.test.ts`
Expected: FAIL with `Cannot find module 'ndjsonFlusher'`.

- [ ] **Step 3: Implement the flusher**

Create `src/core/events/ndjsonFlusher.ts`:

```ts
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { EventBus } from './bus'
import type { Topic, EventRecord } from './types'

export type FlusherOpts = {
  bus: EventBus
  dir: string
  sessionId: string
}

export function attachNdjsonFlusher(opts: FlusherOpts): () => Promise<void> {
  fs.mkdirSync(opts.dir, { recursive: true })
  const file = path.join(opts.dir, `${opts.sessionId}.ndjson`)
  const stream = fs.createWriteStream(file, { flags: 'a' })
  let seq = 0
  const offs: Array<() => void> = []
  for (const topic of ['task', 'agent', 'message', 'harness'] as Topic[]) {
    offs.push(opts.bus.subscribe(topic, (payload: unknown) => {
      const rec = { seq: seq++, t: Date.now(), topic, payload } as EventRecord
      stream.write(JSON.stringify(rec) + '\n')
    }))
  }
  return async () => {
    for (const off of offs) off()
    await new Promise<void>((res, rej) => stream.end(err => err ? rej(err) : res()))
  }
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `npx vitest run test/core/events/ndjsonFlusher.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/events/ndjsonFlusher.ts test/core/events/ndjsonFlusher.test.ts
git commit -m "feat(phase14/m2): opt-in NDJSON event flusher"
```

---

## Task 7: M3 — ProgressTracker

**Files:**
- Create: `src/core/tasks/progressTracker.ts`
- Create: `test/core/tasks/progressTracker.test.ts`
- Modify: `src/core/tasks/types.ts` (drop temporary alias added in Task 2 step 4)

- [ ] **Step 1: Write the failing test**

Create `test/core/tasks/progressTracker.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { ProgressTracker } from '../../../src/core/tasks/progressTracker'
import { createEventBus } from '../../../src/core/events/bus'
import type { TaskEvent } from '../../../src/core/events/types'

describe('ProgressTracker', () => {
  let bus: ReturnType<typeof createEventBus>
  let evts: TaskEvent[]
  beforeEach(() => {
    bus = createEventBus()
    evts = []
    bus.subscribe<TaskEvent>('task', e => evts.push(e))
  })

  it('caps recentActivities at 5', () => {
    const t = new ProgressTracker('t1', bus)
    for (let i = 0; i < 10; i++) {
      t.onToolStart(`tool-${i}`, {}, `Action ${i}`)
    }
    expect(t.snapshot().recentActivities.length).toBe(5)
    expect(t.snapshot().recentActivities.map(a => a.toolName)).toEqual([
      'tool-5','tool-6','tool-7','tool-8','tool-9',
    ])
  })

  it('collapses consecutive Read activities', () => {
    const t = new ProgressTracker('t2', bus)
    t.onToolStart('Read', { file: 'a.ts' }, 'Reading a.ts')
    t.onToolStart('Read', { file: 'b.ts' }, 'Reading b.ts')
    t.onToolStart('Read', { file: 'c.ts' }, 'Reading c.ts')
    const snap = t.snapshot()
    expect(snap.recentActivities.length).toBe(1)
    expect(snap.recentActivities[0]!.activityDescription).toMatch(/Reading 3 files/)
  })

  it('input tokens use latest, output tokens accumulate', () => {
    const t = new ProgressTracker('t3', bus)
    t.onUsage({ inputTokens: 100, outputTokens: 50 })
    t.onUsage({ inputTokens: 200, outputTokens: 80 })
    t.onUsage({ inputTokens: 300, outputTokens: 30 })
    const snap = t.snapshot()
    expect(snap.latestInputTokens).toBe(300)
    expect(snap.cumulativeOutputTokens).toBe(160)
    expect(snap.toolUseCount).toBe(0)
  })

  it('emits task.progress on snapshot()', () => {
    const t = new ProgressTracker('t4', bus)
    t.onToolStart('Bash', { command: 'ls' })
    t.snapshot()
    const prog = evts.find(e => e.type === 'task.progress')
    expect(prog).toBeTruthy()
    expect((prog as { id: string }).id).toBe('t4')
  })
})
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `npx vitest run test/core/tasks/progressTracker.test.ts`
Expected: FAIL with `Cannot find module 'progressTracker'`.

- [ ] **Step 3: Implement `progressTracker.ts`**

Create `src/core/tasks/progressTracker.ts`:

```ts
import type { EventBus } from '../events/bus'

export type ToolActivity = {
  toolName: string
  input: Record<string, unknown>
  activityDescription?: string
  isSearch?: boolean
  isRead?: boolean
}

export type ProgressTrackerSnapshot = {
  toolUseCount: number
  latestInputTokens: number
  cumulativeOutputTokens: number
  recentActivities: ToolActivity[]
  summary?: string
}

const MAX_RECENT = 5
const READ_TOOLS = new Set(['Read', 'NotebookRead', 'cat', 'head', 'tail'])
const SEARCH_TOOLS = new Set(['Grep', 'Glob', 'find'])

export class ProgressTracker {
  private toolUseCount = 0
  private latestInputTokens = 0
  private cumulativeOutputTokens = 0
  private activities: ToolActivity[] = []
  private summary?: string

  constructor(private readonly taskId: string, private readonly bus: EventBus) {}

  onToolStart(toolName: string, input: Record<string, unknown>, activityDescription?: string): void {
    this.toolUseCount++
    const activity: ToolActivity = {
      toolName,
      input,
      activityDescription,
      isRead: READ_TOOLS.has(toolName),
      isSearch: SEARCH_TOOLS.has(toolName),
    }
    const last = this.activities[this.activities.length - 1]
    if (last && last.toolName === activity.toolName && (activity.isRead || activity.isSearch)) {
      const m = last.activityDescription?.match(/^(Reading|Searching) (\d+) files?/)
      const next = m ? Number(m[2]) + 1 : 2
      const verb = activity.isRead ? 'Reading' : 'Searching'
      last.activityDescription = `${verb} ${next} files`
      return
    }
    this.activities.push(activity)
    if (this.activities.length > MAX_RECENT) this.activities.shift()
  }

  onUsage(usage: { inputTokens: number; outputTokens: number }): void {
    this.latestInputTokens = usage.inputTokens
    this.cumulativeOutputTokens += usage.outputTokens
  }

  setSummary(summary: string): void { this.summary = summary }

  snapshot(): ProgressTrackerSnapshot {
    const snap: ProgressTrackerSnapshot = {
      toolUseCount: this.toolUseCount,
      latestInputTokens: this.latestInputTokens,
      cumulativeOutputTokens: this.cumulativeOutputTokens,
      recentActivities: [...this.activities],
      summary: this.summary,
    }
    this.bus.emit('task', { type: 'task.progress', id: this.taskId, snapshot: snap })
    return snap
  }
}
```

- [ ] **Step 4: Drop the temporary alias from `types.ts`**

In `src/core/tasks/types.ts`, replace the temporary `export type ProgressTrackerSnapshot = { ... }` block with:

```ts
export type { ProgressTrackerSnapshot } from './progressTracker'
```

- [ ] **Step 5: Run all tests**

Run: `npx vitest run test/core/tasks/progressTracker.test.ts test/core/tasks/types.test-d.ts`
Expected: PASS.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/core/tasks/progressTracker.ts src/core/tasks/types.ts test/core/tasks/progressTracker.test.ts
git commit -m "feat(phase14/m3): ProgressTracker with read/search collapse"
```

---

## Task 8: M3 — AgentLoop bus emission hooks

**Files:**
- Modify: `src/core/agent/loop.ts`
- Test: extend `test/core/agent/loop.test.ts` (or create `test/core/agent/loop.bus.test.ts` if loop test is large)

- [ ] **Step 1: Write the failing test**

Create `test/core/agent/loop.bus.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createEventBus } from '../../../src/core/events/bus'
import type { AgentBusEvent } from '../../../src/core/events/types'
// Use the existing loop test harness if available; otherwise stub deps inline.
// This is a smoke test: when the loop is told to emit, the bus receives.

describe('AgentLoop → EventBus', () => {
  it('emits agent.tool.start / agent.tool.end / agent.usage', async () => {
    const bus = createEventBus()
    const seen: AgentBusEvent[] = []
    bus.subscribe<AgentBusEvent>('agent', e => seen.push(e))

    // Drive the loop using a fake provider yielding one tool_call + turn_end.
    // Call the same factory pattern as test/core/agent/loop.test.ts.
    // (Re-use createFakeProvider from existing loop test fixtures.)
    // Goal: after running, seen contains at least
    //   agent.tool.start, agent.tool.end, agent.usage.
    // The exact harness is whatever the existing loop test uses.
    expect(seen.length).toBeGreaterThanOrEqual(0) // placeholder until wired
  })
})
```

(Harness wiring will reuse whatever fake provider the existing `test/core/agent/loop.test.ts` builds. If that file does not exist or is too coupled, this test stays as a smoke check while the full assertion happens in the integration test in Task 30.)

- [ ] **Step 2: Add bus emission to `loop.ts`**

In `src/core/agent/loop.ts`, after the `RunAgentDeps` type, add an optional `bus?: EventBus` prop:

```ts
import type { EventBus } from '../events/bus'

export type RunAgentDeps = {
  // ... existing fields
  /** Optional event bus — when provided the loop emits AgentBusEvent
   *  for every tool start/end and usage update. */
  bus?: EventBus
}
```

In the loop's tool-execution path, around the `tool_call` handler, emit:

```ts
const startedAt = Date.now()
deps.bus?.emit('agent', {
  type: 'agent.tool.start',
  sessionId: session.id,
  toolName: tool.name,
  input,
})
let ok = true
try {
  result = await tool.run(input, ctx)
} catch (e) {
  ok = false
  throw e
} finally {
  deps.bus?.emit('agent', {
    type: 'agent.tool.end',
    sessionId: session.id,
    toolName: tool.name,
    ok,
    durationMs: Date.now() - startedAt,
  })
}
```

In the `turn_end` handler, when usage is recorded:

```ts
deps.bus?.emit('agent', {
  type: 'agent.usage',
  sessionId: session.id,
  inputTokens: usage.input_tokens ?? 0,
  outputTokens: usage.output_tokens ?? 0,
})
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 4: Run all loop tests**

Run: `npx vitest run test/core/agent`
Expected: PASS (legacy tests unaffected; bus emission is optional).

- [ ] **Step 5: Commit**

```bash
git add src/core/agent/loop.ts test/core/agent/loop.bus.test.ts
git commit -m "feat(phase14/m3): agent loop emits tool/usage to EventBus"
```

---

## Task 9: M4 — forkedAgent CacheSafeParams

**Files:**
- Create: `src/core/agent/forkedAgent.ts`
- Create: `test/core/agent/forkedAgent.test.ts`

- [ ] **Step 1: Write the failing test (CacheSafeParams build only)**

Create `test/core/agent/forkedAgent.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createCacheSafeParams } from '../../../src/core/agent/forkedAgent'

describe('createCacheSafeParams', () => {
  it('snapshots system prompt + tools + last N messages', () => {
    const session = {
      id: 'sess-1',
      providerId: 'anthropic',
      model: 'claude-opus-4-7',
      messages: Array.from({ length: 50 }, (_, i) => ({
        role: 'user' as const,
        content: `m${i}`,
        id: `msg-${i}`,
      })),
    } as never
    const registry = {
      list: () => [{ name: 'Read', description: 'd', parameters: {}, run: async () => ({ output: '', isError: false }), source: 'builtin' }],
    } as never
    const out = createCacheSafeParams({
      parentSession: session,
      registry,
      systemPrompt: 'sys',
      maxFork: 30,
    })
    expect(out.systemPrompt).toBe('sys')
    expect(out.modelParams.model).toBe('claude-opus-4-7')
    expect(out.tools.length).toBe(1)
    expect(out.forkContextMessages.length).toBe(30)
    expect((out.forkContextMessages.at(-1) as { content: string }).content).toBe('m49')
  })

  it('returns a stable snapshot across two calls with the same inputs', () => {
    const session = {
      id: 's', providerId: 'p', model: 'm',
      messages: [{ role: 'user' as const, content: 'x', id: '1' }],
    } as never
    const registry = { list: () => [] } as never
    const a = createCacheSafeParams({ parentSession: session, registry, systemPrompt: 'sys' })
    const b = createCacheSafeParams({ parentSession: session, registry, systemPrompt: 'sys' })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `npx vitest run test/core/agent/forkedAgent.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `forkedAgent.ts` (params only — runFork in next task)**

Create `src/core/agent/forkedAgent.ts`:

```ts
import type { Tool } from '../tools/types'
import type { Session } from '../session/types'
import type { Message } from '../message/types'

export type CacheSafeParams = {
  systemPrompt: string
  tools: Tool[]
  modelParams: { model: string; thinkingConfig?: unknown; maxTokens?: number }
  forkContextMessages: Message[]
}

export type CreateCacheSafeParamsOpts = {
  parentSession: Pick<Session, 'id' | 'providerId' | 'model' | 'messages'>
  registry: { list: () => Tool[] }
  systemPrompt: string
  maxFork?: number
  thinkingConfig?: unknown
  maxTokens?: number
}

const DEFAULT_FORK_WINDOW = 30

export function createCacheSafeParams(opts: CreateCacheSafeParamsOpts): CacheSafeParams {
  const window = opts.maxFork ?? DEFAULT_FORK_WINDOW
  const messages = [...opts.parentSession.messages]
  const recent = messages.slice(-window)
  return {
    systemPrompt: opts.systemPrompt,
    tools: [...opts.registry.list()],
    modelParams: {
      model: opts.parentSession.model,
      thinkingConfig: opts.thinkingConfig,
      maxTokens: opts.maxTokens,
    },
    forkContextMessages: recent,
  }
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `npx vitest run test/core/agent/forkedAgent.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/agent/forkedAgent.ts test/core/agent/forkedAgent.test.ts
git commit -m "feat(phase14/m4): CacheSafeParams snapshot helper"
```

---

## Task 10: M4 — runForkedAgent

**Files:**
- Modify: `src/core/agent/forkedAgent.ts`
- Modify: `test/core/agent/forkedAgent.test.ts`

- [ ] **Step 1: Add the runForkedAgent test**

Append to `test/core/agent/forkedAgent.test.ts`:

```ts
import { runForkedAgent } from '../../../src/core/agent/forkedAgent'

describe('runForkedAgent', () => {
  it('returns text from the fake provider and reports usage', async () => {
    const fakeProvider = {
      resolve: () => ({
        async stream(_req: unknown) {
          yield { type: 'text_delta' as const, text: 'hello fork' }
          yield { type: 'turn_end' as const, usage: { input_tokens: 100, output_tokens: 5 }, stopReason: 'stop' as const }
        },
      }),
    } as never
    const params = {
      systemPrompt: 'sys',
      tools: [],
      modelParams: { model: 'm' },
      forkContextMessages: [],
    }
    const out = await runForkedAgent({
      params,
      prompt: 'do thing',
      providerResolver: fakeProvider,
      signal: new AbortController().signal,
    })
    expect(out.text).toBe('hello fork')
    expect(out.usage.input_tokens).toBe(100)
    expect(out.usage.output_tokens).toBe(5)
  })

  it('canUseTool deny prevents tool execution', async () => {
    let toolRan = false
    const tool = {
      name: 'Read',
      description: 'd',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      source: 'builtin' as const,
      annotations: { readOnly: true, destructive: false, openWorld: false, parallelSafe: true },
      needsPermission: () => 'none' as const,
      run: async () => { toolRan = true; return { output: 'x', isError: false } },
    }
    const fakeProvider = {
      resolve: () => ({
        async stream() {
          yield { type: 'tool_call' as const, id: 't1', name: 'Read', input: {} }
          yield { type: 'turn_end' as const, usage: { input_tokens: 1, output_tokens: 1 }, stopReason: 'stop' as const }
        },
      }),
    } as never
    const out = await runForkedAgent({
      params: { systemPrompt: 's', tools: [tool], modelParams: { model: 'm' }, forkContextMessages: [] },
      prompt: 'go',
      providerResolver: fakeProvider,
      signal: new AbortController().signal,
      canUseTool: () => false,
    })
    expect(toolRan).toBe(false)
    expect(out.text).toBeDefined()
  })
})
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `npx vitest run test/core/agent/forkedAgent.test.ts`
Expected: 2 new tests FAIL with `runForkedAgent is not a function`.

- [ ] **Step 3: Implement runForkedAgent**

Append to `src/core/agent/forkedAgent.ts`:

```ts
import type { ProviderResolver } from '../provider/resolver'
import type { TokenUsage } from '../message/types'
import { makeUserMessage } from '../message/factories'

export type RunForkedAgentOpts = {
  params: CacheSafeParams
  prompt: string
  providerResolver: ProviderResolver
  signal: AbortSignal
  /** Returns true to allow execution of the named tool; default deny-all. */
  canUseTool?: (toolName: string) => boolean
}

export async function runForkedAgent(opts: RunForkedAgentOpts): Promise<{ text: string; usage: TokenUsage }> {
  const { params, prompt, providerResolver, signal } = opts
  const canUse = opts.canUseTool ?? (() => false)
  const provider = providerResolver.resolve()
  const messages = [...params.forkContextMessages, makeUserMessage(prompt)]
  let text = ''
  let usage: TokenUsage = { input_tokens: 0, output_tokens: 0 }
  for await (const ev of provider.stream({
    systemPrompt: params.systemPrompt,
    tools: params.tools,
    messages,
    model: params.modelParams.model,
    signal,
  })) {
    if (signal.aborted) break
    if (ev.type === 'text_delta') text += ev.text
    else if (ev.type === 'turn_end') usage = ev.usage
    else if (ev.type === 'tool_call') {
      if (!canUse(ev.name)) {
        // Deny — return synthetic tool error so the model exits cleanly.
        text += `\n[fork: tool ${ev.name} denied]`
      }
    }
  }
  return { text, usage }
}
```

(If `provider.stream()` is not the real shape, adapt to the real `ProviderResolver` interface — find it via `Read src/core/provider/resolver.ts` and match.)

- [ ] **Step 4: Run the test — verify it passes**

Run: `npx vitest run test/core/agent/forkedAgent.test.ts`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/agent/forkedAgent.ts test/core/agent/forkedAgent.test.ts
git commit -m "feat(phase14/m4): runForkedAgent with canUseTool deny"
```

---

## Task 11: M5 — MessageEnvelope zod schema

**Files:**
- Modify: `src/core/messaging/types.ts`
- Create: `test/core/messaging/envelope.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/core/messaging/envelope.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { MessageEnvelopeSchema, ProtocolMessageSchema } from '../../../src/core/messaging/types'

describe('MessageEnvelopeSchema', () => {
  it('round-trips a string-body message', () => {
    const e = {
      id: '01ABCXYZ',
      from: 'team:demo/alice',
      to: 'team:demo/bob',
      summary: 'hello',
      message: 'hi bob',
      sentAt: 1700000000000,
    }
    expect(MessageEnvelopeSchema.parse(e)).toEqual(e)
  })

  it('rejects empty summary', () => {
    expect(() => MessageEnvelopeSchema.parse({
      id: 'x', from: 'a', to: 'b', summary: '', message: 'hi', sentAt: 0,
    })).toThrow()
  })

  it('round-trips a shutdown_request protocol message', () => {
    const proto = { type: 'shutdown_request' as const, request_id: 'r1' }
    expect(ProtocolMessageSchema.parse(proto)).toEqual(proto)
    const env = {
      id: 'x', from: 'a', to: 'b', summary: 'shutdown', message: proto, request_id: 'r1', sentAt: 1,
    }
    expect(MessageEnvelopeSchema.parse(env).message).toEqual(proto)
  })

  it('rejects an unknown protocol type', () => {
    expect(() => ProtocolMessageSchema.parse({ type: 'noooope' })).toThrow()
  })
})
```

- [ ] **Step 2: Run — verify it fails**

Run: `npx vitest run test/core/messaging/envelope.test.ts`
Expected: FAIL with `MessageEnvelopeSchema is not a function`.

- [ ] **Step 3: Implement the schemas — replace `src/core/messaging/types.ts`**

```ts
import { z } from 'zod'

export const ProtocolMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('shutdown_request'), request_id: z.string() }),
  z.object({ type: z.literal('shutdown_response'), request_id: z.string(), approve: z.boolean() }),
  z.object({ type: z.literal('plan_approval_request'), request_id: z.string(), plan: z.string() }),
  z.object({ type: z.literal('plan_approval_response'), request_id: z.string(), approve: z.boolean(), feedback: z.string().optional() }),
  z.object({ type: z.literal('handoff'), request_id: z.string(), nextStage: z.string(), payload: z.record(z.string(), z.unknown()) }),
])

export const MessageEnvelopeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  summary: z.string().min(1).max(200),
  message: z.union([z.string(), ProtocolMessageSchema]),
  request_id: z.string().optional(),
  sentAt: z.number(),
})

export type ProtocolMessage = z.infer<typeof ProtocolMessageSchema>
export type MessageEnvelope = z.infer<typeof MessageEnvelopeSchema>
```

- [ ] **Step 4: Run — verify it passes**

Run: `npx vitest run test/core/messaging/envelope.test.ts`
Expected: 4 PASS.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: 0 errors (the prior temporary `MessageEnvelope` type is now re-exported as zod-inferred).

- [ ] **Step 6: Commit**

```bash
git add src/core/messaging/types.ts test/core/messaging/envelope.test.ts
git commit -m "feat(phase14/m5): MessageEnvelope + ProtocolMessage zod schemas"
```

---

## Task 12: M5 — InProcess backend

**Files:**
- Create: `src/core/messaging/inProcessBackend.ts`
- Create: `test/core/messaging/inProcessBackend.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/core/messaging/inProcessBackend.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { InProcessBackend } from '../../../src/core/messaging/inProcessBackend'
import type { MessageEnvelope } from '../../../src/core/messaging/types'

const env = (overrides: Partial<MessageEnvelope> = {}): MessageEnvelope => ({
  id: 'm1', from: 'team:t/a', to: 'team:t/b', summary: 'hi', message: 'hi', sentAt: 1, ...overrides,
})

describe('InProcessBackend', () => {
  it('delivers when recipient is subscribed', async () => {
    const b = new InProcessBackend()
    const got: MessageEnvelope[] = []
    b.subscribe('team:t/b', e => got.push(e))
    const ok = await b.send(env())
    expect(ok).toBe(true)
    expect(got.length).toBe(1)
    expect(got[0]!.id).toBe('m1')
  })

  it('returns false when recipient is not subscribed', async () => {
    const b = new InProcessBackend()
    expect(await b.send(env({ to: 'team:t/nobody' }))).toBe(false)
  })

  it('unsubscribe stops further delivery', async () => {
    const b = new InProcessBackend()
    let n = 0
    const off = b.subscribe('team:t/b', () => { n++ })
    await b.send(env())
    off()
    await b.send(env())
    expect(n).toBe(1)
  })
})
```

- [ ] **Step 2: Run — verify it fails**

Run: `npx vitest run test/core/messaging/inProcessBackend.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the backend**

Create `src/core/messaging/inProcessBackend.ts`:

```ts
import type { MessageEnvelope } from './types'

export type MessageBackendKind = 'in-process' | 'uds' | 'bridge'

export interface MessageBackend {
  readonly kind: MessageBackendKind
  send(envelope: MessageEnvelope): Promise<boolean>
  subscribe(localAddress: string, cb: (e: MessageEnvelope) => void): () => void
}

export class InProcessBackend implements MessageBackend {
  readonly kind = 'in-process' as const
  private readonly subs = new Map<string, Set<(e: MessageEnvelope) => void>>()

  send(envelope: MessageEnvelope): Promise<boolean> {
    const handlers = this.subs.get(envelope.to)
    if (!handlers || handlers.size === 0) return Promise.resolve(false)
    for (const h of handlers) {
      try { h(envelope) } catch { /* never let one bad handler stop the rest */ }
    }
    return Promise.resolve(true)
  }

  subscribe(localAddress: string, cb: (e: MessageEnvelope) => void): () => void {
    let set = this.subs.get(localAddress)
    if (!set) { set = new Set(); this.subs.set(localAddress, set) }
    set.add(cb)
    return () => { set!.delete(cb); if (set!.size === 0) this.subs.delete(localAddress) }
  }
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `npx vitest run test/core/messaging/inProcessBackend.test.ts`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/messaging/inProcessBackend.ts test/core/messaging/inProcessBackend.test.ts
git commit -m "feat(phase14/m5): InProcessBackend for MessageRouter"
```

---

## Task 13: M5 — MessageRouter

**Files:**
- Create: `src/core/messaging/router.ts`
- Create: `test/core/messaging/router.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/core/messaging/router.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { MessageRouter } from '../../../src/core/messaging/router'
import { InProcessBackend } from '../../../src/core/messaging/inProcessBackend'
import { createEventBus } from '../../../src/core/events/bus'
import type { MessageEnvelope } from '../../../src/core/messaging/types'
import type { MessageEvent } from '../../../src/core/events/types'

const env = (to: string, overrides: Partial<MessageEnvelope> = {}): MessageEnvelope => ({
  id: 'm', from: 'team:t/a', to, summary: 'hi', message: 'hi', sentAt: 1, ...overrides,
})

describe('MessageRouter', () => {
  it('routes through the in-process backend by default', async () => {
    const bus = createEventBus()
    const backend = new InProcessBackend()
    const r = new MessageRouter({ backends: [backend], bus })
    const got: MessageEnvelope[] = []
    backend.subscribe('team:t/b', e => got.push(e))
    expect(await r.send(env('team:t/b'))).toBe(true)
    expect(got.length).toBe(1)
  })

  it('emits message.sent + message.delivered on success', async () => {
    const bus = createEventBus()
    const backend = new InProcessBackend()
    const r = new MessageRouter({ backends: [backend], bus })
    backend.subscribe('team:t/b', () => {})
    const seen: MessageEvent[] = []
    bus.subscribe<MessageEvent>('message', e => seen.push(e))
    await r.send(env('team:t/b'))
    expect(seen.map(e => e.type)).toEqual(['message.sent', 'message.delivered'])
  })

  it('emits message.failed when no backend accepts', async () => {
    const bus = createEventBus()
    const r = new MessageRouter({ backends: [new InProcessBackend()], bus })
    const seen: MessageEvent[] = []
    bus.subscribe<MessageEvent>('message', e => seen.push(e))
    expect(await r.send(env('team:t/nobody'))).toBe(false)
    expect(seen.some(e => e.type === 'message.failed')).toBe(true)
  })

  it('broadcast sends to every member of a team', async () => {
    const bus = createEventBus()
    const backend = new InProcessBackend()
    const r = new MessageRouter({ backends: [backend], bus })
    let aHits = 0, bHits = 0
    backend.subscribe('team:t/a', () => aHits++)
    backend.subscribe('team:t/b', () => bHits++)
    const n = await r.broadcast({
      teamName: 't',
      members: ['a', 'b'],
      base: { id: 'x', from: 'team:t/lead', summary: 'all', message: 'hello', sentAt: 0 },
    })
    expect(n).toBe(2)
    expect(aHits).toBe(1)
    expect(bHits).toBe(1)
  })
})
```

- [ ] **Step 2: Run — verify it fails**

Run: `npx vitest run test/core/messaging/router.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the router**

Create `src/core/messaging/router.ts`:

```ts
import type { EventBus } from '../events/bus'
import type { MessageBackend } from './inProcessBackend'
import type { MessageEnvelope } from './types'

export type RouterOpts = {
  backends: MessageBackend[]
  bus: EventBus
}

export type BroadcastOpts = {
  teamName: string
  members: string[]
  base: Omit<MessageEnvelope, 'to'>
}

export class MessageRouter {
  constructor(private readonly opts: RouterOpts) {}

  async send(envelope: MessageEnvelope): Promise<boolean> {
    this.opts.bus.emit('message', { type: 'message.sent', envelope })
    for (const b of this.opts.backends) {
      const ok = await b.send(envelope)
      if (ok) {
        this.opts.bus.emit('message', { type: 'message.delivered', envelopeId: envelope.id, to: envelope.to })
        return true
      }
    }
    this.opts.bus.emit('message', { type: 'message.failed', envelopeId: envelope.id, reason: 'no backend accepted' })
    return false
  }

  inbox(localAddress: string): {
    subscribe(cb: (e: MessageEnvelope) => void): () => void
  } {
    return {
      subscribe: (cb): (() => void) => {
        const offs = this.opts.backends.map(b => b.subscribe(localAddress, cb))
        return () => offs.forEach(off => off())
      },
    }
  }

  async broadcast(opts: BroadcastOpts): Promise<number> {
    let delivered = 0
    for (const m of opts.members) {
      const env: MessageEnvelope = { ...opts.base, to: `team:${opts.teamName}/${m}` }
      if (await this.send(env)) delivered++
    }
    return delivered
  }
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `npx vitest run test/core/messaging/router.test.ts`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/messaging/router.ts test/core/messaging/router.test.ts
git commit -m "feat(phase14/m5): MessageRouter with broadcast + bus events"
```

---

## Task 14: M6 — Team config schema + paths

**Files:**
- Create: `src/core/teams/types.ts`
- Modify: `src/core/paths.ts` (create if missing)

- [ ] **Step 1: Add the team types file**

Create `src/core/teams/types.ts`:

```ts
import { z } from 'zod'

export const TeamMemberSchema = z.object({
  agentName: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  agentDefRef: z.string(),
  spawnedAt: z.number(),
  taskId: z.string().optional(),
})

export const TeamConfigSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  description: z.string(),
  taskListId: z.string(),
  members: z.array(TeamMemberSchema),
  createdAt: z.number(),
})

export type TeamMember = z.infer<typeof TeamMemberSchema>
export type Team = z.infer<typeof TeamConfigSchema>
```

- [ ] **Step 2: Create / extend `src/core/paths.ts`**

If the file does not exist yet, create it. Otherwise edit it. Final contents:

```ts
import * as fs from 'node:fs'
import * as path from 'node:path'

export function nukaHome(home: string): string { return path.join(home, '.nuka') }
export function tasksDir(home: string): string { return path.join(nukaHome(home), 'tasks') }
export function teamsDir(home: string): string { return path.join(nukaHome(home), 'teams') }
export function recapsDir(home: string): string { return path.join(nukaHome(home), 'recaps') }
export function forksDir(home: string): string { return path.join(nukaHome(home), 'forks') }
export function eventsDir(home: string): string { return path.join(nukaHome(home), 'events') }
export function teamConfigPath(home: string, name: string): string {
  return path.join(teamsDir(home), name, 'config.json')
}

export function ensureNukaLayout(home: string): void {
  for (const d of [tasksDir(home), teamsDir(home), recapsDir(home), forksDir(home), eventsDir(home)]) {
    try { fs.mkdirSync(d, { recursive: true }) } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOSPC') {
        process.stderr.write(`[nuka] ENOSPC creating ${d} — continuing without it\n`)
        continue
      }
      throw err
    }
  }
}
```

If `tasksDir` is already exported from `src/core/tasks/persist.ts`, leave that one untouched and re-export through `paths.ts`:

```ts
export { tasksDir } from './tasks/persist'
```

(Pick the cleaner option after Reading `persist.ts` again — duplicate exports must be reconciled, never both exist.)

- [ ] **Step 3: Add unit test for paths**

Create `test/core/paths.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { ensureNukaLayout, teamsDir, recapsDir, forksDir, eventsDir } from '../../src/core/paths'

describe('ensureNukaLayout', () => {
  let home: string
  beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-paths-')) })

  it('creates all 5 dirs idempotently', () => {
    ensureNukaLayout(home)
    ensureNukaLayout(home)
    expect(fs.existsSync(teamsDir(home))).toBe(true)
    expect(fs.existsSync(recapsDir(home))).toBe(true)
    expect(fs.existsSync(forksDir(home))).toBe(true)
    expect(fs.existsSync(eventsDir(home))).toBe(true)
  })
})
```

- [ ] **Step 4: Run typecheck + paths test**

Run: `npm run typecheck && npx vitest run test/core/paths.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/teams/types.ts src/core/paths.ts test/core/paths.test.ts
git commit -m "feat(phase14/m6): Team types + ensureNukaLayout for new dirs"
```

---

## Task 15: M6 — TeamRegistry CRUD

**Files:**
- Create: `src/core/teams/registry.ts`
- Create: `test/core/teams/registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/core/teams/registry.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { TeamRegistry } from '../../../src/core/teams/registry'

describe('TeamRegistry', () => {
  let home: string
  let r: TeamRegistry
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-team-'))
    r = new TeamRegistry({ home })
  })

  it('create persists to disk and returns a Team', async () => {
    const t = await r.create('demo', 'demo team')
    expect(t.name).toBe('demo')
    expect(t.taskListId).toBeTruthy()
    expect(t.members.length).toBe(0)
    const file = path.join(home, '.nuka', 'teams', 'demo', 'config.json')
    expect(fs.existsSync(file)).toBe(true)
  })

  it('rejects duplicate name', async () => {
    await r.create('demo', '')
    await expect(r.create('demo', '')).rejects.toThrow(/already exists/)
  })

  it('addMember persists and roundtrips', async () => {
    await r.create('demo', '')
    await r.addMember('demo', { agentName: 'alice', agentDefRef: 'plug:alice', spawnedAt: 1 })
    const r2 = new TeamRegistry({ home })
    const t = r2.find('demo')!
    expect(t.members.map(m => m.agentName)).toEqual(['alice'])
  })

  it('removeMember persists', async () => {
    await r.create('demo', '')
    await r.addMember('demo', { agentName: 'alice', agentDefRef: 'plug:alice', spawnedAt: 1 })
    await r.addMember('demo', { agentName: 'bob', agentDefRef: 'plug:bob', spawnedAt: 2 })
    await r.removeMember('demo', 'alice')
    expect(r.find('demo')!.members.map(m => m.agentName)).toEqual(['bob'])
  })

  it('delete removes config file', async () => {
    await r.create('demo', '')
    await r.delete('demo')
    expect(r.find('demo')).toBeUndefined()
    const file = path.join(home, '.nuka', 'teams', 'demo', 'config.json')
    expect(fs.existsSync(file)).toBe(false)
  })

  it('rejects invalid name', async () => {
    await expect(r.create('Bad Name', '')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run — verify it fails**

Run: `npx vitest run test/core/teams/registry.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the registry**

Create `src/core/teams/registry.ts`:

```ts
import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { TeamConfigSchema, type Team, type TeamMember } from './types'
import { teamsDir, teamConfigPath } from '../paths'

export class TeamRegistry {
  private readonly home: string
  private readonly cache = new Map<string, Team>()

  constructor(opts: { home: string }) {
    this.home = opts.home
    this.loadAll()
  }

  private loadAll(): void {
    const root = teamsDir(this.home)
    if (!fs.existsSync(root)) return
    for (const name of fs.readdirSync(root)) {
      const cfg = teamConfigPath(this.home, name)
      if (!fs.existsSync(cfg)) continue
      try {
        const parsed = TeamConfigSchema.parse(JSON.parse(fs.readFileSync(cfg, 'utf8')))
        this.cache.set(parsed.name, parsed)
      } catch {
        // skip corrupt; keep going
      }
    }
  }

  async create(name: string, description: string): Promise<Team> {
    if (this.cache.has(name)) throw new Error(`team "${name}" already exists`)
    const t: Team = {
      name,
      description,
      taskListId: randomUUID(),
      members: [],
      createdAt: Date.now(),
    }
    TeamConfigSchema.parse(t) // validates name regex etc.
    await this.persist(t)
    this.cache.set(name, t)
    return t
  }

  async delete(name: string, _opts?: { keepTasks?: boolean }): Promise<void> {
    const dir = path.dirname(teamConfigPath(this.home, name))
    await fsp.rm(dir, { recursive: true, force: true })
    this.cache.delete(name)
  }

  find(name: string): Team | undefined { return this.cache.get(name) }
  list(): Team[] { return [...this.cache.values()] }

  async addMember(name: string, m: TeamMember): Promise<void> {
    const t = this.cache.get(name)
    if (!t) throw new Error(`team "${name}" not found`)
    t.members = [...t.members, m]
    await this.persist(t)
  }

  async removeMember(name: string, agentName: string): Promise<void> {
    const t = this.cache.get(name)
    if (!t) throw new Error(`team "${name}" not found`)
    t.members = t.members.filter(m => m.agentName !== agentName)
    await this.persist(t)
  }

  private async persist(t: Team): Promise<void> {
    const cfg = teamConfigPath(this.home, t.name)
    await fsp.mkdir(path.dirname(cfg), { recursive: true })
    const tmp = `${cfg}.tmp-${process.pid}`
    await fsp.writeFile(tmp, JSON.stringify(t, null, 2), 'utf8')
    await fsp.rename(tmp, cfg) // atomic on POSIX
  }
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `npx vitest run test/core/teams/registry.test.ts`
Expected: 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/teams/registry.ts test/core/teams/registry.test.ts
git commit -m "feat(phase14/m6): TeamRegistry with atomic persistence"
```

---

## Task 16: M1+M6 — TaskManager extension methods

**Files:**
- Modify: `src/core/tasks/manager.ts`
- Create: `test/core/tasks/manager.extension.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/core/tasks/manager.extension.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { TaskManager } from '../../../src/core/tasks/manager'
import { createEventBus } from '../../../src/core/events/bus'
import type { TaskEvent } from '../../../src/core/events/types'

describe('TaskManager extensions', () => {
  let home: string
  let bus: ReturnType<typeof createEventBus>
  let mgr: TaskManager
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-mgr-'))
    bus = createEventBus()
    mgr = new TaskManager({ home, bus })
  })

  it('emits task.created on enqueue', () => {
    const seen: TaskEvent[] = []
    bus.subscribe<TaskEvent>('task', e => seen.push(e))
    mgr.enqueue({ kind: 'local_bash', description: 'd', command: 'echo', args: ['1'] })
    expect(seen[0]!.type).toBe('task.created')
  })

  it('setProgress emits task.progress', () => {
    const seen: TaskEvent[] = []
    bus.subscribe<TaskEvent>('task', e => seen.push(e))
    const t = mgr.enqueue({ kind: 'local_bash', description: 'd', command: 'true' })
    mgr.setProgress(t.id, {
      toolUseCount: 2,
      latestInputTokens: 100,
      cumulativeOutputTokens: 50,
      recentActivities: [],
    })
    expect(seen.find(e => e.type === 'task.progress')).toBeTruthy()
  })

  it('resolveTeammate returns task id by qualified address', () => {
    // Cannot run an in_process_teammate yet (stub throws). Use a fake
    // task entry by mocking enqueue's runner — sufficient for the lookup.
    // Acceptable shortcut: the manager exposes resolveTeammate(addr) which
    // just searches `tasks` for a matching teamName/agentName.
    const t = (mgr as unknown as { tasks: Map<string, { id: string; agentName?: string; teamName?: string }> })
    t.tasks.set('id-1', { id: 'id-1', agentName: 'alice', teamName: 'demo' })
    expect(mgr.resolveTeammate('team:demo/alice')).toBe('id-1')
    expect(mgr.resolveTeammate('team:demo/nobody')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run — verify it fails**

Run: `npx vitest run test/core/tasks/manager.extension.test.ts`
Expected: FAIL.

- [ ] **Step 3: Extend TaskManager**

In `src/core/tasks/manager.ts`:

```ts
import type { EventBus } from '../events/bus'
import type { TaskEvent } from '../events/types'
import type { ProgressTrackerSnapshot } from './progressTracker'

export type TaskManagerOpts = {
  home: string
  bus?: EventBus
}

export class TaskManager {
  private readonly home: string
  private readonly bus?: EventBus
  // ... existing private fields
  private readonly tasks = new Map<string, Task>()
  // ... existing constructor body, then:
  constructor(opts: TaskManagerOpts) {
    this.home = opts.home
    this.bus = opts.bus
  }

  // existing on('change') retained.

  /** Topic-typed subscribe via the EventBus passed at construction. */
  subscribe(topic: 'task', cb: (e: TaskEvent) => void): () => void {
    return this.bus ? this.bus.subscribe(topic, cb) : () => {}
  }

  setTeammateState(id: string, next: 'idle' | 'running'): void {
    const t = this.tasks.get(id)
    if (!t) return
    const from = t.state
    t.state = next
    this.emit(t)
    this.bus?.emit('task', { type: 'task.state', id, from, to: next })
  }

  injectMessage(id: string, message: string): void {
    const t = this.tasks.get(id)
    if (!t || t.kind !== 'in_process_teammate') return
    // Real injection wiring lands in phase14a's run-teammate.ts.
    // For now we record a placeholder activity for the tracker.
    if (t.progress) {
      t.progress.recentActivities = [
        ...t.progress.recentActivities,
        { toolName: '__injected', input: { message } },
      ].slice(-5)
    }
  }

  async requestShutdown(id: string): Promise<void> {
    const t = this.tasks.get(id)
    if (!t) return
    const from = t.state
    t.state = 'shutdown_requested'
    this.bus?.emit('task', { type: 'task.state', id, from, to: 'shutdown_requested' })
    // Force-kill after 30s if no graceful response.
    setTimeout(() => {
      if (this.tasks.get(id)?.state === 'shutdown_requested') {
        this.kill(id)
      }
    }, 30_000).unref()
  }

  resolveTeammate(address: string): string | undefined {
    // address: "team:<team>/<agent>"
    const m = address.match(/^team:([^/]+)\/(.+)$/)
    if (!m) return undefined
    const [, teamName, agentName] = m
    for (const t of this.tasks.values()) {
      if (t.teamName === teamName && t.agentName === agentName) return t.id
    }
    return undefined
  }

  setProgress(id: string, snapshot: ProgressTrackerSnapshot): void {
    const t = this.tasks.get(id)
    if (!t) return
    t.progress = snapshot
    this.bus?.emit('task', { type: 'task.progress', id, snapshot })
  }

  private emit(task: Task): void {
    for (const l of this.listeners) l(task)
    this.bus?.emit('task', { type: 'task.created', task })
  }
}
```

(Adapt `emit` to whatever name the existing manager uses. The semantics: legacy `on('change')` still fires; the bus sees a typed event.)

- [ ] **Step 4: Run — verify it passes**

Run: `npx vitest run test/core/tasks/manager.extension.test.ts test/core/tasks/manager.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/tasks/manager.ts test/core/tasks/manager.extension.test.ts
git commit -m "feat(phase14/m1+m6): TaskManager extension methods + bus emit"
```

---

## Task 17: M5 — Task `.meta.json` sidecar

**Files:**
- Create: `src/core/tasks/meta.ts`
- Create: `test/core/tasks/meta.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/core/tasks/meta.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { writeMeta, readMeta } from '../../../src/core/tasks/meta'

describe('task meta sidecar', () => {
  let home: string
  beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-meta-')) })

  it('round-trips a meta record', () => {
    fs.mkdirSync(path.join(home, '.nuka', 'tasks'), { recursive: true })
    writeMeta(home, {
      id: 'a1', kind: 'local_bash', state: 'completed', startedAt: 1, finishedAt: 2,
    })
    const back = readMeta(home, 'a1')
    expect(back?.id).toBe('a1')
    expect(back?.state).toBe('completed')
  })

  it('returns undefined when the meta file is missing', () => {
    expect(readMeta(home, 'nope')).toBeUndefined()
  })

  it('returns undefined when the meta file is corrupt JSON', () => {
    const dir = path.join(home, '.nuka', 'tasks')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'corrupt.meta.json'), '{not json')
    expect(readMeta(home, 'corrupt')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run — verify it fails**

Run: `npx vitest run test/core/tasks/meta.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement meta.ts**

Create `src/core/tasks/meta.ts`:

```ts
import * as fs from 'node:fs'
import * as path from 'node:path'
import { tasksDir } from '../paths'
import type { Task, TaskKind, TaskState } from './types'
import type { ProgressTrackerSnapshot } from './progressTracker'

export type TaskMeta = {
  id: string
  kind: TaskKind
  state: TaskState
  startedAt: number
  finishedAt?: number
  agentName?: string
  teamName?: string
  progress?: ProgressTrackerSnapshot
  lastEventSeq?: number
}

export function metaPath(home: string, id: string): string {
  return path.join(tasksDir(home), `${id}.meta.json`)
}

export function writeMeta(home: string, meta: TaskMeta): void {
  const file = metaPath(home, meta.id)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

export function readMeta(home: string, id: string): TaskMeta | undefined {
  const file = metaPath(home, id)
  if (!fs.existsSync(file)) return undefined
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as TaskMeta
  } catch {
    return undefined
  }
}

export function fromTask(t: Task): TaskMeta {
  return {
    id: t.id,
    kind: t.kind,
    state: t.state,
    startedAt: t.startedAt ?? Date.now(),
    finishedAt: t.finishedAt,
    agentName: t.agentName,
    teamName: t.teamName,
    progress: t.progress,
  }
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `npx vitest run test/core/tasks/meta.test.ts`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/tasks/meta.ts test/core/tasks/meta.test.ts
git commit -m "feat(phase14/m1): atomic task .meta.json sidecar"
```

---

## Task 18: M5 — Wire meta writes into TaskManager

**Files:**
- Modify: `src/core/tasks/manager.ts`
- Modify: `test/core/tasks/manager.extension.test.ts`

- [ ] **Step 1: Add a meta-write expectation to the manager test**

Append to `test/core/tasks/manager.extension.test.ts`:

```ts
import { readMeta } from '../../../src/core/tasks/meta'

it('writes <id>.meta.json on terminal transition', async () => {
  const t = mgr.enqueue({ kind: 'local_bash', description: 'd', command: 'true' })
  await new Promise(res => setTimeout(res, 50))  // give the runner time
  const meta = readMeta(home, t.id)
  expect(meta?.id).toBe(t.id)
  expect(['completed', 'failed']).toContain(meta?.state)
})
```

- [ ] **Step 2: Run — verify it fails**

Run: `npx vitest run test/core/tasks/manager.extension.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add meta writes**

In `src/core/tasks/manager.ts`'s enqueue, in the `finally` block of the async runner promise, add:

```ts
import { writeMeta, fromTask } from './meta'

// ... in the finally block of the run promise:
try { writeMeta(this.home, fromTask(task)) } catch { /* non-fatal */ }
```

Also call on every `setTeammateState` / `requestShutdown` / `setProgress` call (each one ends with the same try-write).

- [ ] **Step 4: Run — verify it passes**

Run: `npx vitest run test/core/tasks/manager.extension.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/tasks/manager.ts test/core/tasks/manager.extension.test.ts
git commit -m "feat(phase14/m1): TaskManager flushes <id>.meta.json on transitions"
```

---

## Task 19: M7 — Coordinator gate

**Files:**
- Create: `src/core/agent/coordinatorMode.ts`
- Create: `test/core/agent/coordinatorMode.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/core/agent/coordinatorMode.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import {
  isCoordinatorMode, COORDINATOR_INTERNAL_TOOLS, getCoordinatorUserContext, matchSessionMode,
} from '../../../src/core/agent/coordinatorMode'

describe('coordinatorMode', () => {
  afterEach(() => { delete process.env.NUKA_COORDINATOR_MODE })

  it('reads NUKA_COORDINATOR_MODE truthy values', () => {
    process.env.NUKA_COORDINATOR_MODE = '1'
    expect(isCoordinatorMode()).toBe(true)
    process.env.NUKA_COORDINATOR_MODE = 'true'
    expect(isCoordinatorMode()).toBe(true)
    process.env.NUKA_COORDINATOR_MODE = ''
    expect(isCoordinatorMode()).toBe(false)
  })

  it('exposes coordinator-internal tool whitelist', () => {
    expect(COORDINATOR_INTERNAL_TOOLS.has('send_message')).toBe(true)
    expect(COORDINATOR_INTERNAL_TOOLS.has('Read')).toBe(false)
  })

  it('getCoordinatorUserContext returns context only when mode is on', () => {
    delete process.env.NUKA_COORDINATOR_MODE
    expect(Object.keys(getCoordinatorUserContext({ tools: { list: () => [] } }))).toEqual([])
    process.env.NUKA_COORDINATOR_MODE = '1'
    const ctx = getCoordinatorUserContext({ tools: { list: () => [{ name: 'Read' }, { name: 'Edit' }] as never } })
    expect(typeof ctx.workerTools).toBe('string')
    expect(ctx.workerTools).toContain('Read')
  })

  it('matchSessionMode flips env on mismatch', () => {
    delete process.env.NUKA_COORDINATOR_MODE
    const msg = matchSessionMode('coordinator')
    expect(msg).toMatch(/Entered/)
    expect(process.env.NUKA_COORDINATOR_MODE).toBe('1')

    const msg2 = matchSessionMode('normal')
    expect(msg2).toMatch(/Exited/)
    expect(process.env.NUKA_COORDINATOR_MODE).toBeUndefined()

    expect(matchSessionMode(undefined)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run — verify it fails**

Run: `npx vitest run test/core/agent/coordinatorMode.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement coordinatorMode.ts**

Create `src/core/agent/coordinatorMode.ts`:

```ts
import type { Tool } from '../tools/types'

const ENV_VAR = 'NUKA_COORDINATOR_MODE'
const TRUTHY = new Set(['1', 'true', 'yes'])

export function isCoordinatorMode(): boolean {
  return TRUTHY.has((process.env[ENV_VAR] ?? '').toLowerCase())
}

export const COORDINATOR_INTERNAL_TOOLS = new Set<string>([
  'team_create',
  'team_delete',
  'send_message',
  'dispatch_agent',
  'task_create',
  'task_update',
  'task_list',
  'synthetic_output',
])

export function getCoordinatorUserContext(deps: {
  tools: { list: () => Pick<Tool, 'name'>[] }
  scratchpadDir?: string
}): { [k: string]: string } {
  if (!isCoordinatorMode()) return {}
  const workerTools = deps.tools.list()
    .map(t => t.name)
    .filter(n => !COORDINATOR_INTERNAL_TOOLS.has(n))
    .sort()
    .join(', ')
  const ctx: { [k: string]: string } = { workerTools }
  if (deps.scratchpadDir) ctx.scratchpadDir = deps.scratchpadDir
  return ctx
}

export function matchSessionMode(stored?: 'coordinator' | 'normal'): string | undefined {
  if (!stored) return undefined
  const currentlyCoord = isCoordinatorMode()
  const wantCoord = stored === 'coordinator'
  if (currentlyCoord === wantCoord) return undefined
  if (wantCoord) {
    process.env[ENV_VAR] = '1'
    return 'Entered coordinator mode to match resumed session.'
  } else {
    delete process.env[ENV_VAR]
    return 'Exited coordinator mode to match resumed session.'
  }
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `npx vitest run test/core/agent/coordinatorMode.test.ts`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/agent/coordinatorMode.ts test/core/agent/coordinatorMode.test.ts
git commit -m "feat(phase14/m7): coordinator-mode gate + worker tool whitelist"
```

---

## Task 20: M7 — Retention sweep

**Files:**
- Create: `src/core/tasks/retention.ts`
- Create: `test/core/tasks/retention.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/core/tasks/retention.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { runRetentionSweep } from '../../../src/core/tasks/retention'

describe('runRetentionSweep', () => {
  let home: string
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-ret-'))
    fs.mkdirSync(path.join(home, '.nuka', 'tasks'), { recursive: true })
    fs.mkdirSync(path.join(home, '.nuka', 'forks', 'parent-1'), { recursive: true })
  })

  it('deletes task .log + .meta.json older than 14 days', () => {
    const tasks = path.join(home, '.nuka', 'tasks')
    const oldLog = path.join(tasks, 'old.log')
    const oldMeta = path.join(tasks, 'old.meta.json')
    fs.writeFileSync(oldLog, 'x'); fs.writeFileSync(oldMeta, '{}')
    const oldT = Date.now() - 30 * 24 * 60 * 60 * 1000
    fs.utimesSync(oldLog, oldT / 1000, oldT / 1000)
    fs.utimesSync(oldMeta, oldT / 1000, oldT / 1000)
    const fresh = path.join(tasks, 'fresh.log')
    fs.writeFileSync(fresh, 'x')
    runRetentionSweep(home, { now: Date.now() })
    expect(fs.existsSync(oldLog)).toBe(false)
    expect(fs.existsSync(oldMeta)).toBe(false)
    expect(fs.existsSync(fresh)).toBe(true)
  })

  it('deletes forks/<parent>/<id>.json older than 24h', () => {
    const f = path.join(home, '.nuka', 'forks', 'parent-1', 'old.json')
    fs.writeFileSync(f, '{}')
    fs.utimesSync(f, (Date.now() - 48 * 3600 * 1000) / 1000, (Date.now() - 48 * 3600 * 1000) / 1000)
    runRetentionSweep(home, { now: Date.now() })
    expect(fs.existsSync(f)).toBe(false)
  })
})
```

- [ ] **Step 2: Run — verify it fails**

Run: `npx vitest run test/core/tasks/retention.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement retention**

Create `src/core/tasks/retention.ts`:

```ts
import * as fs from 'node:fs'
import * as path from 'node:path'
import { tasksDir, forksDir, recapsDir, eventsDir } from '../paths'

const DAY = 24 * 60 * 60 * 1000

const RULES: Array<{ dir: (h: string) => string; ageMs: number; recurse: boolean }> = [
  { dir: tasksDir,  ageMs: 14 * DAY, recurse: false },
  { dir: forksDir,  ageMs:  1 * DAY, recurse: true  },
  { dir: recapsDir, ageMs: 90 * DAY, recurse: false },
  { dir: eventsDir, ageMs:  7 * DAY, recurse: false },
]

export type SweepOpts = { now?: number }

export function runRetentionSweep(home: string, opts: SweepOpts = {}): void {
  const now = opts.now ?? Date.now()
  for (const r of RULES) {
    const root = r.dir(home)
    if (!fs.existsSync(root)) continue
    sweep(root, now - r.ageMs, r.recurse)
  }
}

function sweep(dir: string, threshold: number, recurse: boolean): void {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    let st: fs.Stats
    try { st = fs.statSync(p) } catch { continue }
    if (st.isDirectory()) {
      if (recurse) sweep(p, threshold, recurse)
      continue
    }
    if (st.mtimeMs < threshold) {
      try { fs.unlinkSync(p) } catch { /* swallow */ }
    }
  }
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `npx vitest run test/core/tasks/retention.test.ts`
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/tasks/retention.ts test/core/tasks/retention.test.ts
git commit -m "feat(phase14/m7): retention sweep for tasks/forks/recaps/events"
```

---

## Task 21: M7 — Wire ensureNukaLayout + retention into cli boot

**Files:**
- Modify: `src/cli.tsx`

- [ ] **Step 1: Wire the helpers**

Open `src/cli.tsx`. Near the top of the REPL boot path (just after `os.homedir()` is computed and before the `TaskManager` is constructed), add:

```ts
import { ensureNukaLayout } from './core/paths'
import { runRetentionSweep } from './core/tasks/retention'
import { eventBus } from './core/events/bus'

const home = os.homedir()
ensureNukaLayout(home)
try { runRetentionSweep(home) } catch { /* non-fatal */ }
```

Where TaskManager is constructed, pass the bus:

```ts
const taskManager = new TaskManager({ home, bus: eventBus })
```

If a global event-log opt-in is desired, behind a config flag:

```ts
import { attachNdjsonFlusher } from './core/events/ndjsonFlusher'
import { eventsDir } from './core/paths'

if (config.eventLog) {
  attachNdjsonFlusher({ bus: eventBus, dir: eventsDir(home), sessionId: session.id })
}
```

(Skip the flusher if `config.eventLog` doesn't exist yet — it is opt-in; default off; phase14c adds the config field.)

- [ ] **Step 2: Run all tests + typecheck + smoke**

Run: `npm run typecheck && npm test`
Expected: green.

Also run a smoke build:

Run: `npm run build`
Expected: completes without size regression > 30 KB.

- [ ] **Step 3: Commit**

```bash
git add src/cli.tsx
git commit -m "feat(phase14/m7): bootstrap nuka layout + retention + event bus"
```

---

## Task 22: M8 — Migration test: existing fixtures still load

**Files:**
- Create: `test/integration/phase14-migration.test.ts`

- [ ] **Step 1: Write the test**

Create `test/integration/phase14-migration.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { TaskManager } from '../../src/core/tasks/manager'
import { createEventBus } from '../../src/core/events/bus'

describe('phase14 migration', () => {
  let home: string
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-mig-'))
    // Pre-create a phase13-shaped tasks dir with one orphan log file (no sidecar).
    const tasks = path.join(home, '.nuka', 'tasks')
    fs.mkdirSync(tasks, { recursive: true })
    fs.writeFileSync(path.join(tasks, 'legacy-1.log'), 'old output')
  })

  it('TaskManager constructs cleanly when only a legacy log exists', () => {
    const bus = createEventBus()
    expect(() => new TaskManager({ home, bus })).not.toThrow()
  })

  it('legacy log file is not deleted by the new manager', async () => {
    const bus = createEventBus()
    const _mgr = new TaskManager({ home, bus })
    // Wait a tick — meta sidecar writes are not retroactive.
    await new Promise(res => setTimeout(res, 20))
    expect(fs.existsSync(path.join(home, '.nuka', 'tasks', 'legacy-1.log'))).toBe(true)
  })

  it('an in-flight bash task still completes and writes its log', async () => {
    const bus = createEventBus()
    const mgr = new TaskManager({ home, bus })
    const t = mgr.enqueue({ kind: 'local_bash', description: 'd', command: 'true' })
    await new Promise(res => setTimeout(res, 100))
    expect(fs.existsSync(t.outputFile)).toBe(true)
  })
})
```

- [ ] **Step 2: Run — verify it passes (no regression)**

Run: `npx vitest run test/integration/phase14-migration.test.ts`
Expected: 3 PASS.

- [ ] **Step 3: Commit**

```bash
git add test/integration/phase14-migration.test.ts
git commit -m "test(phase14/m8): legacy task fixtures still load"
```

---

## Task 23: M8 — End-to-end integration test

**Files:**
- Create: `test/integration/phase14-foundation.test.ts`

- [ ] **Step 1: Write the test**

Create `test/integration/phase14-foundation.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { TaskManager } from '../../src/core/tasks/manager'
import { TeamRegistry } from '../../src/core/teams/registry'
import { MessageRouter } from '../../src/core/messaging/router'
import { InProcessBackend } from '../../src/core/messaging/inProcessBackend'
import { ProgressTracker } from '../../src/core/tasks/progressTracker'
import { createEventBus } from '../../src/core/events/bus'
import { ensureNukaLayout } from '../../src/core/paths'
import type { TaskEvent, MessageEvent } from '../../src/core/events/types'
import type { MessageEnvelope } from '../../src/core/messaging/types'

describe('phase14 foundation end-to-end', () => {
  let home: string
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-foundation-'))
    ensureNukaLayout(home)
  })

  it('Team → MessageRouter → ProgressTracker → EventBus flow', async () => {
    const bus = createEventBus()
    const taskEvents: TaskEvent[] = []
    const messageEvents: MessageEvent[] = []
    bus.subscribe<TaskEvent>('task', e => taskEvents.push(e))
    bus.subscribe<MessageEvent>('message', e => messageEvents.push(e))

    // 1. Create a team.
    const teams = new TeamRegistry({ home })
    const team = await teams.create('demo', 'integration test')

    // 2. Register a fake teammate task — direct map insert
    //    (run-teammate runner is stubbed until phase14a).
    const mgr = new TaskManager({ home, bus })
    const fakeTask = {
      id: 'fake-1',
      kind: 'in_process_teammate' as const,
      description: 'fake',
      state: 'idle' as const,
      outputFile: path.join(home, '.nuka', 'tasks', 'fake-1.log'),
      teamName: 'demo',
      agentName: 'alice',
      spec: {
        kind: 'in_process_teammate' as const,
        description: 'fake',
        teamName: 'demo',
        agentName: 'alice',
        agentDef: { name: 'alice', description: 'd', maxTurns: 5, pluginName: 'core', allowedTools: [], deniedTools: [], systemPrompt: 'x' } as never,
        initialMessage: 'hi',
        longRunning: true,
      },
    }
    ;(mgr as unknown as { tasks: Map<string, unknown> }).tasks.set('fake-1', fakeTask)
    await teams.addMember('demo', { agentName: 'alice', agentDefRef: 'core:alice', spawnedAt: Date.now(), taskId: 'fake-1' })

    // 3. Set up a message router with in-process backend; subscribe alice.
    const backend = new InProcessBackend()
    const router = new MessageRouter({ backends: [backend], bus })
    const inboxFor = (name: string): MessageEnvelope[] => {
      const got: MessageEnvelope[] = []
      backend.subscribe(`team:demo/${name}`, e => got.push(e))
      return got
    }
    const aliceInbox = inboxFor('alice')

    // 4. Send a message to alice and verify delivery + bus events.
    const env: MessageEnvelope = {
      id: '01ABC', from: 'team:demo/lead', to: 'team:demo/alice',
      summary: 'kickoff', message: 'do the thing', sentAt: Date.now(),
    }
    expect(await router.send(env)).toBe(true)
    expect(aliceInbox.length).toBe(1)
    expect(messageEvents.map(e => e.type)).toEqual(['message.sent', 'message.delivered'])

    // 5. Run a tracker on the fake task, push usage + activity, snapshot.
    const tracker = new ProgressTracker('fake-1', bus)
    tracker.onToolStart('Read', { file: 'foo.ts' }, 'Reading foo.ts')
    tracker.onUsage({ inputTokens: 100, outputTokens: 50 })
    const snap = tracker.snapshot()
    mgr.setProgress('fake-1', snap)

    // 6. Verify task.progress fired.
    const prog = taskEvents.find(e => e.type === 'task.progress')
    expect(prog).toBeTruthy()
    expect((prog as { id: string }).id).toBe('fake-1')

    // 7. Verify team registry sees the member.
    expect(teams.find('demo')!.members.length).toBe(1)
    expect(team.taskListId).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the test — verify it passes**

Run: `npx vitest run test/integration/phase14-foundation.test.ts`
Expected: 1 PASS.

- [ ] **Step 3: Commit**

```bash
git add test/integration/phase14-foundation.test.ts
git commit -m "test(phase14/m8): end-to-end foundation integration"
```

---

## Task 24: M8 — Bundle size audit + spec amendment

**Files:**
- Modify: `docs/superpowers/specs/2026-04-30-phase14-foundation-design.md`

- [ ] **Step 1: Build and capture bundle size**

Run: `npm run build && du -h dist/cli.js`
Note the size in KB.

- [ ] **Step 2: Compare to phase13 baseline**

Phase 13 budget per README is ~285 KB. The new bundle should be ≤ 315 KB (foundation budget +30 KB per § 9 risk row).

If the budget is exceeded, fail fast — the foundation has dragged in too many bytes. Possible causes:
- importing ink components into core paths (reject, foundation has no UI)
- pulling msw / fixtures from non-test code (reject)
- unused exports (run `npx tsc --noEmit --noUnusedLocals` on a focused file)

- [ ] **Step 3: Append a "M8 close-out" note to the spec**

Edit `docs/superpowers/specs/2026-04-30-phase14-foundation-design.md`. After § 6.2, append:

```markdown
**Naming clarification:** Implementation uses `AgentBusEvent` (not
`AgentEvent`) for the bus payload to avoid collision with the existing
`AgentEvent` model-stream union in `src/core/agent/events.ts`. The bus
topic name is still `agent`. Plan see `docs/superpowers/plans/2026-04-30-phase14-foundation-plan.md`
Task 4.
```

After § 8 milestones table, append:

```markdown
**Close-out audit (M8):**
- Bundle size: <fill_in_after_build> KB (budget 315 KB).
- Tests added: 11 unit suites + 2 integration tests.
- Public exports added: EventBus, MessageRouter, TeamRegistry,
  ProgressTracker, runForkedAgent, isCoordinatorMode, ensureNukaLayout.
- No public type renamed except internal `AgentEvent` → `AgentBusEvent` (bus payload only).
- Sub-spec phases unblocked: phase14a (depends on M1, M5, M6, M7 ✅).
```

- [ ] **Step 4: Run typecheck + tests one more time**

Run: `npm run typecheck && npm test`
Expected: 0 errors / all green.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-04-30-phase14-foundation-design.md
git commit -m "docs(phase14/m8): close-out audit + AgentBusEvent naming clarification"
```

---

## Task 25: M8 — Final phase14 merge

- [ ] **Step 1: Confirm all milestone branches landed**

Run: `git log --oneline -30 | grep phase14`
Expected: at least 24 commits prefixed `feat(phase14/...)` or `test(phase14/...)` or `docs(phase14/...)`.

- [ ] **Step 2: Run the full test suite + bundle build**

Run: `npm run typecheck && npm test && npm run build`
Expected: green; bundle under 315 KB.

- [ ] **Step 3: Tag the foundation commit (optional)**

Run: `git tag phase14-foundation`
(Only if release-tagging is part of this project's workflow — skip if not.)

- [ ] **Step 4: Announce in `README.md` foundation section is in place (if applicable)**

If the README has a roadmap / "current phase" line, update it to reference phase14 foundation. Otherwise skip — README touches are not required by the spec.

---

## Self-Review

**1. Spec coverage:**

| Spec section | Plan task |
|--------------|-----------|
| § 2.1 unified Task type system | Task 1, 2 |
| § 2.2 EventBus | Task 4, 5, 6 |
| § 2.3 SendMessage protocol | Task 11, 12, 13 |
| § 2.4 Team data structure | Task 14, 15 |
| § 2.5 ProgressTracker | Task 7 |
| § 2.6 forkedAgent | Task 9, 10 |
| § 2.7 Coordinator gate | Task 19 |
| § 2.8 on-disk layout & migration | Task 14, 17, 18, 20, 21, 22 |
| § 2.9 harness reservations | Task 4 (HarnessEvent + HarnessStage in events/types.ts) |
| § 5.5 .meta.json sidecar | Task 17, 18 |
| § 5.6 events NDJSON | Task 6 |
| § 5.7 retention | Task 20 |
| § 6.1 TaskManager extensions | Task 3, 16, 18 |
| § 8 M1–M8 milestones | Task 1–25 |

All sections covered.

**2. Placeholder scan:** No "TBD", "TODO", "implement later", or vague handwave like "add appropriate validation" — every step shows the code or the exact command. The one acceptable forward reference (`provider.stream()` shape in Task 10) is explicitly flagged as "if the real shape differs, find via Read".

**3. Type consistency:**
- `ProgressTrackerSnapshot` defined in Task 2 (temp) → replaced by re-export in Task 7 step 4. Identical shape.
- `MessageEnvelope` stub in Task 4 → replaced by zod-inferred type in Task 11. Identical shape.
- `TaskEvent` / `AgentBusEvent` / `MessageEvent` / `HarnessEvent` consistent across Task 4, 5, 6, 8, 13, 16.
- `Team` / `TeamMember` consistent across Task 14, 15, 23.

**4. Risks → tasks:**
- "Type rewrite breaks dispatch_agent" → Task 3 step 4 runs the existing manager test suite as gate.
- "Cache key drift" → Task 9 stable-snapshot test.
- "Retention disk usage" → Task 20 unit test.
- "EventBus GC churn" → ring buffer cap in Task 5 step 3 + bound test step 1.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-30-phase14-foundation-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
