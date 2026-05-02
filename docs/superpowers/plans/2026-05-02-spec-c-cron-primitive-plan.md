# Spec C — Cron primitive: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the in-process cron subsystem under `src/core/cron/`, two model-callable tools (`ScheduleCronTool`, `AskUserQuestionTool`), and the `/cron` slash + settings submenu — all decoupled from any remote/network code. Migrate the existing idle watcher and autoDream tick onto cron jobs.

**Architecture:** Ten milestones (M1–M10). M1–M3 are blocking; M4–M6 land in parallel after M3; M7 needs M5+M6; M8 needs M3+M4; M9 is decorative; M10 closes. All work is **test-first** with vitest + ink-testing-library; fake-clock unit tests for the scheduler.

**Tech stack:** TypeScript 5.6, Node ≥ 18, vitest 2.1, zod 4.3, Ink (existing TUI primitives). No new runtime dependencies — cron parser is hand-rolled (~120 LOC) per spec §6.4 decision C1.

**Source-of-truth spec:** `docs/superpowers/specs/2026-05-02-spec-c-cron-primitive-design.md`

**Bundle budget:** +18 KB minified+gz ceiling (current 312 KB after phase14 → 330 KB cap with this spec).

---

## File Structure

**New files:**

```
src/core/cron/
  types.ts                   §5.1 — Zod schemas (CronJob, CronSchedule, CronAction, CronOwner, CronEvent)
  parser.ts                  §6.4 — hand-rolled 5-field cron parser; describe(); next()
  heap.ts                    §6.1 — minimal min-heap by nextRunAt
  store.ts                   §6.2 — atomic load/save jobs.json; runs/<id>.ndjson rotation
  engine.ts                  §6.1 — CronEngine class: state machine, single timer, fire dispatch
  dispatcher.ts              §6.3 — ActionDispatcher per action.kind
  permission.ts              §6.5 — classify(action) + askUser bridge
  defaults.ts                §5.4 — pre-built idle-recap + auto-dream jobs
  index.ts                   barrel re-export

src/core/agent/
  pauseAndPing.ts            §6.8 — PauseAndPing primitive (used by AskUserQuestionTool + cron inject_user_message)

src/core/tools/builtin/
  scheduleCron.ts            §6.6 — ScheduleCronTool (op:'add'|'list'|'cancel')
  askUserQuestion.ts         §6.7 — AskUserQuestionTool

src/slash/
  cron.ts                    §6.9.1 — /cron slash command (subcommands)

src/tui/
  Submenu/CronSubmenu.tsx    §6.9.2 — table view + key handlers
  Submenu/AskQuestionDialog.tsx  §6.8 — dialog component for AskUserQuestionTool

test/core/cron/
  parser.test.ts
  heap.test.ts
  store.test.ts
  engine.boot.test.ts
  engine.fire.test.ts
  engine.lifecycle.test.ts
  dispatcher.test.ts
  permission.test.ts
  defaults.test.ts

test/core/tools/builtin/
  scheduleCron.test.ts
  askUserQuestion.test.ts

test/core/agent/
  pauseAndPing.test.ts

test/slash/
  cron.test.ts

test/tui/Submenu/
  CronSubmenu.test.tsx
  AskQuestionDialog.test.tsx

test/integration/
  spec-c-idle-recap-migration.test.ts
  spec-c-auto-dream-migration.test.ts
  spec-c-end-to-end.test.ts

test/fixtures/cron/
  jobs.json                  8 jobs covering schedule × action permutations
```

**Modified files:**

```
src/core/events/types.ts     extend Topic union with 'cron'; add CronEvent type
src/core/events/bus.ts       add 'cron' to ring map + handlers map
src/core/paths.ts            add cronDir(home) and cronRunsDir(home, jobId) helpers; ensureNukaLayout
                             creates ~/.nuka/cron and ~/.nuka/cron/runs
src/core/tools/types.ts      ToolRunCtx gains optional `cron?: CronEngine` and `askUser?: PauseAndPing`
src/slash/types.ts           DialogDescriptor union extended with 'cron-submenu' and 'ask-question'
src/slash/registry.ts        no behaviour change; CronCommand registered in cli.tsx
src/cli.tsx                  bootstrap CronEngine; plumb into ToolRunCtx; subscribe AskUserQuestionDialog
                             listener; register CronCommand; install retention sweep for cron/runs/
src/tui/App.tsx              dialog descriptor handler for ask-question + cron-submenu;
                             pushUserInput hook exported to ActionDispatcher
src/core/recap/idleWatcher.ts replace standalone setTimeout with subscribe to cron 'recap.idle.tick';
                              keep poke()/onAway/onReturn API stable
src/core/recap/autoDream.ts  replace 30-min setInterval with subscribe to 'recap.autodream.tick'
src/tui/Submenu/settings/    add 'Cron' entry that routes to CronSubmenu
docs/superpowers/specs/2026-04-30-phase14-foundation-design.md
                              §5.7 retention table — append cron/runs row (additive)
```

---

## Task 1: M1 — Schema + parser + EventBus topic

**Files:**
- New: `src/core/cron/types.ts`, `src/core/cron/parser.ts`, `src/core/cron/heap.ts`, `src/core/events/types.ts` (extend), `src/core/events/bus.ts` (extend)
- Tests: `test/core/cron/parser.test.ts`, `test/core/cron/heap.test.ts`, `test/core/events/topic-cron.test.ts`

### Step 1.1 — Schema with failing test

- [ ] Write `test/core/cron/parser.test.ts` covering:
  - `parse('* * * * *')` returns truthy AST
  - `parse('*/5 * * * *')` returns truthy
  - `parse('0 9 * * 1-5')` returns truthy
  - `parse('0,15,30,45 * * * *')` returns truthy
  - `parse('60 * * * *')` returns null (minute out of range)
  - `parse('* * * 13 *')` returns null (month out of range)
  - `parse('garbage')` returns null
  - `next(schedule:{type:'cron',expr:'*/5 * * * *'}, fromMs)` returns the next 5-min tick boundary
  - DST tests: spring forward on 2026-03-08 (US) — `next('0 2 * * *', 2026-03-07T12:00 local)` skips to 03:00 on the spring-forward day
  - DST tests: fall back on 2026-11-01 — `next('30 1 * * *', 2026-11-01T00:00)` fires once
  - leap-year: `next('0 0 29 2 *', 2026-01-01)` returns 2028-02-29 (2026 isn't a leap year)
  - `describe('*/5 * * * *')` returns `'every 5 minutes'`
  - `describe('0 9 * * 1-5')` returns `'at 09:00 on weekdays'`
- [ ] Run: vitest fails (parser not implemented)

### Step 1.2 — Implement schema + parser

- [ ] Create `src/core/cron/types.ts` with full Zod schemas per spec §5.1.
- [ ] Create `src/core/cron/parser.ts`:
  - Parse a single field into `{ kind: 'all'|'literal'|'range'|'step'|'list', values: number[] }` then flatten to a `Set<number>`.
  - `parse(expr)` returns `{ minute, hour, dom, month, dow }: { Set<number>[] }` or `null`.
  - `next(schedule, fromMs)`:
    - For `interval`: return `Math.ceil((fromMs+1)/everyMs) * everyMs` (next aligned tick after `fromMs`).
    - For `one_shot`: return `atMs` (engine handles past-due via `runOnMissed` flag at boot).
    - For `cron`: walk forward minute-by-minute up to 525_600 minutes (1 year) starting at `fromMs+60_000` (next minute boundary); the first minute matching all five fields wins. (DST and leap-year fall out naturally because we iterate using `Date` constructor in local timezone.)
  - `describe(expr)`: rule-based — `*` minutes + literal hour → "at HH:MM"; step minutes → "every N minutes"; `0 H * * *` → "at H:00 daily"; default → echo expr.
- [ ] Create `src/core/cron/heap.ts`:
  - `class MinHeap<T>` with `push(item, key)`, `pop(): T | undefined`, `peek(): T | undefined`, `remove(predicate)`, `update(predicate, newKey)`, `size`.
  - Backed by `Array<{ key: number; item: T }>` with sift-up / sift-down.
  - Constant `O(log n)` for push/pop; `O(n)` for remove/update (we don't need `decrease-key` performance — heap holds at most ~20 jobs).

**Acceptance:**
- All parser tests pass.
- Heap tests pass (push 100 items in random order, pop in ascending key order).
- LOC: parser ~140, heap ~70, types ~110.

### Step 1.3 — EventBus topic extension

- [ ] Edit `src/core/events/types.ts`:
  - Extend `export type Topic = 'task' | 'agent' | 'message' | 'harness' | 'cron'`.
  - Add `export type CronEvent = …` per spec §5.2.
- [ ] Edit `src/core/events/bus.ts`:
  - Initialise `ring` Map with `'cron': []`.
  - Initialise `handlers` Map with `'cron': new Set()`.
  - Add `emit(topic: 'cron', e: CronEvent): void` overload to interface.
- [ ] Write `test/core/events/topic-cron.test.ts`:
  - `bus.emit('cron', { type:'cron.fired', jobId:'x', firedAt:1, action:'fire_event' })` then `bus.replay('cron', 1)` returns the event.
  - `bus.subscribe('cron', cb)` receives the event.

**Acceptance:** typecheck clean; all tests green.

---

## Task 2: M2 — CronStore + paths + retention

**Files:**
- New: `src/core/cron/store.ts`
- Modify: `src/core/paths.ts`
- Tests: `test/core/cron/store.test.ts`, `test/core/paths.cron.test.ts`

### Step 2.1 — Failing test

- [ ] Write `test/core/cron/store.test.ts`:
  - `load()` on missing file returns `{ version:1, jobs:[], updatedAt:0 }` and creates the file.
  - `save(file)` writes atomically: confirm `<file>.tmp` does not exist after success.
  - Mid-write crash (mock `fs.renameSync` to throw): `<file>.tmp` exists; load() recovers from valid `<file>` if present.
  - `load()` on corrupt JSON renames file to `<file>.corrupt-<ts>` and returns empty.
  - `appendRun(jobId, rec)` creates `runs/<id>.ndjson`; appending 51 records keeps only the last 50 (oldest dropped).
  - `readRuns(jobId)` returns the records in order.

### Step 2.2 — Implement

- [ ] Edit `src/core/paths.ts`:
  ```ts
  export function cronDir(home: string): string { return path.join(nukaHome(home), 'cron') }
  export function cronJobsFile(home: string): string { return path.join(cronDir(home), 'jobs.json') }
  export function cronRunsDir(home: string): string { return path.join(cronDir(home), 'runs') }
  export function cronRunsFile(home: string, jobId: string): string {
    return path.join(cronRunsDir(home), `${jobId}.ndjson`)
  }
  ```
  Add `cronDir(home)` and `cronRunsDir(home)` to the `ensureNukaLayout` dirs array.
- [ ] Create `src/core/cron/store.ts`:
  - `load()`: read file; if ENOENT, write a fresh empty file and return it. If JSON parse or Zod validation throws, rename to `corrupt-<ts>` (use `Date.now()`), write fresh empty file, return it.
  - `save(file)`: serialise; write to `<jobs.json>.tmp`; `fs.fsyncSync(fd)` after write; `fs.renameSync(tmp, jobs.json)`. Errors propagate (caller logs).
  - `appendRun(jobId, rec)`:
    - Read existing file (if any).
    - Append the record.
    - Slice to last 50.
    - Atomic write to `runs/<jobId>.ndjson` via `.tmp + rename`.
  - `readRuns(jobId)`: read file; split by `\n`; parse each non-empty line; return array (truncate at 50).

**Acceptance:**
- All store tests pass.
- LOC: store ~180, paths +30.

### Step 2.3 — Retention sweep

- [ ] Edit `src/core/tasks/retention.ts` (foundation §5.7) to also sweep `cron/runs/<id>.ndjson` files older than 14 days from their `mtime`. Pre-built jobs' run files are *not* exempt (they're noisy; pruning is fine).
- [ ] Append a row to foundation §5.7 retention table:
  ```
  | `cron/jobs.json` | until explicit /cron remove | n/a |
  | `cron/runs/<id>.ndjson` | 14 days from mtime | per-file delete |
  ```
- [ ] Write a test in `test/core/tasks/retention.test.ts` (extend existing) verifying cron runs swept.

**Acceptance:** retention test green; foundation spec patch committed in M10.

---

## Task 3: M3 — CronEngine core (boot, lifecycle, fire)

**Files:**
- New: `src/core/cron/engine.ts`
- Tests: `test/core/cron/engine.boot.test.ts`, `test/core/cron/engine.fire.test.ts`, `test/core/cron/engine.lifecycle.test.ts`

### Step 3.1 — Failing tests

- [ ] Write `engine.boot.test.ts`:
  - `start()` loads jobs.json; emits `cron.scheduled` for each enabled job.
  - Overdue cron-expression job: `nextRunAt` recomputed forward; `cron.scheduled` emitted with new value (no fire).
  - Overdue one-shot with `runOnMissed: true`: fires immediately on start; state → `expired`.
  - Overdue one-shot with `runOnMissed: false`: state → `expired`, no fire.
  - `start()` is idempotent — calling twice does not double-schedule.
  - `stop()` clears the timer, persists `lastRunAt`, refuses subsequent `add()`.
- [ ] Write `engine.fire.test.ts` (use vi.useFakeTimers + injected clock):
  - Single interval job (`everyMs:5000`): advance 5s → 1 fire; advance 10s → 3 fires total (incl. boot).
  - Two jobs at same `nextRunAt`: deterministic ASCII id sort decides order.
  - Overlap: a job whose handler takes 10s while interval is 5s — second tick emits `cron.failed{reason:'overlapping'}` and is NOT executed.
  - Three consecutive failures → state `errored`; subsequent ticks do not fire.
  - One-shot fires once → state `expired` → no further fires.
- [ ] Write `engine.lifecycle.test.ts`:
  - `add({ ... })` returns a job with computed nextRunAt; emits `cron.scheduled`.
  - `pause(id)` sets state `paused`, removes from heap; emits `cron.paused`.
  - `resume(id)` re-computes nextRunAt from now; pushes back; emits `cron.resumed`.
  - `disable(id)` works only on pre-built jobs (own `kind:'plugin' && pluginId:'nuka-builtin'`).
  - `disable(id)` on a user job throws `'use_remove_for_user_jobs'`.
  - `enable(id)` reverses disable.
  - `remove(id, by)` deletes from store + heap; emits `cron.cancelled` with `cancelledBy:by`.
  - `remove(id)` on a pre-built job throws `'cannot_remove_builtin'`.
  - `runNow(id)` fires synchronously without affecting nextRunAt.
  - `list({ tag, ownerKind, state })` filters correctly.
  - `onChange(cb)` fires after each mutation.

### Step 3.2 — Implement engine

- [ ] Create `src/core/cron/engine.ts` with class `CronEngine` per spec §6.1.
- [ ] State held privately:
  - `private jobs: Map<string, CronJob>`
  - `private heap: MinHeap<{ jobId: string }>`
  - `private inFlight: Set<string>`
  - `private timer: ReturnType<typeof setTimeout> | null`
  - `private changeListeners: Set<(snap: CronJob[]) => void>`
  - `private persistTimer: ReturnType<typeof setTimeout> | null` (5s debounced save)
  - `private stopped: boolean`
- [ ] `start()`:
  - `await store.load()`; populate jobs map.
  - For each job:
    - If `state === 'expired' || 'errored' || 'disabled' || 'paused'`: don't schedule.
    - If `schedule.type === 'one_shot'` and `atMs < now`:
      - If `runOnMissed`: fire immediately (queued microtask), then mark expired.
      - Else: mark expired.
    - Else: `nextRunAt = parser.next(schedule, now)`; push to heap; emit `cron.scheduled`.
  - Set timer to head.
  - Call `onChange` listeners.
- [ ] `stop()`:
  - Set `stopped = true`.
  - Clear `timer`.
  - Flush pending persist immediately (no debounce).
  - Refuse subsequent operations with `'engine_stopped'`.
- [ ] Tick algorithm per spec §6.1:
  ```
  schedule(): clear timer; head = heap.peek(); if !head, return.
              delay = max(0, head.nextRunAt - now())
              timer = setTimeout(fire, delay)

  fire(): timer = null
          while (head && head.nextRunAt <= now()):
            jobId = heap.pop().jobId
            await fireOne(jobId)
            head = heap.peek()
          schedule()

  fireOne(jobId):
    job = jobs.get(jobId)
    if !job || job.state !== 'enabled': return
    if inFlight.has(jobId):
      bus.emit('cron', { type:'cron.failed', jobId, firedAt:now, reason:'overlapping' })
      // Still re-heap for next match
      reschedule(job)
      countFailureWindow(job)
      return
    inFlight.add(jobId)
    bus.emit('cron', { type:'cron.fired', jobId, firedAt:now, action:job.action.kind })
    const t0 = now()
    try {
      await dispatch(job.action, job)
      const dur = now() - t0
      bus.emit('cron', { type:'cron.completed', jobId, firedAt:t0, durationMs:dur })
      job.runHistory = appendRun(job, { firedAt:t0, completedAt:now(), status:'ok', durationMs:dur })
      resetFailureWindow(job)
    } catch (e) {
      bus.emit('cron', { type:'cron.failed', jobId, firedAt:t0, reason:'dispatch_error', error:String(e) })
      job.runHistory = appendRun(job, { firedAt:t0, status:'failed', error:String(e) })
      countFailureWindow(job)
    } finally {
      inFlight.delete(jobId)
      job.lastRunAt = t0
      reschedule(job)
      schedulePersist()
    }
  ```
- [ ] `reschedule(job)`:
  - For `one_shot`: `state = 'expired'`. No re-heap.
  - Else: `job.nextRunAt = parser.next(job.schedule, now())`; push to heap.
- [ ] `countFailureWindow(job)`: increment a per-job in-memory counter; if `>= 3` consecutive without success, set `state = 'errored'`, `nextRunAt = undefined`, do not re-heap; emit cron.failed once with reason `quarantined`.
- [ ] `resetFailureWindow(job)`: clear counter.
- [ ] `schedulePersist()`: debounce — if timer pending, do nothing; else `setTimeout(() => store.save(snapshotFile()), 5000)`.

**Acceptance:** all engine tests green. LOC: ~520.

---

## Task 4: M4 — ActionDispatcher + permission gate

**Files:**
- New: `src/core/cron/dispatcher.ts`, `src/core/cron/permission.ts`
- Tests: `test/core/cron/dispatcher.test.ts`, `test/core/cron/permission.test.ts`

### Step 4.1 — Failing test (dispatcher)

- [ ] Write `dispatcher.test.ts`:
  - `inject_user_message`: calls `pushUserInput(text)`.
  - `run_slash` (`/recap --since 1h`): finds `recap` in registry; calls `.run('--since 1h', slashCtx)`; result emitted as system notice when `isReplIdle()`.
  - `spawn_task` with `taskSpec.kind:'local_bash'`: forwards to `taskManager.enqueue`.
  - `spawn_task` with disallowed kind (`in_process_teammate`): throws `'task_kind_not_permitted'`.
  - `spawn_task` when `taskManager` undefined: throws `'task_manager_unavailable'`.
  - `fire_event`: emits `bus.emit('cron', { type:'cron.user', jobId, topic, payload })`.
  - `external_trigger`: throws `'reserved_for_future_spec'`.
  - When `!isReplIdle()` and action is `inject_user_message`: text queued via `queueForNext(banner, body)` instead of pushed.

### Step 4.2 — Failing test (permission)

- [ ] Write `permission.test.ts`:
  - `classify({ kind:'fire_event' })` → `{ hint:'allow', annotations:{} }`.
  - `classify({ kind:'inject_user_message' })` → `{ hint:'allow' }`.
  - `classify({ kind:'run_slash', command:'/recap …' })` → `{ hint:'ask', annotations:{ destructive:true } }`.
  - `classify({ kind:'spawn_task', taskSpec:{ kind:'local_bash', … } })` → ask + destructive.
  - `classify({ kind:'spawn_task', taskSpec:{ kind:'local_agent', … } })` → ask, not destructive.
  - `classify({ kind:'external_trigger' })` throws.
  - `gate(checker, action)`:
    - When checker.askUser returns `{ allowed:false }`, gate throws `'cron_permission_denied'`.
    - When `{ allowed:true, remember:{ scope:'session', … } }`, gate caches and second call short-circuits.

### Step 4.3 — Implement

- [ ] Create `src/core/cron/dispatcher.ts` with `makeActionDispatcher(ctx: DispatchContext): ActionDispatcher` per spec §6.3.
- [ ] Create `src/core/cron/permission.ts` exporting `classify(action)` and `gate(checker, action)`.

**Acceptance:** dispatcher + permission tests green. LOC: dispatcher ~140, permission ~100.

---

## Task 5: M5 — ScheduleCronTool

**Files:**
- New: `src/core/tools/builtin/scheduleCron.ts`
- Modify: `src/core/tools/types.ts` (ToolRunCtx)
- Tests: `test/core/tools/builtin/scheduleCron.test.ts`

### Step 5.1 — Failing test

- [ ] Write `scheduleCron.test.ts` (uses fake CronEngine):
  - `op:'add'` with valid input returns `{ jobId, nextRunAt }`.
  - `op:'add'` with bad cron expr returns Zod-validation error.
  - `op:'add'` permission denial surfaces as `{ ok:false, error:'cron_permission_denied' }`.
  - 21st add in same session fails with `'tool_quota_exceeded'`.
  - `op:'list'` with no `tag` returns all engine jobs.
  - `op:'list'` with `tag:'recap'` filters.
  - `op:'cancel'` with valid id returns `{ ok:true }`.
  - `op:'cancel'` with unknown id returns `{ ok:false, error:'unknown_job' }`.
  - `op:'cancel'` on pre-built rejects with `cannot_remove_builtin`.

### Step 5.2 — Implement

- [ ] Edit `src/core/tools/types.ts`:
  ```ts
  export type ToolRunCtx = {
    // existing fields …
    cron?: CronEngine
    askUser?: PauseAndPing  // §6.8 — wired in Task 6
  }
  ```
- [ ] Create `src/core/tools/builtin/scheduleCron.ts` per spec §6.6.
- [ ] Implement per-session quota: `const sessionQuota = new WeakMap<Session, number>()`; increment on each `op:'add'`; reject when ≥ 20.

**Acceptance:** all tool tests green. LOC: ~190.

---

## Task 6: M6 — PauseAndPing + AskUserQuestionTool + dialog

**Files:**
- New: `src/core/agent/pauseAndPing.ts`, `src/core/tools/builtin/askUserQuestion.ts`, `src/tui/Submenu/AskQuestionDialog.tsx`
- Modify: `src/slash/types.ts` (DialogDescriptor)
- Tests: `test/core/agent/pauseAndPing.test.ts`, `test/core/tools/builtin/askUserQuestion.test.ts`, `test/tui/Submenu/AskQuestionDialog.test.tsx`

### Step 6.1 — Failing test (PauseAndPing)

- [ ] Write `pauseAndPing.test.ts`:
  - `pap.question(input)` returns a pending promise; `setDialog(...)` was called with a `kind:'ask-question'` payload + a `resolveId`.
  - When the App fires `onAnswer({ value:'A' })` matching the resolveId, promise resolves to `{ answer:'A', viaTimeout:false }`.
  - Timeout: when `timeoutMs:1000` and 1s elapses without answer, promise resolves to `{ answer:options[defaultIndex], viaTimeout:true, optionIndex:defaultIndex }`.
  - Concurrent `question()` while another is pending throws `'pause_and_ping_busy'`.
  - Aborting via signal closes dialog and rejects with AbortError.

### Step 6.2 — Failing test (AskUserQuestionTool)

- [ ] Write `askUserQuestion.test.ts`:
  - Tool returns user's choice via mocked `ctx.askUser`.
  - When `options` omitted, free-text answer accepted.
  - `defaultIndex` validated against `options.length`.
  - `timeoutMs:0` means no timeout.

### Step 6.3 — Failing test (Dialog component)

- [ ] Write `AskQuestionDialog.test.tsx` (ink-testing-library):
  - Renders the question and 2-4 options.
  - Arrow keys move selection.
  - Enter calls `onAnswer({ value: options[idx], optionIndex: idx })`.
  - Esc calls `onCancel`.
  - Free-text mode (no options): TextInput visible; Enter submits typed text.
  - Default index pre-selected.

### Step 6.4 — Implement

- [ ] Create `src/core/agent/pauseAndPing.ts` per spec §6.8.
- [ ] Edit `src/slash/types.ts`:
  ```ts
  // DialogDescriptor extension
  | { kind: 'ask-question'; question: string; options?: string[]; defaultIndex?: number; timeoutMs?: number; resolveId: string }
  | { kind: 'cron-submenu' }
  ```
- [ ] Create `src/tui/Submenu/AskQuestionDialog.tsx`:
  - Accepts `{ question, options?, defaultIndex?, timeoutMs?, onAnswer, onCancel }`.
  - Uses existing Ink primitives (`Box`, `Text`, `useInput`).
  - Multi-option mode: vertical list with arrow-key navigation.
  - Free-text mode: simple text input row.
  - Optional countdown bar when `timeoutMs > 0`.
- [ ] Create `src/core/tools/builtin/askUserQuestion.ts` per spec §6.7.

**Acceptance:** all tests green. LOC: pauseAndPing ~100, dialog ~140, tool ~80.

---

## Task 7: M7 — `/cron` slash + CronSubmenu

**Files:**
- New: `src/slash/cron.ts`, `src/tui/Submenu/CronSubmenu.tsx`
- Tests: `test/slash/cron.test.ts`, `test/tui/Submenu/CronSubmenu.test.tsx`

### Step 7.1 — Failing test (slash)

- [ ] Write `cron.test.ts`:
  - `/cron` (no args) returns `{ type:'dialog', dialog:{ kind:'cron-submenu' } }`.
  - `/cron list` prints a table-formatted text line per job.
  - `/cron list --tag recap` filters.
  - `/cron add` parses three forms:
    - `/cron add "name" "0 9 * * *" inject:"hello"`
    - `/cron add "name" "interval 5m" run_slash:"/cost"`
    - `/cron add "name" "one_shot 2026-05-03T09:00" run_slash:"/recap"`
  - `/cron remove <id>` calls `engine.remove`; pre-built rejection surfaces.
  - `/cron pause <id>` / `/cron resume <id>` invoke engine.
  - `/cron run-now <id>` invokes engine.runNow.
  - `/cron disable <id>` works on pre-builts; rejects user jobs.
  - `/cron defaults` ensures pre-built jobs are present (idempotent).
  - `/cron show <id>` prints multiline detail (action, schedule, last 5 runs).

### Step 7.2 — Failing test (CronSubmenu)

- [ ] Write `CronSubmenu.test.tsx` (ink-testing-library):
  - Renders all jobs from a fixture engine.
  - `j` / `k` move row selection.
  - `p` toggles pause/resume on selected job.
  - `r` runs selected job now.
  - `d` opens confirm dialog; `y` deletes.
  - `a` opens AddJobDialog (asserts the dialog appears).
  - `Esc` exits submenu.
  - Pre-built rows show "[builtin]" badge and `d` is greyed.

### Step 7.3 — Implement slash

- [ ] Create `src/slash/cron.ts` exporting `CronCommand: SlashCommand`.
- [ ] Argument parser: rough hand-written tokeniser that respects double-quoted strings and the action prefix (`inject:` / `run_slash:` / `spawn_task:` / `fire_event:`).
- [ ] For `/cron add`, parse schedule like:
  - `"M H D Mo W"` → cron expr.
  - `"interval <duration>"` (`5m`, `30s`, `1h`) → `{ type:'interval', everyMs }`.
  - `"one_shot <ISO>"` → `{ type:'one_shot', atMs:Date.parse(...), runOnMissed:false }`.
- [ ] For `/cron defaults`, call `seedDefaults(engine)` (defined in Task 8 but exposed here as engine method).

### Step 7.4 — Implement CronSubmenu

- [ ] Create `src/tui/Submenu/CronSubmenu.tsx`:
  - Subscribe to `engine.onChange(snap => setJobs(snap))` on mount.
  - Render `<SubmenuFrame>` (existing) with a table.
  - Key handlers via `useInput`.
  - Embedded `<AddJobDialog>` modal opens on `a`.
  - `<JobDetail>` panel toggles on Enter.

**Acceptance:** all tests green. LOC: slash ~250, CronSubmenu ~310, AddJobDialog ~150.

---

## Task 8: M8 — Boot wiring + pre-built defaults + idle/dream migration

**Files:**
- New: `src/core/cron/defaults.ts`
- Modify: `src/cli.tsx`, `src/core/recap/idleWatcher.ts`, `src/core/recap/autoDream.ts`
- Tests: `test/core/cron/defaults.test.ts`, `test/integration/spec-c-idle-recap-migration.test.ts`, `test/integration/spec-c-auto-dream-migration.test.ts`

### Step 8.1 — Failing test

- [ ] Write `defaults.test.ts`:
  - `seedDefaults(engine)` on empty store creates the two pre-built jobs.
  - `seedDefaults(engine)` on store with one of them already present is idempotent (no duplicate; existing job retained).
- [ ] Write `spec-c-idle-recap-migration.test.ts`:
  - Boot engine with idle-recap default.
  - Subscribe a fake `recap.idle.tick` listener.
  - Advance clock 60s → 1 tick.
  - When `idleWatcher.poke()` was called within 5 min: listener fires but recap module's idle-gate computes `notIdle` and does NOT call forkedAgent (mock asserted).
  - When 5 min has elapsed since last `poke()`: gate passes; forkedAgent mock called; AwaySummaryCard payload produced.
  - Confirm: legacy `setTimeout` in `idleWatcher.ts` is no longer wired (assert by spy: only the cron path calls forkedAgent).
- [ ] Write `spec-c-auto-dream-migration.test.ts`:
  - Boot engine with auto-dream default.
  - Advance 30 min → 1 tick.
  - Listener invokes autoDream.tick(); when gates pass, dream task enqueued.
  - When gates don't pass (lastConsolidatedAt < 6h): no enqueue.

### Step 8.2 — Implement defaults

- [ ] Create `src/core/cron/defaults.ts`:
  ```ts
  export async function seedDefaults(engine: CronEngine): Promise<void> {
    const existing = new Set(engine.list().map(j => j.id))
    for (const def of DEFAULT_JOBS) {
      if (!existing.has(def.id)) {
        await engine.add({ ...def, id: def.id })  // engine respects passed id when ownerKind === 'plugin'
      }
    }
  }
  ```
- [ ] Engine.add: when `owner.kind === 'plugin'` and `id` is supplied, accept it as-is (don't auto-mint a ULID). For tool/tui owners, auto-mint.

### Step 8.3 — Wire into cli.tsx

- [ ] In `src/cli.tsx`:
  - Import `CronEngine`, `CronStore`, `makeActionDispatcher`, `seedDefaults`, `createPauseAndPing`, `CronCommand`.
  - After `ensureNukaLayout(home)`:
    ```ts
    const cronStore = new CronStore(home)
    const cron = new CronEngine({
      home, bus, permission: permChecker,
      taskManager,
      dispatch: makeActionDispatcher({
        pushUserInput,            // exposed by App via ref
        slash: slashRegistry,
        slashCtx,
        taskManager,
        bus,
        queueForNext,             // exposed by App
        isReplIdle,               // exposed by App
      }),
    })
    await cron.start()
    await seedDefaults(cron)
    ```
  - Plumb `cron` into ToolRunCtx.
  - Construct `pauseAndPing = createPauseAndPing({ setDialog, clearDialog, onAnswer })` and plumb into ToolRunCtx as `askUser`.
  - Register `CronCommand` in slash registry.
  - On graceful shutdown (existing `onExit` hook): `await cron.stop()`.

### Step 8.4 — Migrate idleWatcher

- [ ] Edit `src/core/recap/idleWatcher.ts`:
  - Keep the `IdleWatcherOpts` and `startIdleWatcher` exported API stable (no caller rewrite).
  - Internal change: instead of `setTimeout` polling, the function now subscribes to `bus` topic `'cron'` filtering for `type:'cron.user' && topic:'recap.idle.tick'`, plus listens to user-input pokes for the threshold check. The cron heartbeat ensures we get a wake-up at most 60 s after threshold is crossed.
  - Pseudocode:
    ```ts
    export function startIdleWatcher(opts: IdleWatcherOpts & { bus: EventBus }) {
      let lastInputAt = Date.now(); let isAway = false
      const unsub = opts.bus.subscribe<CronEvent>('cron', e => {
        if (e.type !== 'cron.user' || e.topic !== 'recap.idle.tick') return
        const idle = Date.now() - lastInputAt
        if (!isAway && idle >= opts.thresholdMs) { isAway = true; opts.onAway() }
      })
      return {
        poke: () => { const idle = Date.now() - lastInputAt; lastInputAt = Date.now()
                      if (isAway) { isAway = false; opts.onReturn(idle) } },
        stop: () => unsub(),
      }
    }
    ```
  - Update the one call site in `cli.tsx` to pass `bus`.

### Step 8.5 — Migrate autoDream

- [ ] Edit `src/core/recap/autoDream.ts`:
  - Replace internal `setInterval(() => tick(), 30*60_000)` with a bus subscription on `'cron'` filtering `topic:'recap.autodream.tick'`.
  - `tick()` body unchanged (lock acquire, gate eval, enqueue dream task).

**Acceptance:** all tests green; integration tests confirm migrated flows. LOC: defaults ~60, cli wiring ~80, watcher migration -20 / +30, autoDream -10 / +25.

---

## Task 9: M9 — Settings submenu integration + Tasks panel header

**Files:**
- Modify: `src/tui/Submenu/settings/index.tsx`, `src/tui/Tasks/TasksPanel.tsx`
- Tests: `test/tui/Submenu/settings.cron-entry.test.tsx`, `test/tui/Tasks/header-cron.test.tsx`

### Step 9.1 — Failing test

- [ ] Write `settings.cron-entry.test.tsx`:
  - Settings submenu lists a "Cron jobs" entry.
  - Selecting it dispatches `kind:'cron-submenu'`.
- [ ] Write `header-cron.test.tsx`:
  - When `config.cron.showInTasksPanel: true`, panel header shows `next cron: idle-recap in 12s`.
  - When false, no header line.
  - Header updates as `cron.scheduled` events flow.

### Step 9.2 — Implement

- [ ] Add a "Cron jobs" entry to `settings/index.tsx`. Gate by feature presence (cron always present after Task 8).
- [ ] Add the optional one-line header to `TasksPanel.tsx`:
  - Subscribe to `bus.replay('cron', 50)` on mount.
  - Compute `next = min(events filter cron.scheduled).nextRunAt`.
  - Render `<Text>{`next cron: ${jobId} in ${formatRelative(next - now)}`}</Text>` when enabled.

**Acceptance:** tests green. LOC: ~90.

---

## Task 10: M10 — Bundle audit + spec amendment + close-out

**Files:**
- Modify: `docs/superpowers/specs/2026-04-30-phase14-foundation-design.md` (retention table append)
- New (local): `scripts/spec-c-bundle-check.mjs`

### Step 10.1 — Bundle audit

- [ ] Run `npm run build && du -sh dist/cli.cjs` (or the existing bundle target).
- [ ] Compare to baseline; assert delta ≤ 18 KB minified+gz. If over, identify the offender:
  - The hand-rolled cron parser should be ≤ 4 KB.
  - The engine + heap + dispatcher ≤ 8 KB.
  - The two tools ≤ 3 KB.
  - Slash + Submenu ≤ 5 KB (UI bigger than logic — typical Ink overhead).
- [ ] If over budget by < 5 KB: investigate dead-code paths in dispatcher's switch.
- [ ] If over budget by ≥ 5 KB: stash CronSubmenu's add-job wizard behind a code-split (defer to a separate dynamic-import chunk loaded only on submenu open).

### Step 10.2 — Spec amendment for retention

- [ ] Edit `docs/superpowers/specs/2026-04-30-phase14-foundation-design.md` §5.7:
  - Append two rows:
    | `cron/jobs.json` | until explicit `/cron remove` | n/a |
    | `cron/runs/<id>.ndjson` | 14 days from mtime | per-file delete |
  - Inline note: "Cron primitive is defined in `2026-05-02-spec-c-cron-primitive-design.md`."

### Step 10.3 — Audit checklist

- [ ] Public exports stable: `CronEngine`, `CronStore`, `CronJob`, `CronAction`, `CronSchedule`, `CronOwner`, `CronEvent`, `Topic` (extended).
- [ ] No private-API rename in this spec.
- [ ] Subspec amendments tracked: foundation §5.7 only.
- [ ] All M1–M9 tests green.
- [ ] `npm run typecheck` clean.
- [ ] Migration tests confirm idle-recap + autoDream flows still produce expected user-visible behaviour.
- [ ] Doctor reports: extend `slash/doctor.ts` to include a "cron" section showing job count, errored count, next fire — small UX win; not blocking, file as follow-up if rushed.

**Acceptance:** all of the above checked. LOC: amendments ~30.

---

## Test fixtures

Create `test/fixtures/cron/jobs.json`:

```json
{
  "version": 1,
  "updatedAt": 1746150000000,
  "jobs": [
    {
      "id": "fixture-cron-inject",
      "name": "fixture cron expr + inject",
      "schedule": { "type": "cron", "expr": "*/5 * * * *" },
      "action": { "kind": "inject_user_message", "text": "hello" },
      "owner": { "kind": "tui", "registeredAt": 1746150000000 },
      "state": "enabled", "createdAt": 1746150000000, "runHistory": [], "tags": []
    },
    {
      "id": "fixture-interval-slash",
      "name": "fixture interval + run_slash",
      "schedule": { "type": "interval", "everyMs": 60000 },
      "action": { "kind": "run_slash", "command": "/cost" },
      "owner": { "kind": "tool", "toolName": "ScheduleCron", "sessionId": "test" },
      "state": "enabled", "createdAt": 1746150000000, "runHistory": [], "tags": ["finance"]
    },
    {
      "id": "fixture-oneshot-spawntask",
      "name": "fixture one-shot + spawn_task",
      "schedule": { "type": "one_shot", "atMs": 9999999999999, "runOnMissed": true },
      "action": { "kind": "spawn_task", "taskSpec": { "kind": "local_bash", "description": "x", "command": "echo", "args": ["hi"] } },
      "owner": { "kind": "tool", "toolName": "ScheduleCron", "sessionId": "test" },
      "state": "enabled", "createdAt": 1746150000000, "runHistory": [], "tags": []
    },
    {
      "id": "fixture-fire-event",
      "name": "fixture fire_event",
      "schedule": { "type": "interval", "everyMs": 30000 },
      "action": { "kind": "fire_event", "topic": "test.tick", "payload": { "n": 1 } },
      "owner": { "kind": "plugin", "pluginId": "fixture" },
      "state": "enabled", "createdAt": 1746150000000, "runHistory": [], "tags": []
    },
    {
      "id": "fixture-paused",
      "name": "fixture paused",
      "schedule": { "type": "interval", "everyMs": 60000 },
      "action": { "kind": "fire_event", "topic": "x", "payload": {} },
      "owner": { "kind": "tui", "registeredAt": 1746150000000 },
      "state": "paused", "createdAt": 1746150000000, "runHistory": [], "tags": []
    },
    {
      "id": "fixture-errored",
      "name": "fixture errored",
      "schedule": { "type": "interval", "everyMs": 60000 },
      "action": { "kind": "run_slash", "command": "/nonexistent" },
      "owner": { "kind": "tui", "registeredAt": 1746150000000 },
      "state": "errored", "createdAt": 1746150000000,
      "runHistory": [
        { "firedAt": 1746140000000, "status": "failed", "error": "unknown slash" },
        { "firedAt": 1746140060000, "status": "failed", "error": "unknown slash" },
        { "firedAt": 1746140120000, "status": "failed", "error": "unknown slash" }
      ], "tags": []
    },
    {
      "id": "fixture-expired",
      "name": "fixture expired one-shot",
      "schedule": { "type": "one_shot", "atMs": 1746000000000, "runOnMissed": false },
      "action": { "kind": "fire_event", "topic": "y", "payload": {} },
      "owner": { "kind": "tui", "registeredAt": 1746000000000 },
      "state": "expired", "createdAt": 1745999000000,
      "runHistory": [{ "firedAt": 1746000000000, "completedAt": 1746000000010, "status": "ok", "durationMs": 10 }],
      "tags": []
    },
    {
      "id": "fixture-disabled-builtin",
      "name": "fixture disabled builtin",
      "schedule": { "type": "interval", "everyMs": 60000 },
      "action": { "kind": "fire_event", "topic": "recap.idle.tick", "payload": {} },
      "owner": { "kind": "plugin", "pluginId": "nuka-builtin" },
      "state": "disabled", "createdAt": 1746000000000, "runHistory": [], "tags": ["builtin"]
    }
  ]
}
```

Used by store, engine boot, and submenu tests for breadth.

---

## CI / verification

- [ ] `npm run typecheck` after each milestone.
- [ ] `npm test` green at the end of each milestone.
- [ ] Bundle delta tracked at M10 (≤ 18 KB).
- [ ] Manual smoke: launch Nuka, run `/cron defaults`, observe two pre-built jobs in `/cron list`. Idle for 5 minutes, observe AwaySummaryCard render. Register `/cron add "echo" "*/1 * * * *" inject:"hi"`, observe `hi` arrive at the next minute boundary.

---

## Risks & mitigations during implementation

| Risk | Mitigation |
|------|------------|
| Hand-rolled parser misses a cron edge case | Tests cover ranges, lists, steps, DST, leap-year; if a user reports a real expr that breaks, swap to `cron-parser` npm (15-line refactor through `CronParser` interface). |
| Engine timer accumulates drift | `setTimeout(delay)` recomputed each fire from `Date.now()`; no accumulator. Integration test running 1000 minute-fires asserts ≤ 50 ms drift. |
| Permission gate spam | Session-scoped `remember` allowed; tool quota of 20 caps blast radius. |
| Migration breaks AwaySummaryCard | M8 integration test exercises full path; if test fails, gate behind `config.recap.useCronTick: false` (default) until fixed. |
| Pre-built `idle-recap` cron fires once a minute even when away-card disabled | The cron emits an event; subscribers (idle watcher) check the gate; no work happens when disabled. Engine itself is cheap. |
| Bundle blows budget | Code-split CronSubmenu's add-job wizard via dynamic import as a fallback. |
| Two tools in one PR | Tools land in separate commits within M5/M6 to keep review scope tight. |

---

## Out-of-scope (deferred — explicit, per spec §10)

- RemoteTrigger / network channel.
- IM adapters.
- Per-team cron.
- Quartz / `@yearly` macros.
- Per-job timezone overrides.
- Cron-expression backfill.
- Multi-Nuka coordination.
- AskUserQuestionTool rich previews / multi-select / annotations.

These are tracked as separate sibling specs and explicitly NOT in any M1–M10 milestone.

---

## Sequencing summary

```
   M1 ─┐              (schema + parser)
   M2 ─┤              (store + paths)
   M3 ─┴────────┐     (engine — depends on M1+M2)
                │
   M4 ◄─────────┤     (dispatcher + permission — depends on M3)
   M5 ◄─────────┤     (ScheduleCronTool — depends on M3)
   M6 ◄─────────┤     (PauseAndPing + AskUserQuestionTool — independent of M3 in code, parallel-friendly)
                │
   M7 ◄── M5+M6        (slash + submenu)
   M8 ◄── M3+M4        (boot wiring + migrations)
   M9 ◄── M8           (decorative; settings + Tasks header)
   M10 ◄ M1..M9        (close-out)
```

M1–M3 are the critical path. After M3 lands, M4–M6 are parallelizable. M7 can start as soon as M5+M6 ship. M8 closes the migration loop and is the first commit users will *see* (their idle/dream timers go through cron now). M10 verifies bundle + amends foundation spec.
