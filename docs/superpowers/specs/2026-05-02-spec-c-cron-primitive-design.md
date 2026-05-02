# Spec C — Cron primitive: in-process scheduler, decoupled from remote

**Date:** 2026-05-02
**Status:** Spec
**Depends on:** `2026-04-30-phase14-foundation-design.md` (EventBus, Task type union, on-disk layout, retention sweep, ensureNukaLayout), `2026-04-30-phase14c-recap-design.md` (idle watcher will be migrated onto cron jobs)
**Related siblings:** `2026-05-02-spec-a-finish-the-promise-design.md`, `2026-05-02-spec-b-modernize-core-design.md`, `2026-05-02-spec-d-provider-expansion-design.md`, `2026-05-02-spec-e-context-audit-design.md`
**Author:** Brainstorming session 2026-05-02

## 1. Problem

Nuka has no first-class scheduling primitive. Every recurring or deferred behaviour today is implemented as a one-off timer somewhere in the boot path or in a single feature module:

- **Idle re-engagement** lives in `src/core/recap/idleWatcher.ts:8` as a hand-rolled `setTimeout` loop that knows about a single threshold and a single callback pair. There is no way to register a *second* idle-driven side effect without duplicating that file.
- **autoDream** (`src/core/recap/autoDream.ts`, referenced by phase14c §6.5) installs a 30-minute interval at `cli.tsx` boot. The 30-minute number is hard-coded; the gate condition (`hoursSinceLast ≥ 6 AND newSessions ≥ 3`) is wired in-line; nothing surfaces it to the user.
- **Retention sweep** runs once at boot (`paths.ts:16`, foundation §5.7). There is no opt-in to "run again every 12 hours while Nuka stays open."
- **TUI cost-tracker** persists at session shutdown only — there is no "every 5 minutes flush" guard against crash loss.
- **Workflow harness** (phase14d) needs to fire stage advancement on a schedule (`/harness review` should auto-prompt after N minutes of stalled status).

Beyond Nuka's internal needs, **the user explicitly asked for cron-style external triggers** (brainstorm 2026-05-02): *"我想要 Nuka 能定时帮我跑事情，比如每天早上 8 点拉日报。"* Reference projects (`Nuka-Code/src/tools/ScheduleCronTool/`) already ship a `Schedule.cron` tool family, and Anthropic's Managed Agents have a backend "trigger" concept; Nuka has neither.

The historical reflex is to bolt this onto the in-flight remote/app-server work. **The user explicitly forbade that coupling**: *"cron 不与 remote 功能耦合 — 我希望它在本地、在 Nuka 进程里、不要依赖任何后端就能用"*. So this spec defines a **bottom-layer in-process subsystem** under `src/core/cron/` that:

1. Has zero network or app-server dependencies.
2. Exposes equal-power surfaces to the user (TUI slash + settings submenu) and to the model (two new tools).
3. Subsumes the existing idle watcher and autoDream gate as *pre-built cron jobs*, so feature-specific scheduling code is replaced by configuration.
4. Reserves a clean extension point for a future `RemoteTrigger` channel without committing to it now.

This spec is **decoupled from any remote work**. The future remote-trigger channel will bridge to this primitive, not the other way around.

## 2. Goals

1. **In-process cron engine** at `src/core/cron/` with a single timer driven by a min-heap keyed on `nextRunAt`. No daemon, no fork, no IPC — Nuka must be running for jobs to fire (stated limitation).
2. **CronJob model** with three schedule shapes (cron expression, fixed interval, one-shot) and four action shapes (`inject_user_message`, `run_slash`, `spawn_task`, `fire_event`), persisted under `~/.nuka/cron/jobs.json` (Zod-validated, atomic write).
3. **Symmetric surfaces**:
   - **TUI**: `/cron` slash with subcommands (`list | add | remove | run-now | pause | resume | show <id> | enable <id> | disable <id> | defaults`) and a settings submenu (`tui/Submenu/CronSubmenu.tsx`) that browses jobs in a table.
   - **Model tools**: `ScheduleCronTool` (register/list/cancel) and `AskUserQuestionTool` (pause loop and ask user) — both ship in this spec because both depend on the same "pause-loop-and-ping-TUI" primitive.
4. **Trigger dispatch with three runtime states**:
   - **active session**: dispatch action via `App.tsx` reducer / TaskManager directly.
   - **idle REPL** (no in-flight turn): pre-queue and surface on the next user input with a banner.
   - **Nuka not running**: nothing fires (limitation; documented).
5. **Permission gate**: registering a job whose `action` is destructive (e.g. `run_slash` invoking a write-class command) requires user approval via the existing `PermissionChecker`. The model never silently arms a destructive recurring job.
6. **EventBus integration**: emit `cron.scheduled | cron.fired | cron.completed | cron.failed | cron.cancelled | cron.paused | cron.resumed` events on the existing `cron` topic (added to the EventBus in this spec; foundation §6.2 lists topic registration as additive).
7. **Idle watcher migration**: the existing `core/recap/idleWatcher.ts` becomes a pre-built cron job seeded by `/cron defaults` on first run. autoDream becomes a second pre-built job. Hand-rolled timers in those modules are deleted.
8. **Reserved extension point**: schema includes a documented-but-rejected action kind `external_trigger`. Engine validates and refuses it with a clear error so the future remote-trigger spec has a stable hook.
9. **Boot semantics**: on Nuka start — load jobs, recompute `nextRunAt` for each, drop overdue cron-expression jobs (next match is in the future), but **fire** overdue one-shot jobs flagged `runOnMissed: true`. On Nuka stop — persist `lastRunAt` and the current state of every job.
10. **Conflict policy**: when two jobs fire at the exact same `nextRunAt`, dispatch in deterministic order by `job.id` ASCII sort. When the same job is mid-run and the next tick fires, the second tick is **dropped** with a `cron.failed` event tagged `reason:'overlapping'` (cron jobs are not reentrant). Engine guarantees at most one in-flight execution per job.

## 3. Non-Goals

- ❌ **No daemon / no out-of-process scheduling.** Jobs fire only while Nuka is running. This is a limitation, not a bug; future work may add a sidecar daemon.
- ❌ **No remote / network integration.** No HTTP listener, no IM adapter, no webhook receiver. The `external_trigger` action kind is reserved schema-only and explicitly rejected at runtime.
- ❌ **No DAG scheduling, no job dependencies.** A job either fires or it doesn't; there is no "job B depends on job A having completed today." Workflow harness (phase14d) handles dependencies separately.
- ❌ **No per-user multi-tenant cron.** Jobs live in a single per-user `~/.nuka/cron/jobs.json`. There is no team-scoped cron in this spec (reserved for phase14a swarm follow-up).
- ❌ **No cron expression beyond standard 5-field UNIX cron.** No `@yearly` / `@hourly` macros (model can compute the equivalent expression), no 6-field seconds-cron, no quartz extensions.
- ❌ **No timezone-rich scheduling.** All cron expressions are evaluated in the host's local timezone; no per-job TZ override. Documented and surfaced in `/cron list`.
- ❌ **No replacement of `setInterval` callers that are unrelated to user-visible behaviour** (e.g. the EventBus ring-buffer flush, the LSP keepalive). Only the three call sites in §1 (idle watcher, autoDream, retention) migrate.
- ❌ **No backfill of missed cron-expression matches.** If Nuka was off from 2am to 6am and a job is scheduled for 3am daily, that 3am fire is *lost*. Only `runOnMissed: true` one-shot jobs catch up.
- ❌ **No `AskUserQuestionTool` rich previews / multi-select / annotations.** This spec ships the minimum: `{ question, options?, defaultIndex?, timeoutMs? }`. Richer schemas (preview, multi-select, annotations from the CC `AskUserQuestionTool.tsx`) are out-of-scope.

## 4. High-level architecture

```
                  ┌─────────────────────── Nuka REPL (App.tsx) ───────────────────────┐
                  │                                                                    │
   user ──input──►│   ┌─Conversation─┐ ┌─Tasks─┐ ┌─Prompt─┐ ┌─Status─┐                 │
                  │   └──────────────┘ └───────┘ └────────┘ └────────┘                 │
                  │                                                                    │
                  │   ┌─/cron slash──┐         ┌──Submenu (settings → cron)──┐         │
                  │   │ subcommand   │         │  table view + edit dialogs   │         │
                  │   │ parser       │         │  (CronSubmenu.tsx)           │         │
                  │   └──────┬───────┘         └────────────┬─────────────────┘         │
                  │          │                              │                           │
                  │   ┌──────▼──────────────────────────────▼─────────────────────┐    │
                  │   │                  CronEngine (§6.1)                        │    │
                  │   │  ─ in-memory min-heap of {jobId, nextRunAt}              │    │
                  │   │  ─ single setTimeout to next head                         │    │
                  │   │  ─ dispatcher: jobId → action.kind switch                 │    │
                  │   │  ─ EventBus emitter (topic 'cron')                        │    │
                  │   └──┬─────┬───────────────┬───────────────┬─────────────┬────┘    │
                  │      │     │               │               │             │         │
                  │      │     │               │               │             │         │
                  │  ┌───▼───┐ │   ┌───────────▼─────────┐ ┌───▼─────┐ ┌─────▼──────┐  │
                  │  │ Store │ │   │  ActionDispatcher    │ │ Parser  │ │ Permission │  │
                  │  │ (§6.2)│ │   │  (§6.3 — 4 handlers) │ │ (§6.4)  │ │ gate (§6.5)│  │
                  │  │ atomic│ │   │  inject_user_message │ │  cron   │ │ checker    │  │
                  │  │ jobs  │ │   │  run_slash           │ │  expr   │ │ for risky  │  │
                  │  │ .json │ │   │  spawn_task          │ │  → next │ │ actions    │  │
                  │  └───┬───┘ │   │  fire_event          │ └─────────┘ └────────────┘  │
                  │      │     │   └──────────────────────┘                              │
                  │      │     │                                                         │
                  │      │  ┌──▼──────────────────── EventBus (topic 'cron') ─────────┐  │
                  │      │  │  cron.scheduled / fired / completed / failed /          │  │
                  │      │  │  cancelled / paused / resumed                           │  │
                  │      │  └────────────────▲──────────────▲──────────────▲──────────┘  │
                  │      │                   │              │              │             │
                  │      │             Monitor panel    /recap         ndjsonFlusher     │
                  │      │             (phase14b)       reducer        (foundation)      │
                  │      │                                                               │
                  │   ┌──▼─────────────────────────────────────────────────────────────┐ │
                  │   │  Tools registered with ToolRegistry (model-callable)            │ │
                  │   │   • ScheduleCronTool (§6.6) — register/list/cancel              │ │
                  │   │   • AskUserQuestionTool (§6.7) — pause loop, surface dialog     │ │
                  │   │   Both share PauseAndPing primitive (§6.8)                      │ │
                  │   └──────────────────────────────────────────────────────────────────┘ │
                  └────────────────────────────────────────────────────────────────────────┘

   On disk:
     ~/.nuka/cron/
       jobs.json                ← persisted CronJob[] (Zod-validated, atomic rename)
       jobs.json.tmp            ← write-then-rename staging file
       runs/<job-id>.ndjson     ← optional run history (last 50 runs/job)
```

**Architectural invariants:**

- **Decoupling from remote**: `src/core/cron/` imports nothing from any remote/transport package. Foundation is the only allowed cross-package import (EventBus, paths, TaskManager, PermissionChecker).
- **Single timer**: the engine schedules at most one `setTimeout` at a time, pointing at the next-due job. After fire, the heap re-heapifies and a new `setTimeout` is set. No per-job timers.
- **One in-flight per job**: a `Set<JobId>` of currently-executing jobs gates dispatch. Re-entry while running emits `cron.failed{reason:'overlapping'}`.
- **Permission at registration**, not fire: when a job is registered with a destructive action, the user approves *once*; subsequent fires reuse the approval. This matches `PermissionChecker.cache.add(rule)` semantics.
- **Pre-built jobs are owned by the system, not the user**: the idle-recap job and autoDream job have `owner.kind = 'plugin'` with `pluginId = 'nuka-builtin'`; user can `disable` but not `remove` them. `/cron defaults` regenerates them if missing.

## 5. Data schemas

### 5.1 CronJob (Zod)

```ts
// src/core/cron/types.ts

import { z } from 'zod'

export const CronJobIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{2,63}$/)

export const CronScheduleSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('cron'),
    /** Standard 5-field cron expression: M H DoM Mon DoW. Local timezone. */
    expr: z.string().min(9).max(60),
  }),
  z.object({
    type: z.literal('interval'),
    /** Fixed interval in milliseconds. Minimum 5_000. */
    everyMs: z.number().int().min(5_000).max(7 * 24 * 3600 * 1000),
  }),
  z.object({
    type: z.literal('one_shot'),
    /** Fire exactly once at this UNIX ms timestamp. */
    atMs: z.number().int().positive(),
    /** If Nuka was off when this should have fired, fire immediately on next start. */
    runOnMissed: z.boolean().default(false),
  }),
])

export type CronSchedule = z.infer<typeof CronScheduleSchema>

export const CronActionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('inject_user_message'),
    /** Text injected as if the user had typed it. ≤ 4_000 chars. */
    text: z.string().min(1).max(4_000),
  }),
  z.object({
    kind: z.literal('run_slash'),
    /** Full slash command, leading slash optional. e.g. "/recap --since 1h". */
    command: z.string().min(2).max(500),
  }),
  z.object({
    kind: z.literal('spawn_task'),
    /** Forwarded to TaskManager.enqueue. The taskSpec is a TaskSpec from
     *  src/core/tasks/types.ts; only `local_bash` and `local_agent` are
     *  permitted here. Other kinds (in_process_teammate, dream, …) are
     *  rejected at registration with 'task_kind_not_permitted'. */
    taskSpec: z.unknown(),  // narrowed at validation time
  }),
  z.object({
    kind: z.literal('fire_event'),
    /** Custom user-defined event topic; emitted as bus.emit('cron', { type:'cron.user', topic, payload }). */
    topic: z.string().regex(/^[a-z][a-z0-9_.-]*$/).max(64),
    payload: z.unknown(),
  }),
  // Reserved schema-only — engine rejects with 'reserved_for_future_spec'.
  z.object({
    kind: z.literal('external_trigger'),
    note: z.string().optional(),
  }),
])

export type CronAction = z.infer<typeof CronActionSchema>

export const CronOwnerSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('tui'),
    registeredAt: z.number().int(),
  }),
  z.object({
    kind: z.literal('tool'),
    toolName: z.string(),
    sessionId: z.string(),
  }),
  z.object({
    kind: z.literal('plugin'),
    pluginId: z.string(),
  }),
])

export type CronOwner = z.infer<typeof CronOwnerSchema>

export const CronStateSchema = z.enum([
  'enabled',          // active, will fire at nextRunAt
  'paused',           // user paused; nextRunAt frozen until resume
  'disabled',         // pre-built job that user explicitly disabled
  'expired',          // one-shot job that already fired
  'errored',          // last 3 fires all failed; engine quarantines
])

export type CronJobState = z.infer<typeof CronStateSchema>

export const CronRunRecordSchema = z.object({
  firedAt: z.number().int(),
  completedAt: z.number().int().optional(),
  status: z.enum(['ok', 'failed', 'overlapping', 'permission_denied', 'dispatch_error']),
  error: z.string().optional(),
  /** ms duration; absent when overlapping/permission_denied. */
  durationMs: z.number().int().optional(),
})

export type CronRunRecord = z.infer<typeof CronRunRecordSchema>

export const CronJobSchema = z.object({
  id: CronJobIdSchema,
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  schedule: CronScheduleSchema,
  action: CronActionSchema,
  owner: CronOwnerSchema,
  state: CronStateSchema,
  createdAt: z.number().int(),
  /** Last successful or failed fire (ms epoch). undefined until first fire. */
  lastRunAt: z.number().int().optional(),
  /** Next scheduled fire (ms epoch). undefined for `paused`/`expired`/`errored`. */
  nextRunAt: z.number().int().optional(),
  /** Bounded ring; last 50 runs. */
  runHistory: z.array(CronRunRecordSchema).max(50).default([]),
  /** Tags for filtering in /cron list. */
  tags: z.array(z.string()).max(8).default([]),
})

export type CronJob = z.infer<typeof CronJobSchema>

export const CronJobsFileSchema = z.object({
  version: z.literal(1),
  jobs: z.array(CronJobSchema),
  updatedAt: z.number().int(),
})

export type CronJobsFile = z.infer<typeof CronJobsFileSchema>
```

### 5.2 CronEvent (EventBus payload)

The foundation EventBus already accepts a `cron` topic in this spec. Add to `src/core/events/types.ts`:

```ts
export type CronEvent =
  | { type: 'cron.scheduled'; jobId: string; nextRunAt: number }
  | { type: 'cron.fired';     jobId: string; firedAt: number; action: CronAction['kind'] }
  | { type: 'cron.completed'; jobId: string; firedAt: number; durationMs: number }
  | { type: 'cron.failed';    jobId: string; firedAt: number; reason: string; error?: string }
  | { type: 'cron.cancelled'; jobId: string; cancelledBy: 'user' | 'tool' | 'system' }
  | { type: 'cron.paused';    jobId: string }
  | { type: 'cron.resumed';   jobId: string; nextRunAt: number }
  | { type: 'cron.user';      jobId: string; topic: string; payload: unknown }
```

`Topic` union in `events/types.ts` is extended:

```ts
export type Topic = 'task' | 'agent' | 'message' | 'harness' | 'cron'
```

### 5.3 On-disk layout

```
~/.nuka/cron/
  jobs.json                 ← CronJobsFile (Zod). Atomic write via .tmp + rename.
  jobs.json.tmp             ← staging for atomic rename
  runs/<job-id>.ndjson      ← optional, per-job run-history rotation; one CronRunRecord per line
                              created lazily on first run; bounded by 50 lines (rolls oldest)
```

Retention: jobs.json never expires (user-owned). `runs/<id>.ndjson` is swept by foundation retention (older than 14 days) at boot. New entry in foundation §5.7 retention table covers `cron/runs/`.

Migration: legacy on-disk timers (none currently) — N/A. Pre-built jobs are seeded on first boot by `ensureCronDefaults(home)` if no `jobs.json` exists; if it exists, defaults are merged additively (only missing pre-built ids are added).

### 5.4 Pre-built defaults

```ts
const DEFAULT_JOBS: CronJob[] = [
  {
    id: 'idle-recap',
    name: 'Idle re-engagement summary',
    description: 'When you return after 5+ minutes idle, fork a small fast model to summarise what we were doing.',
    schedule: { type: 'interval', everyMs: 60_000 },  // checked once a minute; the *action* gates on idleness
    action: { kind: 'fire_event', topic: 'recap.idle.tick', payload: {} },
    owner: { kind: 'plugin', pluginId: 'nuka-builtin' },
    state: 'enabled',
    createdAt: 0,
    runHistory: [],
    tags: ['builtin', 'recap'],
  },
  {
    id: 'auto-dream',
    name: 'Background memory consolidation',
    description: 'Every 30 minutes, check if memdir consolidation gates are met; if so, spawn a dream task.',
    schedule: { type: 'interval', everyMs: 30 * 60_000 },
    action: { kind: 'fire_event', topic: 'recap.autodream.tick', payload: {} },
    owner: { kind: 'plugin', pluginId: 'nuka-builtin' },
    state: 'enabled',
    createdAt: 0,
    runHistory: [],
    tags: ['builtin', 'recap', 'dream'],
  },
]
```

Both pre-builts use `fire_event` rather than `run_slash` so the gating logic (idle threshold, dream gates) stays in `core/recap/*` modules — cron just provides the heartbeat.

## 6. Component contracts

### 6.1 CronEngine — `src/core/cron/engine.ts` (new)

```ts
export interface CronEngineDeps {
  home: string
  bus: EventBus                        // foundation §6.2
  permission: PermissionChecker        // §6.5 wired here
  taskManager?: TaskManager            // optional; required only for spawn_task
  /** App-side dispatcher; provided by cli.tsx wire-up. Returns { ok } or {error}. */
  dispatch: ActionDispatcher           // §6.3
  clock?: () => number                 // injectable for tests; defaults Date.now
  parser?: CronParser                  // §6.4; defaults to built-in
}

export class CronEngine {
  constructor(deps: CronEngineDeps)

  /** Boot: load jobs from disk, recompute nextRunAt, fire overdue one-shots
   *  marked runOnMissed, schedule first timer. Idempotent. */
  start(): Promise<void>

  /** Persist current state to disk; clear active timer; refuse new schedules. */
  stop(): Promise<void>

  /** Register a new job. Validates, applies permission gate for risky
   *  actions, persists, recomputes nextRunAt, re-arms timer. */
  add(job: Omit<CronJob, 'id' | 'createdAt' | 'state' | 'runHistory' | 'nextRunAt'> & { id?: string }): Promise<CronJob>

  /** Cancel + remove. Pre-built jobs reject with 'cannot_remove_builtin'. */
  remove(id: string, by: 'user' | 'tool' | 'system'): Promise<void>

  pause(id: string): Promise<void>
  resume(id: string): Promise<void>
  /** Pre-built only — non-pre-built jobs treat disable like remove. */
  disable(id: string): Promise<void>
  enable(id: string): Promise<void>

  /** Fire immediately (out-of-band) without affecting the schedule. */
  runNow(id: string): Promise<void>

  list(filter?: { tag?: string; ownerKind?: CronOwner['kind']; state?: CronJobState }): CronJob[]
  get(id: string): CronJob | undefined

  /** Subscribe to engine-internal change events (used by Submenu). Distinct
   *  from EventBus topic 'cron' which is fire/lifecycle only. */
  onChange(cb: (snapshot: CronJob[]) => void): () => void
}
```

**Internal state machine per job:**

```
   add(job)                 enable()              fire OK
  ┌─────────►[ enabled ]◄─────────────[ disabled ]──┐
  │             │                                    │
  │             │ pause()                            │
  │             ▼                                    │
  │         [ paused ]──resume()──► [ enabled ]      │
  │             │                                    │
  │   3 failures in a row (auto)                     │
  │             ▼                                    │
  │         [ errored ]                              │
  │                                                  │
  │   one_shot fired (auto)                          │
  │             ▼                                    │
  └─────►[ expired ]                                 │
                                                     │
  remove() from any state ─────────► (job deleted) ──┘
```

**Tick algorithm (single timer):**

```
  loop:
    head = heap.peek()
    if head == null: clear timer; return
    delay = head.nextRunAt - now()
    if delay > 0: setTimeout(fire, delay); return

    fire:
      job = head
      heap.pop()
      if !inFlight.has(job.id):
        inFlight.add(job.id)
        bus.emit('cron', { type:'cron.fired', jobId:job.id, firedAt:now(), action:job.action.kind })
        try { await dispatch(job.action, job) ; bus.emit('completed') }
        catch e { bus.emit('failed') }
        finally { inFlight.delete(job.id) }
      else:
        bus.emit('cron', { type:'cron.failed', jobId, reason:'overlapping' })

      if job.schedule.type === 'cron' || 'interval':
        job.nextRunAt = parser.next(job.schedule, now())
        heap.push(job)
      else:  // one_shot
        job.state = 'expired'
        — drop from heap
      persist (debounced 5s)
      goto loop
```

### 6.2 CronStore — `src/core/cron/store.ts` (new)

```ts
export class CronStore {
  constructor(private home: string)

  async load(): Promise<CronJobsFile>             // creates file with empty jobs[] if missing
  async save(file: CronJobsFile): Promise<void>   // atomic: write to .tmp, fsync, rename

  /** Append a run record to runs/<id>.ndjson; rotate at 50 lines (oldest dropped). */
  async appendRun(jobId: string, rec: CronRunRecord): Promise<void>
  async readRuns(jobId: string): Promise<CronRunRecord[]>
}
```

Atomic write follows existing pattern in `src/core/cost/persist.ts`: write to `<file>.tmp`, `fsync`, `rename`. On parse failure, file is moved to `<file>.corrupt-<ts>` and a fresh empty jobs file is written.

### 6.3 ActionDispatcher — `src/core/cron/dispatcher.ts` (new)

```ts
export type DispatchContext = {
  /** App reducer hook used by inject_user_message and run_slash. */
  pushUserInput: (text: string) => void
  /** Slash registry for run_slash. */
  slash: SlashRegistry
  slashCtx: SlashContext
  taskManager?: TaskManager
  bus: EventBus
  /** Pre-queue path: when no active session, store and surface on next input. */
  queueForNext: (banner: string, body: string) => void
  /** True iff there is no in-flight assistant turn AND no pending modal. */
  isReplIdle: () => boolean
}

export type ActionDispatcher = (action: CronAction, job: CronJob) => Promise<void>

export function makeActionDispatcher(ctx: DispatchContext): ActionDispatcher
```

Per `action.kind`:

| kind | active session | idle REPL (no in-flight turn) |
|------|----------------|-------------------------------|
| `inject_user_message` | call `pushUserInput(text)` — App reducer treats it as user input | same; banner shown in conversation header |
| `run_slash` | parse + run via `slash.find(...).run(args, slashCtx)` | same; result rendered as system notice |
| `spawn_task` | `taskManager.enqueue(spec)` after kind whitelist | same |
| `fire_event` | `bus.emit('cron', { type:'cron.user', jobId, topic, payload })` | same |
| `external_trigger` | reject: throw `Error('reserved_for_future_spec')` | same |

If `taskManager` is undefined and action is `spawn_task`, fail with `'task_manager_unavailable'`.

### 6.4 Cron parser — `src/core/cron/parser.ts` (new)

**Recommendation: vendor a small implementation rather than add a dependency.**

Survey:
- `cron-parser` (npm): 11 KB minified+gz, robust, MIT, but adds a runtime dep with its own changelog cadence.
- `node-cron`: schedules + parser entangled; not what we want.
- Hand-rolled: 5-field UNIX cron is ~120 LOC including ranges (`1-5`), lists (`1,3,5`), steps (`*/5`), and `,`-combined fields. No DST math because nextRunAt resolution is 1-minute and our tick algorithm re-checks via the parser.

**Decision: hand-rolled.** Bundle budget (foundation §8 close-out 312 KB; phase14a/b/c added ~120 KB with budget cap 450 KB) is tight; a vendored ~5 KB parser fits. We mirror the cron syntax `node-cron` accepts for user familiarity but document the supported subset:

- Five fields: `minute hour day-of-month month day-of-week` (0-based DoW; Sun=0).
- `*` matches all.
- `n` matches the literal value.
- `n-m` matches the inclusive range.
- `*/k` matches every `k` units from the field minimum.
- `n,m,o` matches any listed value (combinable with ranges and steps, e.g. `0,15,30,45`).
- Months and DoW accept their numeric form only (no `JAN` / `MON`).

```ts
export interface CronParser {
  parse(expr: string): CronAst | null
  next(schedule: CronSchedule, fromMs: number): number     // returns nextRunAt
  describe(expr: string): string                            // e.g. "every 5 minutes"
}

export const builtinParser: CronParser
```

`describe` powers `/cron list` and `/cron show <id>` ("every 5 minutes", "at 8:00 AM", "Sun, Mon, Wed at 09:30").

### 6.5 Permission gate

CronEngine.add() classifies the action and consults the existing `PermissionChecker`:

```ts
function classify(action: CronAction): { hint: PermissionHint; annotations: { destructive?: boolean; openWorld?: boolean } } {
  switch (action.kind) {
    case 'fire_event':
    case 'inject_user_message':
      return { hint: 'allow', annotations: {} }              // benign
    case 'run_slash':
      // Lookup the slash; if its impl has destructive annotation OR matches
      // a deny-list (/clear /new /exit /compact), prompt user.
      return { hint: 'ask', annotations: { destructive: true } }
    case 'spawn_task':
      // local_bash with arbitrary command is destructive; local_agent is ask.
      return action.taskSpec?.kind === 'local_bash'
        ? { hint: 'ask', annotations: { destructive: true } }
        : { hint: 'ask', annotations: {} }
    case 'external_trigger':
      throw new Error('reserved_for_future_spec')
  }
}
```

The `PermissionChecker.check()` call uses a synthetic `toolName: 'cron:add'`. If allowed with `remember: { scope: 'session' }`, subsequent `add()` calls for the same action class skip the prompt. Pre-built defaults bypass the gate entirely (their action kind is `fire_event`, classified benign).

### 6.6 ScheduleCronTool — `src/core/tools/builtin/scheduleCron.ts` (new)

A Nuka-shaped tool (uses `define.ts` builder, registered in `cli.tsx`). Adapted from `Nuka-Code/src/tools/ScheduleCronTool/CronCreateTool.ts:56` but rewritten to Nuka's tool DI (no global `getTeammateContext`, no `bootstrap/state`).

```ts
export const ScheduleCronTool = defineTool({
  name: 'ScheduleCron',
  description: 'Schedule a recurring or one-shot action. Schedule format: 5-field cron expression OR { type:"interval", everyMs } OR { type:"one_shot", atMs }.',
  inputSchema: z.discriminatedUnion('op', [
    z.object({
      op: z.literal('add'),
      name: z.string().min(1).max(80),
      schedule: CronScheduleSchema,
      action: CronActionSchema,
      tags: z.array(z.string()).max(8).optional(),
    }),
    z.object({ op: z.literal('list'), tag: z.string().optional() }),
    z.object({ op: z.literal('cancel'), id: CronJobIdSchema }),
  ]),
  annotations: { readOnly: false, destructive: false, openWorld: false },
  async run({ input }, ctx): Promise<ToolResult> {
    const engine = ctx.cron!
    if (input.op === 'add') {
      const job = await engine.add({
        name: input.name,
        schedule: input.schedule,
        action: input.action,
        owner: { kind: 'tool', toolName: 'ScheduleCron', sessionId: ctx.session.id },
        tags: input.tags ?? [],
      })
      return ok({ jobId: job.id, nextRunAt: job.nextRunAt })
    }
    if (input.op === 'list') {
      return ok({ jobs: engine.list({ tag: input.tag }).map(toolView) })
    }
    if (input.op === 'cancel') {
      await engine.remove(input.id, 'tool')
      return ok({ ok: true })
    }
  },
})
```

Tool surface notes:
- **One tool, three ops** (vs CC's `CronCreate / CronList / CronDelete` triple). Reduces tool-count in the model's manifest.
- `ctx.cron` is plumbed through ToolRunCtx (new optional field `cron?: CronEngine`).
- Permission prompts surface to the user from the engine, not the tool, so the tool's own annotation stays `destructive: false`.
- Maximum jobs registered by tool calls: **20 per session** (separate quota from TUI-registered jobs, which has no cap). Prevents an agent runaway from filling the heap.

### 6.7 AskUserQuestionTool — `src/core/tools/builtin/askUserQuestion.ts` (new)

Bundled in this spec because it depends on the same "pause-loop-and-ping-TUI" primitive cron uses (action `inject_user_message` paths through the same App reducer hook). Adapted from `Nuka-Code/src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx:62` but minimised:

```ts
export const AskUserQuestionTool = defineTool({
  name: 'AskUserQuestion',
  description: 'Pause the agent loop and ask the user a multiple-choice question. Returns the chosen option index and label.',
  inputSchema: z.object({
    question: z.string().min(1).max(2_000),
    options: z.array(z.string().min(1).max(120)).min(2).max(4).optional(),
    /** When options is omitted, the user types a free-text answer. */
    defaultIndex: z.number().int().min(0).max(3).optional(),
    /** Auto-resolve to defaultIndex (or empty string for free-text) after timeoutMs. 0 = no timeout. */
    timeoutMs: z.number().int().min(0).max(10 * 60_000).default(0),
  }),
  annotations: { readOnly: true, destructive: false, openWorld: false, requiresUserInteraction: true },
  async run({ input, signal }, ctx): Promise<ToolResult> {
    const r = await ctx.askUser!.question(input, signal)   // pause-loop primitive §6.8
    return ok({ answer: r.answer, viaTimeout: r.viaTimeout, optionIndex: r.optionIndex })
  },
})
```

### 6.8 PauseAndPing primitive — `src/core/agent/pauseAndPing.ts` (new)

The shared mechanism that lets a tool inside an agent loop block on a TUI dialog:

```ts
export interface PauseAndPing {
  /** Open a question dialog; return when user picks (or timeout). */
  question(input: { question: string; options?: string[]; defaultIndex?: number; timeoutMs?: number }, signal: AbortSignal): Promise<{ answer: string; optionIndex?: number; viaTimeout: boolean }>
}

export function createPauseAndPing(deps: {
  /** App.tsx exposes a setter that pushes a dialog descriptor. */
  setDialog: (d: DialogDescriptor) => void
  /** And a clear hook. */
  clearDialog: () => void
  /** Receives user answer events from the dialog component. */
  onAnswer: (cb: (answer: { value: string; optionIndex?: number }) => void) => () => void
}): PauseAndPing
```

This is the same primitive that `cron action.kind = 'inject_user_message'` uses — both ask the App reducer to *do something with the user surface*. Implementation lives in `core/agent/` (not `core/cron/`) because it's loop-scoped (cron just borrows it).

DialogDescriptor union (in `slash/types.ts`) extended:

```ts
| { kind: 'ask-question'; question: string; options?: string[]; defaultIndex?: number; timeoutMs?: number; resolveId: string }
```

`resolveId` is a ULID minted by `createPauseAndPing` so the App reducer can correlate the answer back to the awaiting tool call.

### 6.9 TUI surfaces

#### 6.9.1 `/cron` slash — `src/slash/cron.ts` (new)

```ts
export const CronCommand: SlashCommand = {
  name: 'cron',
  description: 'Manage scheduled jobs (list / add / remove / pause / resume / show / run-now / defaults)',
  usage: '/cron <list|add|remove|pause|resume|enable|disable|show|run-now|defaults> [args]',
  args: [{
    name: 'subcommand',
    choices: ['list', 'add', 'remove', 'pause', 'resume', 'enable', 'disable', 'show', 'run-now', 'defaults'],
  }],
  examples: [
    '/cron list',
    '/cron list --tag recap',
    '/cron add "morning standup" "0 9 * * 1-5" run_slash:"/recap --since 24h"',
    '/cron remove morning-standup',
    '/cron run-now idle-recap',
  ],
  async run(args, ctx) { /* dispatches to engine */ },
}
```

When `/cron` is called bare (no args), it returns `{ type:'dialog', dialog:{ kind:'cron-submenu' } }` (new DialogDescriptor case).

#### 6.9.2 CronSubmenu — `src/tui/Submenu/CronSubmenu.tsx` (new)

Table view with columns: `id | name | schedule (humanized) | next | last | state`. Keyboard:

- `j/k` move row
- `Enter` opens job-detail view (history, action, owner)
- `p` pause / resume
- `r` run now
- `d` delete (with confirm) — pre-built jobs grayed out
- `a` add (opens AddJobDialog with schedule + action wizards)
- `Esc` close submenu

Add-job dialog mirrors the `ScheduleCronTool` schema; permission prompt fires inline as a confirm step before persistence.

#### 6.9.3 Status / Tasks panel header

Optional one-line header in Tasks panel: `"next cron: idle-recap in 12s"` — wired by `tasksPanel.tsx` subscribing to `bus.replay('cron', 1)` and rendering a relative-time line. Off by default; surfaced when `config.cron.showInTasksPanel: true`.

### 6.10 Settings submenu integration

`src/tui/Submenu/settings/` already has a slot for sub-pages; add a "Cron" entry that opens `CronSubmenu`. Wired through `slash/settings.ts` which already routes `kind:'settings'` dialogs.

## 7. Testing strategy

| Area | Test type | Coverage |
|------|-----------|----------|
| Schema (Zod) | unit | round-trip; invalid expr / out-of-range interval / external_trigger schema accepted, runtime rejects |
| Parser | unit | each cron syntax form (`*`, `n`, `n-m`, `*/k`, lists); cross-month rollover; cross-year rollover; DST-skip days (March/Nov 2026) |
| Parser describe() | snapshot | golden strings for representative expressions |
| CronStore | unit + tmpdir | atomic write under simulated mid-write crash; corrupt-file recovery; ndjson append rolls at 50 |
| CronEngine — add | unit | nextRunAt computed; permission gate consulted for risky actions; tool-quota cap enforced (21st add fails) |
| CronEngine — fire | unit + fake clock | min-heap order; overlap-protect drops second fire; cron schedule re-heaps; one_shot expires |
| CronEngine — pause/resume | unit | nextRunAt frozen; resume recomputes from now |
| CronEngine — boot semantics | unit + fake clock | overdue cron drops to next match; overdue one_shot+runOnMissed fires immediately; lastRunAt persisted after stop() |
| CronEngine — errored gate | unit | 3 consecutive failures → state 'errored' → no longer scheduled |
| ActionDispatcher | unit per kind | inject_user_message hits pushUserInput; run_slash invokes registry; spawn_task delegates; fire_event emits; external_trigger throws |
| Permission classify | unit | run_slash classified ask; local_bash spawn classified ask+destructive; fire_event allow |
| /cron slash | integration with fake App | each subcommand round-trips; bare /cron returns submenu dialog |
| ScheduleCronTool | integration with fake engine | add/list/cancel ops; tool quota enforced; permission prompt surfaces |
| AskUserQuestionTool | integration with fake setDialog | dialog opened; answer resolves; timeout resolves with viaTimeout=true |
| PauseAndPing primitive | unit + fake clock | resolveId correlation; second concurrent question rejects with 'busy' |
| CronSubmenu | ink-testing-library | renders all jobs; j/k navigation; pause/resume keys; Esc closes |
| Idle-recap migration | integration | startIdleWatcher is replaced by a CronJob; recap.idle.tick fires every minute; fork only fires when idle≥threshold |
| autoDream migration | integration | recap.autodream.tick fires every 30m; gates evaluated; lock acquired/released |
| EventBus emissions | unit | each lifecycle path emits the documented event with correct fields |

CI gate: `npm run typecheck && npm test`. Bundle delta budget: cron + 2 tools + parser + submenu ≤ 18 KB minified+gz (current 312 KB → 330 KB ceiling).

**Fake clock pattern:** `clock` is injected into `CronEngine`, `CronStore.appendRun` (timestamp), and the parser. Tests use `vi.useFakeTimers()` for `setTimeout` advancement plus a `clockSpy` returning a controllable `now()`.

**Fixture jobs file:** `test/fixtures/cron/jobs.json` carries 8 jobs covering each schedule × action combination plus an `errored` job and an `expired` one-shot for boot-load coverage.

## 8. Milestones

| M | Subject | Files | LOC | Tests |
|---|---------|-------|-----|-------|
| M1 | Schema + parser | `core/cron/types.ts`, `core/cron/parser.ts`, `core/events/types.ts` (extend Topic + CronEvent) | ~340 | parser, schema |
| M2 | CronStore | `core/cron/store.ts`, `core/paths.ts` (cronDir helper) | ~180 | store + retention |
| M3 | CronEngine core | `core/cron/engine.ts`, `core/cron/heap.ts` | ~520 | engine state machine, fake clock |
| M4 | ActionDispatcher | `core/cron/dispatcher.ts`, `core/cron/permission.ts` | ~240 | per-kind dispatch, classify |
| M5 | ScheduleCronTool + tool quota | `core/tools/builtin/scheduleCron.ts`, ToolRunCtx extension | ~190 | tool ops + quota |
| M6 | PauseAndPing + AskUserQuestionTool | `core/agent/pauseAndPing.ts`, `core/tools/builtin/askUserQuestion.ts`, `slash/types.ts` (DialogDescriptor) | ~260 | dialog correlation, timeout |
| M7 | /cron slash + CronSubmenu | `slash/cron.ts`, `tui/Submenu/CronSubmenu.tsx` | ~410 | slash subcommands, ink-test |
| M8 | Boot wiring + pre-built defaults | `cli.tsx` (engine bootstrap), `core/cron/defaults.ts`, `core/recap/idleWatcher.ts` (delete legacy timer; subscribe to recap.idle.tick), `core/recap/autoDream.ts` (subscribe to recap.autodream.tick) | ~220 | migration integration |
| M9 | Settings submenu integration + Tasks panel header line | `tui/Submenu/settings/index.tsx`, `tui/Tasks/TasksPanel.tsx` | ~90 | snapshot |
| M10 | Close-out: bundle audit, docs, retention table update | spec amendment, foundation §5.7 patch | ~30 | n/a |

M1–M3 are blocking. M4–M6 can land in parallel after M3. M7 requires M5+M6. M8 requires M3+M4. M9 is decorative. M10 closes.

## 9. Risks

| Risk | Likelihood | Mitigation | Rollback |
|------|------------|------------|----------|
| Hand-rolled cron parser has DST / leap-day bug | Med | `nextRunAt` resolution is 1 minute; per-tick re-evaluation covers DST jumps; explicit DST tests (Mar 13 2026, Nov 6 2026) | Replace with `cron-parser` npm dep (15-line refactor; parser interface is stable) |
| Single-timer engine drifts under heavy event-bus load | Low | timer is `setTimeout`, recomputed each fire; no accumulator; integration test runs 1000 fires and asserts ≤ 50 ms drift | Switch to per-job timers (still in-process, no API change) |
| Permission gate for tool-registered jobs becomes a click-fatigue source | Med | Session-scoped `remember` allowed; quota of 20 tool-registered jobs caps blast radius | Add a config `cron.toolRegistration: 'always-ask' \| 'session-allow' \| 'deny'` |
| Pre-built `idle-recap` cron fires every minute → CPU/log noise | Low | Action is `fire_event`, no work unless recap module's idle gate is true; events ring is bounded; ndjsonFlusher off by default | Disable via `/cron disable idle-recap` |
| Two tools in one spec inflates spec scope | Med | AskUserQuestionTool truly shares the pause-and-ping primitive; bundling avoids duplicating that infra in two specs | Split AskUserQuestionTool to its own follow-up spec; cron ships alone |
| `external_trigger` reservation tempts a future PR to silently turn it on | Low | Engine throws `Error('reserved_for_future_spec')` at registration; explicit unit test asserts this; spec linked from any future RemoteTrigger spec | Future spec must amend §5.1 to remove the reservation |
| User registers a cron that fires faster than the model can complete | Med | Overlap-protect drops the second fire with `cron.failed{reason:'overlapping'}`; 3 consecutive overlaps moves job to `errored` | n/a — behavioural; user sees errors and adjusts |
| jobs.json corruption | Low | Atomic write via `.tmp` + rename; corrupt file moved to `.corrupt-<ts>`; engine continues with empty jobs[] | User can `cp .corrupt-<ts> jobs.json` to restore |
| Migration of idleWatcher silently breaks the away-summary card | High (visible) | Integration test in M8 runs the full path: idle threshold → cron tick → recap module gate → forkedAgent → AwaySummaryCard renders | Feature flag `config.recap.useCronTick: true/false`; default off for one release if test reveals issues |
| TaskManager unavailable when `spawn_task` fires (e.g. during shutdown) | Med | Engine catches dispatch error; emits `cron.failed{reason:'task_manager_unavailable'}`; job not rescheduled into errored | n/a |

## 10. Out-of-scope (deferred)

- **RemoteTrigger network channel.** A separate spec (sibling of this one) will define the bridge. It will *consume* CronEngine via a thin adapter that maps inbound RPCs to `engine.add` / `engine.runNow`, never the other way around.
- **IM adapters / channel bot.** Separate spec; depends on RemoteTrigger.
- **Per-team cron.** Phase14a swarm follow-up; team config will gain a `crons: CronJob[]` array and the engine will scope by `owner.teamName`.
- **Quartz-style 6-field expressions, `@yearly` macros, timezone overrides.** Defer until a user reports needing it.
- **Backfill of missed cron-expression matches.** Unbounded backfill is dangerous; an opt-in `runOnMissed` for cron-expression jobs is a possible follow-up but not in this spec.
- **Distributed lock / multi-Nuka coordination.** Outside the in-process invariant.
- **AskUserQuestionTool rich previews / multi-select / annotations.** Minimum viable shape only.

---

## 11. Spec self-review checklist

- ✅ No "TBD" / "TODO" / placeholder text in normative sections (§§ 1–8, §10).
- ✅ Architecture diagram (§4) consistent with component contracts (§6).
- ✅ Each non-goal in §3 explicitly NOT covered by any milestone in §8.
- ✅ Each goal in §2 maps 1:1 to a §6 contract section: G1→§6.1, G2→§5.1+§6.2, G3a→§6.9, G3b→§6.6+§6.7, G4→§6.3, G5→§6.5, G6→§5.2, G7→§5.4+M8, G8→§5.1 reservation, G9→§6.1 boot, G10→§6.1 tick.
- ✅ Each schema in §5 referenced by at least one §6 contract.
- ✅ Risks (§9) cover the highest-risk items: parser correctness, idle-watcher migration, click-fatigue, corruption.
- ✅ Decoupling from remote: §1, §2 invariants, §3 non-goals, §4 invariants, §10 deferral all reaffirm.
- ✅ Foundation cross-references concrete (file:line where relevant): `idleWatcher.ts:8`, `cost/persist.ts` pattern, EventBus topic addition is additive per foundation §6.2.
- ✅ Sibling specs cross-referenced in header.
- ✅ Reserved extension (`external_trigger`) is schema-shaped but runtime-rejected; future spec hook is unambiguous.
- ✅ Conflict resolution policy stated (§2 G10): deterministic ASCII id sort for simultaneous fires; overlap drops second fire with `cron.failed{reason:'overlapping'}`.
- ✅ Cron parser decision opinionated (§6.4): hand-rolled, ~120 LOC, with explicit fallback to `cron-parser` npm if rollback needed.

---

## Appendix A — End-to-end example: model registers a daily standup recap

```jsonc
// model tool call
{ "tool": "ScheduleCron", "input": {
    "op": "add",
    "name": "morning-standup",
    "schedule": { "type": "cron", "expr": "0 9 * * 1-5" },
    "action":   { "kind": "run_slash", "command": "/recap --since 24h" },
    "tags": ["standup"]
}}
```

Engine flow:

1. `ScheduleCronTool.run()` → `engine.add(job)`.
2. Validation: schema parses; cron parser confirms expr is valid; tool-quota (3/20 used).
3. Permission classify: action is `run_slash` for `/recap`. `/recap` annotation is read-only (renders + writes a markdown file under `~/.nuka/recaps/`); classification escalates to `ask` because the model is registering a *recurring* fire. PermissionChecker prompts user: "Allow ScheduleCron to register a recurring `/recap --since 24h` to fire weekday 9 AM?". User accepts.
4. `nextRunAt = parser.next(schedule, now())` — next weekday 9:00 local.
5. CronStore writes jobs.json atomically; emits `cron.scheduled` event.
6. Tool returns `{ jobId: 'morning-standup', nextRunAt: 1748242800000 }`.

When 9 AM Mon arrives:

1. Engine timer fires; heap head is `morning-standup`.
2. `bus.emit('cron', { type:'cron.fired', jobId:'morning-standup', firedAt, action:'run_slash' })`.
3. ActionDispatcher: REPL active or not — `slash.find('recap').run('--since 24h', slashCtx)`.
4. Slash runs, prints recap, writes file. Engine emits `cron.completed`.
5. `parser.next(...)` recomputes for next weekday; heap re-heaps; new `setTimeout` set.
6. CronStore appends a `CronRunRecord` to `~/.nuka/cron/runs/morning-standup.ndjson`.

## Appendix B — End-to-end example: model asks user a question mid-turn

```jsonc
{ "tool": "AskUserQuestion", "input": {
    "question": "I've drafted two refactors for the registry. Which approach should I take?",
    "options": ["Discriminated union", "Strategy + factory", "Composition"],
    "defaultIndex": 0,
    "timeoutMs": 60000
}}
```

Flow:

1. Tool calls `ctx.askUser.question(...)`.
2. PauseAndPing mints `resolveId = ulid()`; calls `setDialog({ kind:'ask-question', ..., resolveId })`.
3. App.tsx renders `AskQuestionDialog`, intercepting input. Loop is paused awaiting tool result.
4. User picks "Strategy + factory".
5. App reducer fires `onAnswer({ value:'Strategy + factory', optionIndex:1 })`. Dialog closes.
6. PauseAndPing's pending promise resolves with `{ answer:'Strategy + factory', optionIndex:1, viaTimeout:false }`.
7. Tool returns `{ ok:true, data:{ answer:'Strategy + factory', viaTimeout:false, optionIndex:1 } }` — model continues with the choice.

If user does not answer in 60 s: PauseAndPing rejects pending promise with timeout, dialog closes, tool returns `{ ok:true, data:{ answer:options[defaultIndex], viaTimeout:true, optionIndex:defaultIndex } }`. Model sees the timeout flag and may proceed cautiously.

## Appendix C — Decisions log (opinionated)

- **C1: Hand-rolled cron parser, not `cron-parser` npm.** Rationale: bundle size budget, frozen syntax surface, easy DST tests. Rollback to npm is a 15-line change.
- **C2: Single tool with `op` discriminator** for ScheduleCron, not three tools (vs CC's CronCreate/List/Delete). Reduces model tool-manifest weight; the model picks the op fluently.
- **C3: AskUserQuestionTool minimal shape** (no preview, no multi-select, no annotations). Rationale: TUI surface area; richer schema can land later without breaking change since fields are additive.
- **C4: Engine fires by ASCII id sort** when two jobs share a `nextRunAt`. Deterministic, no clock-skew sensitivity, no priority field to argue about.
- **C5: Pre-built jobs use `fire_event`, not `run_slash`.** Decouples cron tick from the consuming module's gating logic; consumers subscribe.
- **C6: Permission gate at `add()`, cached for the session** — not per-fire. Per-fire would shred user attention; session-scope mirrors PermissionChecker conventions.
- **C7: Schema reserves `external_trigger` but engine rejects it.** Forces the future remote spec to *amend* this spec rather than land in parallel; preserves invariant that this primitive is offline.
- **C8: Conflict policy on overlapping fires drops the second fire**, not queue it. Queueing would create reentrancy hazards inside the engine; the model can build queueing on top using `inject_user_message` if it really wants.
