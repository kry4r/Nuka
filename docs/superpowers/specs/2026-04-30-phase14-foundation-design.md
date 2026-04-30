# Phase 14 — Foundation: shared infrastructure for swarm / monitor / recap / harness

**Date:** 2026-04-30
**Status:** Spec
**Author:** Brainstorming session 2026-04-30 (pre-phase14a/b/c/d)

## 1. Problem

Nuka's current swarm capability is thin compared to its reference (Claude Code, `/data/xtzhang/Nuka-Code`):

- `dispatch_agent` only supports a **single isolated sub-agent**. There are no named teammates, no inter-agent messaging, no shared task list, no cascade pipelines, no role-based collaboration.
- `tasks/manager.ts` only distinguishes `local_bash` / `local_agent`. There is no `in-process teammate` (AsyncLocalStorage isolation, idle/active state, plan-mode approval), no `local-shell` zoomed view, no `remote-agent`, no `dream` (background memory consolidation).
- The `Tasks` panel is read-only. There is no Tab focus, no `j/k` nav, no Enter into per-agent zoomed view, no message injection, no pause / resume / kill / approve.
- There is no `forkedAgent` utility — every fork pays the full prompt-cache miss cost.
- There is no `ProgressTracker` — sub-agents are black boxes (no token counts, no recent-activity rollup, no live "what is it doing" line).
- There is no `awaySummary` / `/recap` — long sessions and "user stepped away" moments have no recap surface.
- There is no workflow harness scaffolding inside Nuka itself — superpowers/trellis live as external plugins and default to TDD-first regardless of task profile, which the user explicitly flagged ("永远只是 TDD，缺少全局考虑").

The **root cause** is that all four upper subsystems (swarm enhancement, Monitor surface, `/recap`, workflow harness) need the **same set of shared primitives** — Task type system, EventBus, SendMessage protocol, Team data structure, ProgressTracker, forkedAgent, Coordinator gate, and a stable on-disk layout. Without locking those primitives down first, the four sub-specs will repeatedly mutate public data structures and create churn.

This spec is the **foundation** — phase14 base infrastructure. Subsequent phase14a/b/c/d sub-specs (swarm / monitor / recap / harness) build on top.

## 2. Goals

1. **Unified Task type system** — extend `tasks/types.ts` to a discriminated union of 5 subtypes (`local_bash` retained, `local_agent` retained; new: `in_process_teammate`, `local_shell`, `remote_agent`, `dream`). Public fields shared, subtype-specific fields nested.
2. **EventBus** — singleton in-process pub/sub for `TaskEvent` / `AgentEvent` / `MessageEvent`. Subscribers register with topic + optional filter; emitter is the TaskManager + AgentLoop + MessageRouter. This is the only path Monitor / Recap / Harness use to read live state.
3. **SendMessage protocol** — `MessageEnvelope` schema (Zod) + inbox/outbox per agent + a `MessageRouter` interface with three pluggable backends: `in-process` (this phase), `uds` (interface only, phase14a may implement), `bridge` (interface only, defer).
4. **Team data structure** — `Team = { name, description, taskListId, members, createdAt }`. 1:1 with `TaskList`. Persisted at `~/.nuka/teams/<name>/config.json`. CRUD is exposed via `TeamRegistry` (no UI yet).
5. **ProgressTracker** — port from CC. Per-task instance: `{ toolUseCount, latestInputTokens, cumulativeOutputTokens, recentActivities[], summary }`. Live activity descriptions reuse the `getToolSearchOrReadInfo` collapse rules from CC.
6. **forkedAgent utility** — port `runForkedAgent` + `CacheSafeParams` so background summary, autoDream, awaySummary and `/recap` share parent prompt cache.
7. **Coordinator gate** — define `isCoordinatorMode()` (env-var-gated), worker tool whitelist constant, and the `getCoordinatorUserContext()` helper. Type/data only this phase; UI/loop wiring lands in phase14b.
8. **On-disk layout & migration** — finalise `~/.nuka/{teams,tasks,recaps,forks,events}` layout, `.meta.json` sidecar for tasks, retention policy, and the additive migration path for existing `~/.nuka/tasks/<id>.log` files.
9. **Workflow harness reservations** — add the `harness` event topic and `Stage` enum stub (`brainstorm | spec | plan | search | implement | review | recap`) to the EventBus, so phase14d can attach without modifying core types.

## 3. Non-Goals

- ❌ No UI changes this phase. `CoordinatorTaskPanel`, `/monitor` dashboard, Tasks-panel interactivity, recap card — all deferred to phase14a/b/c.
- ❌ No `/recap` slash command implementation. Defer to phase14c.
- ❌ No workflow harness state machine, no editor-in-chief agent. Defer to phase14d. This phase only reserves the event/stage hooks.
- ❌ No actual UDS / bridge backend implementation. Only the `MessageRouter` interface and an in-process backend are written.
- ❌ No change to `dispatch_agent` recursion guard semantics (`session.allowedAgentDispatch = false` retained).
- ❌ No new provider, no model change, no Conversation rendering changes.
- ❌ Existing `Task` schema (`local_bash` / `local_agent` shape, `<id>.log` path) MUST keep loading; new `.meta.json` is optional, additive.

## 4. High-level architecture

```
              ┌────────────── Nuka REPL (App.tsx) ──────────────┐
   user ─►   ┌▼ Conversation │ Tasks │ Prompt │ Status (existing) ┐
              │                                                  │
              │   ┌──────────────────────────────────────────┐   │
              │   │            EventBus (§6.2)               │   │
              │   │  TaskEvent · AgentEvent · MessageEvent   │   │
              │   │  HarnessEvent (reserved §6.9)            │   │
              │   └─▲──────────────▲──────────────▲──────────┘   │
              │     │              │              │              │
              │  ┌──┴──────────┐ ┌─┴────────────┐ ┌┴─────────────┐│
              │  │ TaskManager │ │  AgentLoop   │ │ MessageRouter││
              │  │ (§6.1 ext.) │ │  (existing,  │ │  (§6.3, in-  ││
              │  │             │ │   emits ev.) │ │   process)   ││
              │  └──┬──────────┘ └──┬───────────┘ └──────────────┘│
              │     │               │                              │
              │  ┌──▼──────────┐ ┌──▼──────────┐ ┌──────────────┐ │
              │  │ Task types  │ │ ProgressTra-│ │ forkedAgent  │ │
              │  │ (§5.1)      │ │ cker (§6.5) │ │ (§6.6)       │ │
              │  └─────────────┘ └─────────────┘ └──────────────┘ │
              │                                                    │
              │  ┌────────── Team Registry (§6.4) ──────────────┐  │
              │  │  ~/.nuka/teams/<name>/config.json             │  │
              │  └───────────────────────────────────────────────┘  │
              │  ┌────────── Coordinator Gate (§6.7) ───────────┐  │
              │  │  isCoordinatorMode() + workerToolWhitelist  │  │
              │  └───────────────────────────────────────────────┘  │
              └────────────────────────────────────────────────────┘

   ~/.nuka/
     ├── teams/<name>/config.json        (Team config — §6.4)
     ├── tasks/<id>.log                  (existing, retained)
     ├── tasks/<id>.meta.json            (NEW: subtype + tracker snapshot — §5.4)
     ├── recaps/<YYYY-MM-DD>-<id>.md     (NEW: phase14c uses; dir created here)
     ├── forks/<parent>/<fork-id>.json   (NEW: forkedAgent CacheSafeParams cache)
     └── events/<session-id>.ndjson      (NEW: optional event log for /recap replay)
```

**Architectural invariants:**

- All upper components (swarm commands, Monitor panel, `/recap`, harness) read live state **only via EventBus**. Direct calls to `TaskManager` are limited to commands that mutate (create/kill).
- All cross-agent communication goes **only through MessageRouter**. No agent reaches into another agent's session.
- All forks of a parent agent go **only through forkedAgent**, so prompt-cache reuse is automatic and tracked.
- `Team` is a **namespace/identity wrapper**. The actual work-tracking primitive remains `TaskList` (already shipped). Team ↔ TaskList is 1:1 by `team.taskListId`.
- Coordinator gate is a **read-only check**. Tools that need it (e.g. `dispatch_agent` description rewriting) call `isCoordinatorMode()` at construction time, not per-call.

## 5. Data schemas

### 5.1 Task discriminated union

`src/core/tasks/types.ts` is rewritten to a 5-arm discriminated union. The two existing arms (`local_bash`, `local_agent`) keep their fields; three new arms are added:

```ts
export type TaskKind =
  | 'local_bash'
  | 'local_agent'
  | 'in_process_teammate'   // NEW
  | 'local_shell'           // NEW
  | 'remote_agent'          // NEW
  | 'dream'                 // NEW

export type TaskState =
  | 'pending'
  | 'running'
  | 'idle'                  // NEW: in-process teammate waiting for work
  | 'completed'
  | 'failed'
  | 'killed'
  | 'shutdown_requested'    // NEW: clean shutdown protocol in-flight

export type TaskSpec =
  | LocalBashSpec
  | LocalAgentSpec
  | InProcessTeammateSpec
  | LocalShellSpec
  | RemoteAgentSpec
  | DreamSpec

export type InProcessTeammateSpec = {
  kind: 'in_process_teammate'
  description: string
  teamName: string
  agentName: string         // human-addressable, unique within team
  agentDef: ResolvedAgentDef
  /** Initial user message that boots the teammate. */
  initialMessage: string
  /** When true, teammate goes idle after each turn instead of exiting. */
  longRunning: boolean
}

export type LocalShellSpec = {
  kind: 'local_shell'
  description: string
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  /** TTY-style: capture both stdout/stderr interleaved, expose for zoomed view. */
  pty: boolean
}

export type RemoteAgentSpec = {
  kind: 'remote_agent'
  description: string
  /** Opaque transport handle — bridge / UDS / HTTP, set by phase14b. */
  transport: { kind: string; addr: string }
  initialMessage: string
}

export type DreamSpec = {
  kind: 'dream'
  description: string
  /** Memory consolidation prompt; produced by phase14c autoDream. */
  consolidationPrompt: string
  parentSessionId: string
}

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
  // NEW shared fields:
  /** Teammate identity (unique within a team). Only set for in_process_teammate. */
  agentName?: string
  /** Owning team's qualified name. Set for in_process_teammate / remote_agent. */
  teamName?: string
  /** ProgressTracker snapshot — refreshed by AgentLoop. Optional for non-agent tasks. */
  progress?: ProgressTrackerSnapshot
  /** Eviction deadline for terminal tasks (ms epoch). Used by Monitor to fade rows. */
  evictAfter?: number
}
```

The two existing arms (`LocalBashSpec`, `LocalAgentSpec`) keep their current shape — additive change only.

### 5.2 ProgressTracker schema

```ts
export type ToolActivity = {
  toolName: string
  input: Record<string, unknown>
  /** Pre-computed by tool, e.g. "Reading src/foo.ts". */
  activityDescription?: string
  isSearch?: boolean
  isRead?: boolean
}

export type ProgressTrackerSnapshot = {
  toolUseCount: number
  latestInputTokens: number
  cumulativeOutputTokens: number
  recentActivities: ToolActivity[]   // capped at 5
  summary?: string                   // 3-5 word "what is it doing now"
}
```

### 5.3 MessageEnvelope schema

```ts
export const MessageEnvelopeSchema = z.object({
  /** ULID. */
  id: z.string(),
  /** Sender qualified address. Examples: "team:my-feature/researcher",
   *  "uds:/tmp/cc.sock", "bridge:session_01ABC...". */
  from: z.string(),
  /** Receiver qualified address, or "*" broadcast to all teammates. */
  to: z.string(),
  /** One-line subject; rendered in Monitor. */
  summary: z.string().min(1).max(200),
  /** Body — string, or structured protocol message (e.g. shutdown_request). */
  message: z.union([z.string(), ProtocolMessageSchema]),
  /** Required for *_request / *_response pairs. */
  request_id: z.string().optional(),
  sentAt: z.number(),  // ms epoch
})

export const ProtocolMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('shutdown_request'), request_id: z.string() }),
  z.object({ type: z.literal('shutdown_response'), request_id: z.string(), approve: z.boolean() }),
  z.object({ type: z.literal('plan_approval_request'), request_id: z.string(), plan: z.string() }),
  z.object({ type: z.literal('plan_approval_response'), request_id: z.string(), approve: z.boolean(), feedback: z.string().optional() }),
  z.object({ type: z.literal('handoff'), request_id: z.string(), nextStage: z.string(), payload: z.record(z.unknown()) }),
])
```

### 5.4 Team config schema

`~/.nuka/teams/<name>/config.json`:

```ts
export const TeamConfigSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  description: z.string(),
  taskListId: z.string(),               // matches TaskList namespace
  members: z.array(z.object({
    agentName: z.string(),
    agentDefRef: z.string(),            // qualified agent def name
    spawnedAt: z.number(),
    taskId: z.string().optional(),      // current Task.id if running
  })),
  createdAt: z.number(),
})
```

### 5.5 Task `.meta.json` sidecar

`~/.nuka/tasks/<id>.meta.json` (new, optional):

```ts
type TaskMeta = {
  id: string
  kind: TaskKind                  // for fast lookup w/o reading log
  state: TaskState
  startedAt: number
  finishedAt?: number
  agentName?: string
  teamName?: string
  /** Last tracker snapshot — written every 30s while running, on completion. */
  progress?: ProgressTrackerSnapshot
  /** Sequence number of the last event flushed to events/<session>.ndjson. */
  lastEventSeq?: number
}
```

The sidecar is **eventually consistent** — TaskManager flushes on state transitions plus a 5s coalescing timer. Loss of the sidecar is non-fatal; readers fall back to the .log file's prefix metadata header.

### 5.6 Event NDJSON schema

`~/.nuka/events/<session-id>.ndjson` (new, optional). Each line is one event:

```ts
type EventRecord =
  | { seq: number; t: number; topic: 'task'; payload: TaskEvent }
  | { seq: number; t: number; topic: 'agent'; payload: AgentEvent }
  | { seq: number; t: number; topic: 'message'; payload: MessageEvent }
  | { seq: number; t: number; topic: 'harness'; payload: HarnessEvent }
```

Used by phase14c `/recap` to replay/aggregate. Bounded by retention policy in §5.7. Off by default; opt-in via `~/.nuka/config.yaml` `eventLog: true`.

### 5.7 Retention

| File | Retention | Rotation |
|------|-----------|----------|
| `tasks/<id>.log` | 14 days from `finishedAt` | per-file delete |
| `tasks/<id>.meta.json` | 14 days from `finishedAt` | per-file delete |
| `teams/<name>/config.json` | until explicit `team_delete` | n/a |
| `recaps/<date>-<id>.md` | 90 days | per-file delete |
| `forks/<parent>/<fork-id>.json` | 24 hours | per-file delete on TTL |
| `events/<session>.ndjson` | 7 days OR > 50 MB → roll to `<session>.<n>.ndjson.gz` | size+age |

Retention sweep runs once per Nuka start (no daemon).

## 6. Component interface contracts

### 6.1 TaskManager extension (`src/core/tasks/manager.ts`)

Existing `enqueue(spec)` + `kill(id)` + `list()` + `on('change', cb)` API retained. Additions:

```ts
class TaskManager {
  // existing API …

  /** Subscribe to typed events. Topic-scoped — no fanout to listeners
   *  that don't care. Returns an unsubscribe handle. */
  subscribe(topic: 'task', cb: (e: TaskEvent) => void): () => void
  subscribe(topic: 'agent', cb: (e: AgentEvent) => void): () => void

  /** Atomically transition a teammate task between idle ↔ running. */
  setTeammateState(id: string, next: 'idle' | 'running'): void

  /** Inject a user message into a running/idle teammate's pending queue. */
  injectMessage(id: string, message: string): void

  /** Request graceful shutdown — emits shutdown_request via MessageRouter,
   *  task transitions to 'shutdown_requested' until the teammate responds
   *  or 30s elapses (then forced kill). */
  requestShutdown(id: string): Promise<void>

  /** Look up the canonical teammate id by qualified address
   *  ("team:<team>/<agent>"). Returns undefined if not found. */
  resolveTeammate(address: string): string | undefined

  /** Snapshot writer — called by AgentLoop every 30s and on terminal
   *  transitions. */
  setProgress(id: string, snapshot: ProgressTrackerSnapshot): void
}
```

Internal: `enqueue` runners are now selected by `spec.kind` switch. New runners (`run-teammate.ts`, `run-shell.ts`, `run-remote-agent.ts`, `run-dream.ts`) stub-implemented with the **minimum** needed to compile + pass type checks; full bodies are written in phase14a/c. The runners must emit `task` events for every state transition.

### 6.2 EventBus (`src/core/events/bus.ts` — NEW file)

Single-process pub/sub. No persistence inside the bus — that is `events/<session>.ndjson`'s job, written by an opt-in flusher subscriber.

```ts
export type TaskEvent =
  | { type: 'task.created'; task: Task }
  | { type: 'task.state'; id: string; from: TaskState; to: TaskState }
  | { type: 'task.progress'; id: string; snapshot: ProgressTrackerSnapshot }
  | { type: 'task.evicted'; id: string }

export type AgentEvent =
  | { type: 'agent.tool.start'; sessionId: string; toolName: string; input: unknown }
  | { type: 'agent.tool.end'; sessionId: string; toolName: string; ok: boolean; durationMs: number }
  | { type: 'agent.message.assistant'; sessionId: string; text: string }
  | { type: 'agent.usage'; sessionId: string; inputTokens: number; outputTokens: number }

export type MessageEvent =
  | { type: 'message.sent'; envelope: MessageEnvelope }
  | { type: 'message.delivered'; envelopeId: string; to: string }
  | { type: 'message.failed'; envelopeId: string; reason: string }

export type HarnessEvent =
  | { type: 'harness.stage.enter'; stage: HarnessStage; sessionId: string }
  | { type: 'harness.stage.exit'; stage: HarnessStage; sessionId: string; reason: string }
  | { type: 'harness.editor.directive'; sessionId: string; directive: string }

export interface EventBus {
  emit(topic: 'task', e: TaskEvent): void
  emit(topic: 'agent', e: AgentEvent): void
  emit(topic: 'message', e: MessageEvent): void
  emit(topic: 'harness', e: HarnessEvent): void
  subscribe<T>(topic: Topic, cb: (e: T) => void, filter?: (e: T) => boolean): () => void
  /** Replay last N events of a topic (in-memory ring buffer, 1024 entries). */
  replay<T>(topic: Topic, n: number): T[]
}

export const eventBus: EventBus = createEventBus()  // module-singleton
```

Ring buffer is **lossy** by design — Recap reads from `events/*.ndjson` (durable), Monitor reads from ring (live + cheap).

### 6.3 MessageRouter (`src/core/messaging/router.ts` — NEW file)

```ts
export interface MessageBackend {
  /** Backend identifier. */
  readonly kind: 'in-process' | 'uds' | 'bridge'
  /** Send envelope. Returns true on accepted (queued); false if recipient
   *  is unknown or the backend is unable to deliver. */
  send(envelope: MessageEnvelope): Promise<boolean>
  /** Subscribe to inbound messages addressed to `localAddress`. */
  subscribe(localAddress: string, cb: (e: MessageEnvelope) => void): () => void
}

export class MessageRouter {
  constructor(deps: { backends: MessageBackend[]; bus: EventBus }) { … }

  /** Route based on `to` address scheme — first matching backend wins. */
  send(envelope: MessageEnvelope): Promise<boolean>

  /** Inbox for a single agent — backed by the matching backend. */
  inbox(localAddress: string): {
    subscribe(cb: (e: MessageEnvelope) => void): () => void
    pending(): MessageEnvelope[]
    drain(): MessageEnvelope[]
  }

  /** Broadcast to all teammates of a given team. */
  broadcast(teamName: string, envelope: Omit<MessageEnvelope, 'to'>): Promise<number>
}
```

This phase ships only `InProcessBackend` (a `Map<address, EventEmitter>`). UDS and bridge backends are out-of-scope but the interface is fixed so phase14a can drop them in.

### 6.4 TeamRegistry (`src/core/teams/registry.ts` — NEW file)

```ts
export class TeamRegistry {
  constructor(opts: { home: string }) { … }

  /** Create a team + matching TaskList. Throws if name exists. */
  async create(name: string, description: string): Promise<Team>

  /** Atomically remove team config + (optionally) tear down its task list. */
  async delete(name: string, opts?: { keepTasks?: boolean }): Promise<void>

  /** Find by qualified name. */
  find(name: string): Team | undefined

  list(): Team[]

  /** Add a member (e.g. when a teammate is spawned). Persists to disk. */
  addMember(name: string, member: TeamMember): Promise<void>
  removeMember(name: string, agentName: string): Promise<void>

  /** Subscribe to team-roster changes. */
  subscribe(cb: (team: Team) => void): () => void
}
```

The registry calls `TaskListManager` (existing) for the underlying TaskList CRUD — Team is a thin namespace layer on top.

### 6.5 ProgressTracker (`src/core/tasks/progressTracker.ts` — NEW file)

```ts
export class ProgressTracker {
  constructor(taskId: string, bus: EventBus) { … }

  /** Called by AgentLoop on every tool start. */
  onToolStart(toolName: string, input: unknown, activityDescription?: string): void

  /** Called by AgentLoop on every assistant turn with usage. */
  onUsage(usage: { inputTokens: number; outputTokens: number }): void

  /** Called by AgentSummary timer with the freshly generated 3-5 word line. */
  setSummary(summary: string): void

  snapshot(): ProgressTrackerSnapshot
}
```

`recentActivities` is capped at 5 with `getToolSearchOrReadInfo` collapse rules ported verbatim from CC. Snapshots are emitted as `task.progress` events; the AgentLoop hooks call into it once per tool invocation.

### 6.6 forkedAgent (`src/core/agent/forkedAgent.ts` — NEW file)

```ts
export type CacheSafeParams = {
  systemPrompt: string
  tools: Tool[]              // kept for cache-key parity, denied via canUseTool
  modelParams: { model: string; thinkingConfig?: unknown; maxTokens?: number }
  forkContextMessages: Message[]
}

export function createCacheSafeParams(opts: {
  parentSession: Session
  registry: ToolRegistry
}): CacheSafeParams

export async function runForkedAgent(opts: {
  params: CacheSafeParams
  prompt: string
  signal: AbortSignal
  /** Tools are denied to forks unless the callback approves them. Default deny-all. */
  canUseTool?: (toolName: string) => boolean
  providerResolver: ProviderResolver
}): Promise<{ text: string; usage: TokenUsage }>
```

Forks reuse parent prompt-cache by **keeping the tool list in the request** (cache-key parity) but denying actual tool calls via `canUseTool`. This pattern is taken from `Nuka-Code/src/utils/forkedAgent.ts` and `services/AgentSummary/agentSummary.ts`.

Cached params are written to `~/.nuka/forks/<parent-session>/<fork-id>.json` so retries of `/recap` etc. don't recompute the prefix.

### 6.7 Coordinator gate (`src/core/agent/coordinatorMode.ts` — NEW file)

```ts
const NUKA_COORDINATOR_MODE = 'NUKA_COORDINATOR_MODE'

export function isCoordinatorMode(): boolean {
  return ['1', 'true', 'yes'].includes(process.env[NUKA_COORDINATOR_MODE] ?? '')
}

export const COORDINATOR_INTERNAL_TOOLS = new Set([
  'team_create', 'team_delete', 'send_message',
  'dispatch_agent', 'task_create', 'task_update', 'task_list',
  'synthetic_output',
])

export const WORKER_ALLOWED_TOOLS = new Set([
  // full toolbox, minus coordinator-internal ones
])

export function getCoordinatorUserContext(deps: {
  tools: ToolRegistry
  scratchpadDir?: string
}): { [k: string]: string }

export function matchSessionMode(stored?: 'coordinator' | 'normal'): string | undefined
```

Behaviour mirrors `Nuka-Code/src/coordinator/coordinatorMode.ts`. This phase only ships the gate types & helpers — wiring into the agent loop's tool-filter is in phase14b.

### 6.8 Directory bootstrapping (`src/core/paths.ts` — extend)

Add helpers for the four new directories. Each helper is sync + idempotent:

```ts
export function teamsDir(home: string): string
export function recapsDir(home: string): string
export function forksDir(home: string): string
export function eventsDir(home: string): string

export function ensureNukaLayout(home: string): void  // creates all 6 dirs
```

Called at REPL boot (`cli.tsx` → bootstrap). On `ENOSPC` it logs a warning and continues (consistent with phase13's `02e8b5e` graceful handling).

### 6.9 Harness reservations

Stage enum + topic registration only — no logic yet.

```ts
export type HarnessStage =
  | 'brainstorm' | 'spec' | 'plan' | 'search'
  | 'implement' | 'review' | 'recap'

// Already enumerated in §6.2 HarnessEvent.
// EventBus must accept topic 'harness' even though no emitter exists yet
// in this phase — phase14d will wire emitters.
```

## 7. Testing strategy

Foundation work is type-heavy and event-heavy; tests are unit-level for the seven new modules plus a thin integration harness:

| Area | Test type | Coverage targets |
|------|-----------|------------------|
| Task type union | type-only `*.test-d.ts` (vitest expect-type) | Each subtype is exhaustively narrowable; legacy specs still type-check |
| TaskManager extensions | unit + fake clock | state-machine transitions for `idle ↔ running`, `shutdown_requested → killed` (30s timeout), `injectMessage` queues correctly |
| EventBus | unit | emit/subscribe/replay; filter rejects mismatched events; ring buffer respects 1024 cap |
| MessageRouter | unit + fake backend | in-process delivery; `*` broadcast hits N subscribers; unknown address returns `false`; backends are tried in registration order |
| TeamRegistry | unit + tmpdir | CRUD round-trips through disk; `addMember` is atomic on crash mid-write (fsync on rename) |
| ProgressTracker | unit | recentActivities capped at 5; collapse rules flatten consecutive Read/Grep activities; usage accumulates correctly (input = latest, output = sum) |
| forkedAgent | unit + msw mock | CacheSafeParams build is deterministic; `canUseTool` deny propagates as a tool-error to the model, not an exception |
| coordinatorMode | unit | env var parsing; `getCoordinatorUserContext` produces the expected fields when toggled |
| Paths | unit + tmpdir | `ensureNukaLayout` creates all 6 dirs; ENOSPC swallowed |
| Migration | integration | An existing `~/.nuka/tasks/<id>.log` (no sidecar) loads as `local_bash`/`local_agent` with empty `progress` |

Plus one **integration test**: spawn a fake `in_process_teammate`, route a `SendMessage` to it, observe the resulting `MessageEvent`s flow through EventBus, verify `ProgressTracker` snapshot is updated and `task.progress` event fires.

CI gate: `npm run typecheck && npm test` must stay green; bundle size budget unchanged (foundation adds < 30 KB to the 285 KB bundle target).

## 8. Milestones & phase14a/b/c/d boundaries

**phase14 (this spec) milestones — all foundation, no UI:**

| M | Subject | Deliverable | Touches |
|---|---------|-------------|---------|
| M1 | Task type union + Task state additions | `tasks/types.ts` rewrite; legacy `enqueue` paths unchanged; type tests | `core/tasks/types.ts`, `core/tasks/manager.ts` (switch only) |
| M2 | EventBus | `core/events/bus.ts`; ring buffer; topics + replay | new module |
| M3 | ProgressTracker + AgentLoop hooks | `core/tasks/progressTracker.ts`; AgentLoop emits `agent.tool.*` + `agent.usage` | `core/agent/loop.ts`, new module |
| M4 | forkedAgent | `core/agent/forkedAgent.ts`; CacheSafeParams; integration test against msw | new module |
| M5 | MessageRouter (in-process) + envelope schema | `core/messaging/router.ts`, `core/messaging/types.ts`, in-process backend | new modules |
| M6 | TeamRegistry + on-disk Team config | `core/teams/registry.ts`; `~/.nuka/teams/` layout; CRUD | new module + paths |
| M7 | Coordinator gate + paths/retention | `core/agent/coordinatorMode.ts`; `core/paths.ts` extension; retention sweep on boot | new module |
| M8 | Migration verification & bundle audit | run full phase13 test suite; load existing tasks; bundle-size check; doctor reports | tests + scripts |

Each M is one PR / one branch. M1–M2 are blocking (everything else depends on them); M3–M7 can land in parallel; M8 is the close-out.

**Sub-spec boundaries (locked by this foundation):**

- **phase14a — Swarm** (depends on M1, M5, M6, M7): `team_create` / `team_delete` / `send_message` tools; `in_process_teammate` runner full body; cascade pipeline primitives (`handoff` protocol); role collaboration (multi-role default agent defs); coordinator-mode wiring into AgentLoop tool-filter.
- **phase14b — Monitor** (depends on M1–M3): Tasks panel multi-column extension (Plan / Subagents / Backgrounds / Pipeline / Messages); Tab focus + j/k + Enter zoomed view; per-Task interaction (inject message / pause / kill / approve plan-mode); `/monitor` full-screen dashboard with DAG / timeline / token tabs.
- **phase14c — Recap** (depends on M2, M4): `/recap` command (9 fields: completed tasks, in-progress/failed, file diffs by agent, tool timeline, swarm message digest, pipeline node states, token/cost, next-step suggestion via small fast model, key decisions); auto away-summary card with idle-detection trigger; `~/.nuka/recaps/<date>.md` persistence; autoDream background consolidation.
- **phase14d — Workflow harness** (depends on M2, plus phase14a/c primitives): stage state machine (Brainstorm → Spec → Plan → Search/Verify → Implement → Review → Recap, hard gates); editor-in-chief agent (持有 spec / 项目记忆 / 各 worker 产出，决定派工 / 审稿 / 打回 / 进下一阶段); per-stage default skill bundles; sequential-thinking + multi-search + ask_user enforced inside each stage; fast-path bypass via env/flag.

## 9. Risks & rollbacks

| Risk | Likelihood | Mitigation | Rollback |
|------|------------|------------|----------|
| Task type union rewrite breaks existing `dispatch_agent` / `tasks` panel | Medium | Phase 1 of M1 is type-only; legacy specs verified via `*.test-d.ts`; integration test loads existing fixtures | Revert M1 commit; legacy types retained as backup at `tasks/types.legacy.ts` for 1 phase |
| EventBus becomes a hot path / GC churn | Low | Ring buffer caps memory; emit is sync only (no microtask hops); `replay` reads array slice | Replace with no-op bus; subscribers degrade to "show last seen" cached state |
| MessageRouter in-process backend leaks subscriptions on agent crash | Medium | Each spawn registers a `cleanupRegistry` hook; integration test simulates abrupt SIGKILL | Periodic GC sweep; address subscriptions older than 1h with no Task pointer are dropped |
| ProgressTracker token math drifts (input is cumulative, output is per-turn) | Medium | Verbatim port of CC's `latestInputTokens` + `cumulativeOutputTokens` separation; unit tests cover three turns of accumulation | Disable token rendering; revert to "tokens: ?" placeholder |
| forkedAgent cache key changes and silently breaks cache reuse | High | Snapshot test on the canonical CacheSafeParams produced for a fixture session; `forks/*.json` includes a hash header | Disable forking; fall back to fresh-prompt small-fast-model calls |
| Coordinator env-var clashes with another tool | Low | Variable name `NUKA_COORDINATOR_MODE` is product-prefixed; `matchSessionMode` only flips on resume of a session that was recorded as coordinator | n/a — read-only feature |
| New dirs balloon disk usage on long-running workstations | Medium | Retention table in §5.7; sweep at boot; hard cap on `events/*.ndjson` (50 MB rollover) | Manual `rm -rf ~/.nuka/{forks,events,recaps}` is safe — none are load-bearing for sessions |
| Sub-spec phases drift from foundation contracts (e.g. phase14b adds a Task field) | Medium | This spec is the single source of truth; sub-specs MUST cite the section they extend; field additions require a foundation amendment commit, not a ad-hoc patch | Amend foundation spec + bump it (`phase14.1`) before sub-spec PR lands |

## 10. Open questions (deferred to sub-specs)

These are intentionally not resolved here — each is owned by the matching sub-spec:

1. UDS / bridge backends — implemented in phase14a or deferred entirely?
2. Coordinator-mode default UI affordance — slash-command toggle, env var only, or auto-on for any team-created session? (phase14b)
3. `/recap --since` semantics — wall clock, message count, or last user-input boundary? (phase14c)
4. Editor-in-chief default model — same as user model, smaller faster model, or per-stage configurable? (phase14d)
5. Stage skipping — should `fast-path` allow skipping `Search`, or only `Brainstorm`/`Spec`? (phase14d)

---

**Spec self-review checklist (run inline before commit):**

- ✅ No "TBD" / "TODO" / placeholder text in normative sections (§§ 1–8)
- ✅ Architecture diagram (§4) is consistent with component contracts (§6)
- ✅ Each non-goal in §3 is explicitly NOT covered by any milestone in §8
- ✅ Each goal in §2 maps 1:1 to a §6 contract section
- ✅ Each schema in §5 is referenced by at least one §6 contract
- ✅ Risks (§9) cover the highest-risk items (type rewrite, cache-key drift)
- ✅ Sub-spec boundaries (§8) explicitly list what they own and what they depend on
- ✅ "Open questions" (§10) are intentionally deferred, not normative omissions
