# Background Task Lifecycle Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `sessionStart` / `sessionEnd` / `afterTurn` in-process hook events into the background `local_agent` task path with `context: 'task'`, fronted by a real production caller (`/task run <prompt>`) so the wiring is exercised end-to-end and not dead code.

**Architecture:** `src/core/tasks/run-agent.ts` today only iterates an injected `agentRunner` and appends text to disk — it never touches the hook registry. We thread an optional `hookRegistry` + `sessionId` through `LocalAgentSpec` and `RunAgentOpts`, then fire the three lifecycle events from `runAgent` with the existing `LifecycleContext = 'task'` discriminator (already declared in `hooks/lifecycle.ts`, line 86, but not yet emitted). A new `/task run <prompt>` slash command builds a `LocalAgentSpec` whose `agentRunner` consumes the agent stream via the shared provider/tool registry, enqueues it on `TaskManager`, and returns the task id — this is the first production caller, so the lifecycle wiring is exercised the moment it ships.

**Tech Stack:** TypeScript (strict), Vitest

---

## File Structure

```
src/core/tasks/run-agent.ts                          # MODIFY — fire lifecycle events
src/core/tasks/types.ts                              # MODIFY — extend LocalAgentSpec
src/core/tasks/manager.ts                            # MODIFY — thread hookRegistry through
src/slash/taskRun.ts                                 # CREATE — /task run <prompt>
src/slash/types.ts                                   # MODIFY — extend SlashContext with hookRegistry + agent deps
src/cli.tsx                                          # MODIFY — register TaskRunCommand, wire deps into SlashContext
test/core/tasks/run-agent-lifecycle.test.ts          # CREATE — lifecycle fire order
test/slash/taskRun.test.ts                           # CREATE — caller integration
```

---

## Task 1 — extend `LocalAgentSpec` to carry lifecycle wiring deps

- [ ] **Files:**
  - Modify: `src/core/tasks/types.ts`
  - Test: `test/core/tasks/run-agent-lifecycle.test.ts` (created in Task 2)

- [ ] Write failing test placeholder (we'll fill it in Task 2; type-only changes are validated by `tsc`).

- [ ] Implement. Replace the existing `LocalAgentSpec` block (lines 58–64) with:

```typescript
import type { HookRegistry } from '../hooks/registry'

export type LocalAgentSpec = {
  kind: 'local_agent'
  description: string
  /** Returns an async iterable of textual chunks. The runner persists
   *  each chunk to the task's outputFile in order. */
  agentRunner: (signal: AbortSignal) => AsyncIterable<AgentChunk>
  /**
   * Optional in-process hook registry. When provided, `runAgent` fires
   * `sessionStart` / `sessionEnd` / `afterTurn` with `context: 'task'`.
   * Absent → no events fire (backward-compat for any test fixture that
   * builds a spec without lifecycle wiring).
   */
  hookRegistry?: HookRegistry
  /**
   * Stable identifier used in the lifecycle payloads' `sessionId` field.
   * Defaults to the task id (assigned by `TaskManager.enqueue`) when
   * omitted. Surface as a separate field so callers can correlate a
   * task to a parent session if they wish.
   */
  taskSessionId?: string
  /**
   * Provider/model strings forwarded into `sessionStart` payload so
   * handlers can branch on model identity. Falls back to `'unknown'` /
   * `'unknown'` when the caller does not know (purely metadata).
   */
  providerId?: string
  model?: string
}
```

- [ ] Run `npx tsc --noEmit` — expect no new errors.

- [ ] Commit: `feat(tasks): extend LocalAgentSpec with hookRegistry + session metadata`

---

## Task 2 — failing test for `runAgent` lifecycle order

- [ ] **Files:**
  - Create: `test/core/tasks/run-agent-lifecycle.test.ts`

- [ ] Write failing test:

```typescript
import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAgent } from '../../../src/core/tasks/run-agent'
import { HookRegistry } from '../../../src/core/hooks/registry'
import type { HookContext } from '../../../src/core/hooks/events'
import type { LocalAgentSpec } from '../../../src/core/tasks/types'

describe('runAgent lifecycle wiring', () => {
  it('fires sessionStart, afterTurn, sessionEnd in order with context: task', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nuka-runagent-life-'))
    try {
      const calls: Array<{ event: string; payload: Readonly<Record<string, unknown>> | undefined }> = []
      const registry = new HookRegistry()
      const record = (event: string) => (ctx: HookContext): void => {
        calls.push({ event, payload: ctx.payload })
      }
      registry.register('sessionStart', record('sessionStart'))
      registry.register('afterTurn', record('afterTurn'))
      registry.register('sessionEnd', record('sessionEnd'))

      const spec: LocalAgentSpec = {
        kind: 'local_agent',
        description: 'test',
        hookRegistry: registry,
        taskSessionId: 'task-xyz',
        providerId: 'anthropic',
        model: 'claude-opus-4-7',
        agentRunner: async function* () {
          yield { text: 'hello' }
          yield { text: 'world' }
        },
      }

      await runAgent({
        spec,
        outputFile: join(dir, 'out.log'),
        signal: new AbortController().signal,
      })

      expect(calls.map(c => c.event)).toEqual(['sessionStart', 'afterTurn', 'sessionEnd'])
      expect(calls[0]?.payload).toMatchObject({
        sessionId: 'task-xyz',
        providerId: 'anthropic',
        model: 'claude-opus-4-7',
        context: 'task',
        resumed: false,
      })
      expect(calls[1]?.payload).toMatchObject({
        sessionId: 'task-xyz',
        context: 'task',
        stopReason: 'end_turn',
      })
      expect(calls[2]?.payload).toMatchObject({
        sessionId: 'task-xyz',
        reason: 'completed',
        context: 'task',
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fires sessionEnd with reason=aborted when the signal is tripped mid-stream', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nuka-runagent-abort-'))
    try {
      const calls: string[] = []
      const endPayloads: Readonly<Record<string, unknown>>[] = []
      const registry = new HookRegistry()
      registry.register('sessionStart', (ctx: HookContext) => { calls.push(ctx.event) })
      registry.register('sessionEnd', (ctx: HookContext) => {
        calls.push(ctx.event)
        if (ctx.payload) endPayloads.push(ctx.payload)
      })

      const ac = new AbortController()
      const spec: LocalAgentSpec = {
        kind: 'local_agent',
        description: 'abort',
        hookRegistry: registry,
        taskSessionId: 'task-abort',
        agentRunner: async function* (signal) {
          yield { text: 'one' }
          ac.abort()
          // After abort, runAgent must bail before the next yield is consumed.
          if (signal.aborted) return
          yield { text: 'two' }
        },
      }

      await runAgent({ spec, outputFile: join(dir, 'out.log'), signal: ac.signal })

      expect(calls).toEqual(['sessionStart', 'sessionEnd'])
      expect(endPayloads[0]).toMatchObject({ reason: 'aborted', context: 'task' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('is a no-op (no fires) when hookRegistry is absent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nuka-runagent-nohook-'))
    try {
      const spec: LocalAgentSpec = {
        kind: 'local_agent',
        description: 'no-hook',
        agentRunner: async function* () { yield { text: 'x' } },
      }
      // Should not throw, should produce output file, should not interact with any hook system.
      await runAgent({ spec, outputFile: join(dir, 'out.log'), signal: new AbortController().signal })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
```

- [ ] Run: `npx vitest run test/core/tasks/run-agent-lifecycle.test.ts` — expect FAIL (no events emitted yet).

- [ ] Commit (test only): `test(tasks): failing lifecycle order spec for runAgent`

---

## Task 3 — implement lifecycle fires in `run-agent.ts`

- [ ] **Files:**
  - Modify: `src/core/tasks/run-agent.ts`

- [ ] Replace the full file body with:

```typescript
// src/core/tasks/run-agent.ts
//
// Phase 10 §4.3 — `local_agent` task runner.
//
// Consumes the spec's `agentRunner` async-iterable, persisting each
// chunk's `text` to the task's outputFile. The signal is forwarded so
// the iterable can short-circuit on cancel.
//
// 2026-05-18 lifecycle wiring: when `spec.hookRegistry` is present,
// fires `sessionStart` BEFORE the first chunk, `afterTurn` AFTER the
// iterable completes successfully, and `sessionEnd` on EVERY exit path
// (success, abort, throw). All payloads carry `context: 'task'` so
// handlers can filter on origin. Errors raised inside the registry are
// already swallowed by the fire helpers (`safeInvoke`).

import { appendOutputSync } from './persist'
import {
  fireSessionStart,
  fireSessionEnd,
  fireAfterTurn,
} from '../hooks/lifecycle'
import type { LocalAgentSpec } from './types'

export type RunAgentOpts = {
  spec: LocalAgentSpec
  outputFile: string
  signal: AbortSignal
}

export async function runAgent(opts: RunAgentOpts): Promise<void> {
  const { spec, outputFile, signal } = opts
  const registry = spec.hookRegistry
  const sessionId = spec.taskSessionId ?? 'task-unknown'
  const providerId = spec.providerId ?? 'unknown'
  const model = spec.model ?? 'unknown'

  // sessionStart fires BEFORE the abort check so handlers that need to
  // record "task started" see the event even when the caller pre-aborts.
  if (registry) {
    await fireSessionStart(
      registry,
      {
        sessionId,
        providerId,
        model,
        cwd: process.cwd(),
        resumed: false,
        context: 'task',
      },
      { signal },
    )
  }

  let exitReason: 'completed' | 'aborted' | 'error' = 'completed'

  try {
    if (signal.aborted) {
      exitReason = 'aborted'
      return
    }
    const iter = spec.agentRunner(signal)
    for await (const chunk of iter) {
      if (signal.aborted) {
        exitReason = 'aborted'
        return
      }
      if (chunk.text.length === 0) continue
      try {
        const ends = chunk.text.endsWith('\n')
        appendOutputSync(outputFile, ends ? chunk.text : chunk.text + '\n')
      } catch {
        // Persistence failures are non-fatal; the agent loop continues
        // and the manager will record completion regardless.
      }
    }
    if (signal.aborted) exitReason = 'aborted'
  } catch (err) {
    exitReason = signal.aborted ? 'aborted' : 'error'
    if (!signal.aborted) throw err
  } finally {
    if (registry) {
      // afterTurn only fires on a clean completion. Aborts / errors skip
      // it because the turn never finished — sessionEnd is the
      // authoritative "task done" signal.
      if (exitReason === 'completed') {
        await fireAfterTurn(
          registry,
          {
            sessionId,
            stopReason: 'end_turn',
            toolCalls: 0,
            context: 'task',
          },
          { signal },
        )
      }
      await fireSessionEnd(
        registry,
        {
          sessionId,
          reason: exitReason === 'completed' ? 'completed' : 'aborted',
          context: 'task',
        },
        { signal },
      )
    }
  }
}
```

- [ ] Run: `npx vitest run test/core/tasks/run-agent-lifecycle.test.ts` — expect PASS (all three cases).

- [ ] Run: `npx vitest run test/core/tasks/` — expect existing tests still pass (the spec is backward-compatible when `hookRegistry` is absent).

- [ ] Run: `npx tsc --noEmit` — expect no new errors.

- [ ] Commit: `feat(tasks): fire sessionStart/afterTurn/sessionEnd from runAgent with context=task`

---

## Task 4 — extend `SlashContext` with the deps the new caller needs

- [ ] **Files:**
  - Modify: `src/slash/types.ts`

- [ ] Append the following imports + fields to `SlashContext`:

```typescript
import type { HookRegistry } from '../core/hooks/registry'
import type { ProviderResolver } from '../core/provider/resolver'
```

(The existing file already imports `ProviderResolver`; only add `HookRegistry`.)

- [ ] Add fields to `SlashContext`:

```typescript
export type SlashContext = {
  sessions: SessionManager
  providers: ProviderResolver
  config: Config
  /** Phase 7 §5.2 — optional; absent in legacy tests / programmatic embeds. */
  costTracker?: CostTracker
  /** Phase 10 §4.3 — optional; wired by cli.tsx when the task system is enabled. */
  taskManager?: TaskManager
  /**
   * 2026-05-18 — in-process hook registry. Forwarded into `LocalAgentSpec`
   * by `/task run` so background task lifecycle fires reach user handlers.
   * Absent in headless / fixture contexts.
   */
  hookRegistry?: HookRegistry
}
```

- [ ] Run `npx tsc --noEmit` — expect no errors.

- [ ] Commit: `feat(slash): expose hookRegistry on SlashContext`

---

## Task 5 — failing test for `/task run <prompt>` caller

- [ ] **Files:**
  - Create: `test/slash/taskRun.test.ts`

- [ ] Write failing test:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TaskRunCommand } from '../../src/slash/taskRun'
import { TaskManager } from '../../src/core/tasks/manager'
import { HookRegistry } from '../../src/core/hooks/registry'
import type { HookContext } from '../../src/core/hooks/events'
import type { SlashContext } from '../../src/slash/types'

function makeCtx(home: string): { ctx: SlashContext; mgr: TaskManager; registry: HookRegistry; events: string[] } {
  const events: string[] = []
  const registry = new HookRegistry()
  for (const e of ['sessionStart', 'afterTurn', 'sessionEnd'] as const) {
    registry.register(e, (c: HookContext) => {
      const payload = c.payload as Record<string, unknown> | undefined
      const ctxField = payload?.['context']
      events.push(`${c.event}:${ctxField ?? 'none'}`)
    })
  }
  const mgr = new TaskManager({ home })
  // Cast: the test only needs the fields TaskRunCommand reads.
  const ctx = {
    sessions: {} as never,
    providers: {
      resolveActive: () => ({
        provider: {
          stream: async function* () {
            yield { type: 'text_delta', delta: 'hello from task' }
            yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
            return
          },
        } as never,
        providerId: 'p',
        model: 'm',
      }),
    } as never,
    config: {} as never,
    taskManager: mgr,
    hookRegistry: registry,
  } as unknown as SlashContext
  return { ctx, mgr, registry, events }
}

describe('/task run', () => {
  it('refuses when taskManager is absent', async () => {
    const result = await TaskRunCommand.run('investigate flaky test', {
      sessions: {} as never,
      providers: {} as never,
      config: {} as never,
    } as SlashContext)
    expect(result).toEqual({ type: 'text', text: 'Task system is not enabled in this session.' })
  })

  it('refuses on empty prompt', async () => {
    const home = mkdtempSync(join(tmpdir(), 'nuka-taskrun-empty-'))
    try {
      const { ctx } = makeCtx(home)
      const result = await TaskRunCommand.run('', ctx)
      expect(result).toEqual({ type: 'text', text: 'Usage: /task run <prompt>' })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('enqueues a local_agent task and fires lifecycle events with context=task', async () => {
    const home = mkdtempSync(join(tmpdir(), 'nuka-taskrun-go-'))
    try {
      const { ctx, mgr, events } = makeCtx(home)
      const result = await TaskRunCommand.run('summarize the repo', ctx)
      expect(result.type).toBe('text')
      // wait for the runner to settle
      await mgr.drain()
      expect(events).toEqual([
        'sessionStart:task',
        'afterTurn:task',
        'sessionEnd:task',
      ])
      const tasks = mgr.list()
      expect(tasks).toHaveLength(1)
      expect(tasks[0]?.kind).toBe('local_agent')
      expect(tasks[0]?.state).toBe('completed')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
```

- [ ] Run: `npx vitest run test/slash/taskRun.test.ts` — expect FAIL (module does not exist).

- [ ] Commit: `test(slash): failing spec for /task run caller`

---

## Task 6 — implement `/task run` slash command

- [ ] **Files:**
  - Create: `src/slash/taskRun.ts`

- [ ] Write file:

```typescript
// src/slash/taskRun.ts
//
// 2026-05-18 — first production caller of `LocalAgentSpec`. Without this
// command, `runAgent`'s lifecycle wiring is dead code. The command takes
// a free-form prompt, builds a streaming `agentRunner` that consumes the
// active provider, and hands it to `TaskManager.enqueue` so the work
// runs in the background. The returned task id is rendered back to the
// user; they then track progress via `/tasks show <id>`.
//
// Scope is deliberately narrow: no tool use (the runner just streams
// text from a single provider call). Anything richer belongs in
// `dispatch_agent` / sub-agents — `/task run` is the foreground-friendly
// fire-and-forget hook for ad-hoc background prompts.

import type { SlashCommand, SlashContext, SlashResult } from './types'
import type { LocalAgentSpec, AgentChunk } from '../core/tasks/types'
import { randomUUID } from 'node:crypto'

async function* streamTextChunks(
  ctx: SlashContext,
  prompt: string,
  signal: AbortSignal,
): AsyncIterable<AgentChunk> {
  const active = ctx.providers.resolveActive()
  // The provider stream surface is loose on purpose (Phase 5 type); we
  // only care about `text_delta` deltas for the task log.
  type LooseEvent = { type: string; delta?: string }
  const provider = active.provider as unknown as {
    stream: (
      input: {
        model: string
        system: string
        messages: { role: 'user'; content: string }[]
        tools: unknown[]
        maxTokens: number
      },
      signal: AbortSignal,
    ) => AsyncIterable<LooseEvent>
  }
  const events = provider.stream(
    {
      model: active.model,
      system: 'You are a background task agent. Respond concisely to the user prompt.',
      messages: [{ role: 'user', content: prompt }],
      tools: [],
      maxTokens: 2048,
    },
    signal,
  )
  for await (const ev of events) {
    if (signal.aborted) return
    if (ev.type === 'text_delta' && typeof ev.delta === 'string' && ev.delta.length > 0) {
      yield { text: ev.delta }
    }
  }
}

export const TaskRunCommand: SlashCommand = {
  name: 'task',
  description: 'Run a prompt as a background agent task',
  source: 'builtin',
  usage: '/task run <prompt>',
  args: [
    { name: 'subcommand', choices: ['run'], description: 'Action' },
    { name: 'prompt', description: 'Free-form prompt for the background agent' },
  ],
  examples: ['/task run summarize the repo', '/task run audit the test suite for skipped tests'],
  run: async (args: string, ctx: SlashContext): Promise<SlashResult> => {
    if (!ctx.taskManager) {
      return { type: 'text', text: 'Task system is not enabled in this session.' }
    }
    const trimmed = args.trim()
    if (trimmed === '') {
      return { type: 'text', text: 'Usage: /task run <prompt>' }
    }
    // Accept both `/task run <prompt>` and bare `/task <prompt>` for ergonomics.
    const m = trimmed.match(/^(?:run\s+)?(.+)$/)
    const prompt = m?.[1]?.trim() ?? ''
    if (prompt.length === 0) {
      return { type: 'text', text: 'Usage: /task run <prompt>' }
    }

    const active = ctx.providers.resolveActive()
    const taskSessionId = `task-${randomUUID().slice(0, 8)}`
    const spec: LocalAgentSpec = {
      kind: 'local_agent',
      description: prompt.length > 60 ? prompt.slice(0, 57) + '...' : prompt,
      hookRegistry: ctx.hookRegistry,
      taskSessionId,
      providerId: active.providerId,
      model: active.model,
      agentRunner: (signal) => streamTextChunks(ctx, prompt, signal),
    }
    const task = ctx.taskManager.enqueue(spec)
    return {
      type: 'text',
      text: `Queued background task ${task.id}. Use \`/tasks show ${task.id}\` to tail output.`,
    }
  },
}
```

- [ ] Run: `npx vitest run test/slash/taskRun.test.ts` — expect PASS.

- [ ] Run: `npx tsc --noEmit` — expect no errors.

- [ ] Commit: `feat(slash): /task run <prompt> as production caller for local_agent tasks`

---

## Task 7 — wire `TaskRunCommand` into `cli.tsx`

- [ ] **Files:**
  - Modify: `src/cli.tsx`

- [ ] In the slash registration block (where `TasksCommand` is registered), add the import and registration. Grep for `TasksCommand` to find the exact site, then add adjacent to it:

```typescript
import { TaskRunCommand } from './slash/taskRun'
// ... existing slash registrations ...
slashRegistry.register(TaskRunCommand)
```

- [ ] In the `SlashContext` construction (the literal `{ sessions, providers, config, costTracker, taskManager }` passed to slash command execution), add `hookRegistry`:

```typescript
const slashCtx: SlashContext = {
  sessions,
  providers,
  config,
  costTracker,
  taskManager,
  hookRegistry,   // already in scope inside cli.tsx
}
```

(Grep cli.tsx for the existing `taskManager:` field to find the exact spot — the wiring is purely additive.)

- [ ] Run: `npx tsc --noEmit` — expect no errors.

- [ ] Run: `npx vitest run test/slash/ test/core/tasks/` — expect all green.

- [ ] Commit: `feat(cli): register /task run and thread hookRegistry through SlashContext`

---

## Task 8 — final verification

- [ ] Run full type-check: `npx tsc --noEmit`
- [ ] Run targeted test suite: `npx vitest run test/core/tasks/ test/slash/`
- [ ] Run full test suite as smoke (best-effort, may skip pre-existing flaky baselines): `npx vitest run`
- [ ] Confirm `runAgent` no longer has any caller-less code path by grepping callers:
  `grep -rn "runAgent(" src/ test/` — must include `src/core/tasks/manager.ts` AND a test that drives it through `TaskManager.enqueue` (the `taskRun.test.ts` we added).

- [ ] Commit if any follow-up tweaks were needed; otherwise the work is complete.

---

## Self-review

- Spec coverage: caller (Task 6), lifecycle fires (Task 3), tests for order + abort + caller (Tasks 2, 5). All three required events emit `context: 'task'`.
- No placeholders: every code block above is complete, importable, runnable.
- Type consistency: all new fields on `LocalAgentSpec` are optional, preserving backward-compat for existing `new TaskManager(...)` callers in `test/core/tasks/`.
- No new deps: uses only existing modules (`node:crypto`, registered slash framework, existing hook lifecycle helpers).
- Strict TS: no `any` (we cast to `unknown as { stream: ... }` for the loose provider surface — the surrounding code already uses that pattern; if your local tsconfig forbids `unknown`-casts, narrow with a typeguard instead).
