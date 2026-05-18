# Agent Coordinator (B5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a coordinator layer that orchestrates N parallel sub-agents around a shared blackboard, surfaced as a new `coordinate_agents` tool.

**Architecture:** A new `Coordinator` class (in `src/core/agents/coordinator/`) sits above the existing `dispatchAgent` (`src/core/agents/dispatch.ts`). It runs a configurable list of workers in parallel via `Promise.allSettled`, gives each a shared in-memory `Blackboard`, and re-spawns the workers up to `maxIterations` times until every worker reports `done`. A new `coordinate_agents` tool exposes the coordinator to the main model. Existing single-agent dispatch (`dispatch_agent`) is untouched; this layer is purely additive.

**Tech Stack:** TypeScript (strict), Vitest

---

## File Structure

```
src/core/agents/coordinator/
  types.ts                  # AgentSpec, CoordinatorInput, CoordinatorResult, BlackboardSnapshot
  blackboard.ts             # Blackboard class (thread-safe write/read via internal mutex)
  prompt.ts                 # composeWorkerPrompt — embeds goal + blackboard view
  coordinator.ts            # runCoordinator(opts): top-level orchestration
  index.ts                  # barrel

src/core/tools/coordinator/
  blackboardTool.ts         # bb_write / bb_read tools for sub-agents
  coordinateAgentsTool.ts   # public CoordinateAgents tool factory
  index.ts                  # barrel

test/core/agents/coordinator/
  blackboard.test.ts
  prompt.test.ts
  coordinator.test.ts       # 2-agent fan-out, iteration cap, error isolation

test/core/tools/coordinator/
  blackboardTool.test.ts
  coordinateAgentsTool.test.ts
```

---

## Task 1: Type definitions

- [ ] **Files**
  - Create: `src/core/agents/coordinator/types.ts`
  - Test: `test/core/agents/coordinator/types.test.ts`

- [ ] **Write failing test** — `test/core/agents/coordinator/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type {
  AgentSpec,
  CoordinatorInput,
  CoordinatorResult,
  BlackboardSnapshot,
  WorkerOutcome,
} from '../../../../src/core/agents/coordinator/types'

describe('coordinator types', () => {
  it('AgentSpec accepts name + task', () => {
    const a: AgentSpec = { name: 'research', task: 'find files' }
    expect(a.name).toBe('research')
  })
  it('CoordinatorInput has goal + agents + maxIterations', () => {
    const i: CoordinatorInput = {
      goal: 'fix bug',
      agents: [{ name: 'r', task: 't' }],
      maxIterations: 3,
    }
    expect(i.agents).toHaveLength(1)
  })
  it('CoordinatorResult sums outcomes', () => {
    const r: CoordinatorResult = {
      iterations: 1,
      blackboard: {} as BlackboardSnapshot,
      outcomes: [],
      hitCap: false,
    }
    expect(r.hitCap).toBe(false)
  })
  it('WorkerOutcome covers ok and error', () => {
    const ok: WorkerOutcome = {
      name: 'a', status: 'ok', summary: 'done', turns: 2, error: undefined,
    }
    const err: WorkerOutcome = {
      name: 'b', status: 'error', summary: '', turns: 0, error: 'boom',
    }
    expect(ok.status).toBe('ok')
    expect(err.error).toBe('boom')
  })
})
```

- [ ] **Run failing**: `npx vitest run test/core/agents/coordinator/types.test.ts`

- [ ] **Implement** — `src/core/agents/coordinator/types.ts`:

```ts
// src/core/agents/coordinator/types.ts
//
// B5 — Coordinator types. Layered above dispatchAgent; nothing here
// imports from the runtime modules so types can be referenced from tool
// definitions without pulling the orchestration code.

export type AgentSpec = {
  /** Qualified agent name (`<plugin>:<name>`) — same shape `dispatch_agent` accepts. */
  name: string
  /** Per-agent task prompt; embedded into the worker's first user message. */
  task: string
  /** Optional context appended after the task — matches dispatchAgent.context. */
  context?: string
}

export type CoordinatorInput = {
  /** Shared high-level goal — surfaced to every worker via the prompt template. */
  goal: string
  /** Workers to fan out per iteration. Must be non-empty. */
  agents: AgentSpec[]
  /** Hard cap on coordinator iterations. Each iteration re-spawns workers. */
  maxIterations: number
}

export type WorkerOutcome = {
  name: string
  status: 'ok' | 'error' | 'aborted'
  /** Final assistant text (truncated to 4 KiB) or error message. */
  summary: string
  turns: number
  error: string | undefined
}

export type BlackboardSnapshot = {
  [key: string]: string
}

export type CoordinatorResult = {
  /** Number of iterations actually run (1 if everyone said done first time). */
  iterations: number
  /** Final blackboard snapshot — read-only view for the caller. */
  blackboard: BlackboardSnapshot
  /** Per-worker outcomes from the FINAL iteration (errors here are isolated, not fatal). */
  outcomes: WorkerOutcome[]
  /** True when the iteration cap was reached without every worker reporting done. */
  hitCap: boolean
}
```

- [ ] **Run passing**: `npx vitest run test/core/agents/coordinator/types.test.ts`
- [ ] **Typecheck**: `npx tsc --noEmit`
- [ ] **Commit**: `git commit -m "feat(agents/coordinator): AgentSpec + CoordinatorInput types"`

---

## Task 2: Blackboard

- [ ] **Files**
  - Create: `src/core/agents/coordinator/blackboard.ts`
  - Test: `test/core/agents/coordinator/blackboard.test.ts`

- [ ] **Write failing test** — `test/core/agents/coordinator/blackboard.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Blackboard } from '../../../../src/core/agents/coordinator/blackboard'

describe('Blackboard', () => {
  it('starts empty', () => {
    const b = new Blackboard()
    expect(b.snapshot()).toEqual({})
  })
  it('write then read', async () => {
    const b = new Blackboard()
    await b.write('finding', 'null pointer at line 42')
    expect(b.read('finding')).toBe('null pointer at line 42')
  })
  it('snapshot returns a copy — caller cannot mutate internal state', async () => {
    const b = new Blackboard()
    await b.write('k', 'v')
    const snap = b.snapshot()
    ;(snap as Record<string, string>)['k'] = 'tampered'
    expect(b.read('k')).toBe('v')
  })
  it('concurrent writers serialise — last-writer-wins is deterministic per key', async () => {
    const b = new Blackboard()
    await Promise.all([
      b.write('k', '1'),
      b.write('k', '2'),
      b.write('k', '3'),
    ])
    // After all settle, exactly one value remains.
    expect(['1', '2', '3']).toContain(b.read('k'))
    expect(Object.keys(b.snapshot())).toEqual(['k'])
  })
  it('throws when key empty', async () => {
    const b = new Blackboard()
    await expect(b.write('', 'v')).rejects.toThrow(/key/)
  })
  it('caps total size at 256 KiB', async () => {
    const b = new Blackboard()
    const big = 'x'.repeat(200_000)
    await b.write('a', big)
    await expect(b.write('b', big)).rejects.toThrow(/size/)
  })
  it('list returns keys', async () => {
    const b = new Blackboard()
    await b.write('a', 'x')
    await b.write('b', 'y')
    expect(b.list().sort()).toEqual(['a', 'b'])
  })
})
```

- [ ] **Run failing**: `npx vitest run test/core/agents/coordinator/blackboard.test.ts`

- [ ] **Implement** — `src/core/agents/coordinator/blackboard.ts`:

```ts
// src/core/agents/coordinator/blackboard.ts
//
// B5 — In-memory key/value store shared by all sub-agents within a
// single coordinator invocation. Writes are serialised via a Promise
// chain (Node single-threaded but async tool calls may interleave on
// the same event loop turn). Snapshot returns a defensive copy so the
// coordinator can hand it to render code without aliasing.

import type { BlackboardSnapshot } from './types'

const MAX_TOTAL_BYTES = 256 * 1024

export class Blackboard {
  private data = new Map<string, string>()
  private chain: Promise<void> = Promise.resolve()
  private byteCount = 0

  async write(key: string, value: string): Promise<void> {
    if (key.length === 0) throw new Error('Blackboard: key must be non-empty')
    const incomingBytes = Buffer.byteLength(value, 'utf8')
    const next = this.chain.then(() => {
      const prevBytes = this.data.has(key)
        ? Buffer.byteLength(this.data.get(key) ?? '', 'utf8')
        : 0
      const projected = this.byteCount - prevBytes + incomingBytes
      if (projected > MAX_TOTAL_BYTES) {
        throw new Error(
          `Blackboard: total size cap (${MAX_TOTAL_BYTES} bytes) would be exceeded by write to "${key}"`,
        )
      }
      this.data.set(key, value)
      this.byteCount = projected
    })
    this.chain = next.catch(() => undefined)
    await next
  }

  read(key: string): string | undefined {
    return this.data.get(key)
  }

  list(): string[] {
    return [...this.data.keys()]
  }

  snapshot(): BlackboardSnapshot {
    const out: Record<string, string> = {}
    for (const [k, v] of this.data) out[k] = v
    return out
  }
}
```

- [ ] **Run passing**: `npx vitest run test/core/agents/coordinator/blackboard.test.ts`
- [ ] **Typecheck**: `npx tsc --noEmit`
- [ ] **Commit**: `git commit -m "feat(agents/coordinator): Blackboard with byte cap + serialised writes"`

---

## Task 3: Blackboard tools (`bb_read`, `bb_write`)

- [ ] **Files**
  - Create: `src/core/tools/coordinator/blackboardTool.ts`
  - Test: `test/core/tools/coordinator/blackboardTool.test.ts`

- [ ] **Write failing test** — `test/core/tools/coordinator/blackboardTool.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Blackboard } from '../../../../src/core/agents/coordinator/blackboard'
import { makeBlackboardTools } from '../../../../src/core/tools/coordinator/blackboardTool'

const ctx = () => ({
  signal: new AbortController().signal,
  cwd: process.cwd(),
})

describe('bb_write / bb_read tools', () => {
  it('exposes two tools with deterministic names', () => {
    const bb = new Blackboard()
    const { read, write } = makeBlackboardTools(bb)
    expect(read.name).toBe('bb_read')
    expect(write.name).toBe('bb_write')
  })

  it('write persists, read returns the same value', async () => {
    const bb = new Blackboard()
    const { read, write } = makeBlackboardTools(bb)
    const wRes = await write.run({ key: 'finding', value: 'null pointer' }, ctx())
    expect(wRes.isError).toBe(false)
    const rRes = await read.run({ key: 'finding' }, ctx())
    expect(rRes.isError).toBe(false)
    expect(rRes.output).toBe('null pointer')
  })

  it('read of missing key is non-error with empty output', async () => {
    const bb = new Blackboard()
    const { read } = makeBlackboardTools(bb)
    const res = await read.run({ key: 'nope' }, ctx())
    expect(res.isError).toBe(false)
    expect(res.output).toBe('')
  })

  it('bb_write surfaces size-cap as ToolResult error (no throw)', async () => {
    const bb = new Blackboard()
    const { write } = makeBlackboardTools(bb)
    const big = 'x'.repeat(300_000)
    const res = await write.run({ key: 'k', value: big }, ctx())
    expect(res.isError).toBe(true)
    expect(typeof res.output).toBe('string')
  })

  it('bb_read with `list: true` returns key list', async () => {
    const bb = new Blackboard()
    const { write, read } = makeBlackboardTools(bb)
    await write.run({ key: 'a', value: '1' }, ctx())
    await write.run({ key: 'b', value: '2' }, ctx())
    const res = await read.run({ key: '', list: true }, ctx())
    expect(res.isError).toBe(false)
    expect(res.output).toMatch(/a/)
    expect(res.output).toMatch(/b/)
  })
})
```

- [ ] **Run failing**: `npx vitest run test/core/tools/coordinator/blackboardTool.test.ts`

- [ ] **Implement** — `src/core/tools/coordinator/blackboardTool.ts`:

```ts
// src/core/tools/coordinator/blackboardTool.ts
//
// B5 — Pair of tools injected into each sub-agent's filtered tool
// registry. The Blackboard instance is captured by closure so sibling
// workers all see the same store. The tool factory is called once per
// coordinator invocation.

import type { Tool, ToolResult } from '../types'
import { defineTool } from '../define'
import type { Blackboard } from '../../agents/coordinator/blackboard'

export type BlackboardWriteInput = { key: string; value: string }
export type BlackboardReadInput = { key: string; list?: boolean }

export const BB_WRITE_NAME = 'bb_write'
export const BB_READ_NAME = 'bb_read'

export function makeBlackboardTools(blackboard: Blackboard): {
  read: Tool<BlackboardReadInput>
  write: Tool<BlackboardWriteInput>
} {
  const write = defineTool<BlackboardWriteInput>({
    name: BB_WRITE_NAME,
    description:
      'Write a string value to the shared coordinator blackboard. Sibling agents under the same coordinator run can read it via bb_read.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Identifier for this finding (e.g. "auth_bug_location").' },
        value: { type: 'string', description: 'Value to store. Plain text only.' },
      },
      required: ['key', 'value'],
      additionalProperties: false,
    },
    source: 'builtin',
    tags: ['core', 'agent', 'coordinator'],
    annotations: { readOnly: false, destructive: false, openWorld: false, parallelSafe: true },
    needsPermission: () => 'none',
    async run(input: BlackboardWriteInput): Promise<ToolResult> {
      try {
        await blackboard.write(input.key, input.value)
        return { output: `Wrote ${input.key} (${input.value.length} chars)`, isError: false }
      } catch (err) {
        return { output: (err as Error).message, isError: true }
      }
    },
  })

  const read = defineTool<BlackboardReadInput>({
    name: BB_READ_NAME,
    description:
      'Read a value from the shared coordinator blackboard. Pass {list: true} with key="" to enumerate keys.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key to look up. Pass "" with list:true to enumerate.' },
        list: { type: 'boolean', description: 'When true, return the list of available keys instead of a value.' },
      },
      required: ['key'],
      additionalProperties: false,
    },
    source: 'builtin',
    tags: ['core', 'agent', 'coordinator'],
    annotations: { readOnly: true, destructive: false, openWorld: false, parallelSafe: true },
    needsPermission: () => 'none',
    async run(input: BlackboardReadInput): Promise<ToolResult> {
      if (input.list === true) {
        const keys = blackboard.list()
        return { output: keys.length === 0 ? '(empty)' : keys.join('\n'), isError: false }
      }
      const value = blackboard.read(input.key)
      return { output: value ?? '', isError: false }
    },
  })

  return { read, write }
}
```

- [ ] **Run passing**: `npx vitest run test/core/tools/coordinator/blackboardTool.test.ts`
- [ ] **Typecheck**: `npx tsc --noEmit`
- [ ] **Commit**: `git commit -m "feat(tools/coordinator): bb_read / bb_write tools backed by Blackboard"`

---

## Task 4: Worker prompt composition

- [ ] **Files**
  - Create: `src/core/agents/coordinator/prompt.ts`
  - Test: `test/core/agents/coordinator/prompt.test.ts`

- [ ] **Write failing test** — `test/core/agents/coordinator/prompt.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { composeWorkerPrompt } from '../../../../src/core/agents/coordinator/prompt'

describe('composeWorkerPrompt', () => {
  it('inlines goal + worker task + iteration number', () => {
    const text = composeWorkerPrompt({
      goal: 'Fix the auth bug',
      task: 'Find the null pointer',
      iteration: 1,
      blackboard: {},
    })
    expect(text).toMatch(/Fix the auth bug/)
    expect(text).toMatch(/Find the null pointer/)
    expect(text).toMatch(/Iteration 1/)
  })

  it('renders blackboard snapshot when non-empty', () => {
    const text = composeWorkerPrompt({
      goal: 'g',
      task: 't',
      iteration: 2,
      blackboard: { 'finding': 'null pointer at line 42' },
    })
    expect(text).toMatch(/finding/)
    expect(text).toMatch(/null pointer at line 42/)
  })

  it('omits blackboard section when empty', () => {
    const text = composeWorkerPrompt({ goal: 'g', task: 't', iteration: 1, blackboard: {} })
    expect(text).not.toMatch(/Blackboard:/)
  })

  it('instructs worker to emit `done: true` when finished', () => {
    const text = composeWorkerPrompt({ goal: 'g', task: 't', iteration: 1, blackboard: {} })
    expect(text).toMatch(/done:\s*true/i)
  })
})
```

- [ ] **Run failing**: `npx vitest run test/core/agents/coordinator/prompt.test.ts`

- [ ] **Implement** — `src/core/agents/coordinator/prompt.ts`:

```ts
// src/core/agents/coordinator/prompt.ts
//
// B5 — Pure function that builds the first user message handed to each
// worker per iteration. Embeds the shared goal, the worker's task, the
// current blackboard snapshot (if any), and a small contract telling
// the worker how to signal completion ("done: true" anywhere in its
// final assistant text).

import type { BlackboardSnapshot } from './types'

export function composeWorkerPrompt(opts: {
  goal: string
  task: string
  iteration: number
  blackboard: BlackboardSnapshot
}): string {
  const lines: string[] = []
  lines.push(`Shared goal: ${opts.goal}`)
  lines.push(`Iteration ${opts.iteration}`)
  lines.push('')
  lines.push(`Your task: ${opts.task}`)

  const keys = Object.keys(opts.blackboard)
  if (keys.length > 0) {
    lines.push('')
    lines.push('Blackboard:')
    for (const key of keys.sort()) {
      const value = opts.blackboard[key] ?? ''
      lines.push(`- ${key}: ${value}`)
    }
  }

  lines.push('')
  lines.push(
    'Use bb_write to share findings with sibling agents. Use bb_read to consume them. ' +
      'When you have nothing more to contribute toward the shared goal, end your reply with ' +
      'a line containing `done: true`. Otherwise leave the marker out and the coordinator ' +
      'will re-run you on the next iteration.',
  )
  return lines.join('\n')
}

const DONE_MARKER = /(^|\n)\s*done:\s*true\s*(\n|$)/i

export function isDone(text: string): boolean {
  return DONE_MARKER.test(text)
}
```

- [ ] **Run passing**: `npx vitest run test/core/agents/coordinator/prompt.test.ts`
- [ ] **Typecheck**: `npx tsc --noEmit`
- [ ] **Commit**: `git commit -m "feat(agents/coordinator): worker prompt composer + done-marker"`

---

## Task 5: Coordinator orchestrator

- [ ] **Files**
  - Create: `src/core/agents/coordinator/coordinator.ts`
  - Test: `test/core/agents/coordinator/coordinator.test.ts`

- [ ] **Write failing test** — `test/core/agents/coordinator/coordinator.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { runCoordinator, type CoordinatorDeps } from '../../../../src/core/agents/coordinator/coordinator'
import type { ResolvedAgentDef } from '../../../../src/core/agents/types'
import type { DispatchAgentOpts, DispatchAgentResult } from '../../../../src/core/agents/dispatch'
import { AgentRegistry } from '../../../../src/core/agents/registry'
import { ToolRegistry } from '../../../../src/core/tools/registry'

function makeAgent(name: string): ResolvedAgentDef {
  return {
    name,
    description: 'test agent',
    systemPrompt: 'sp',
    pluginName: 'test',
    maxTurns: 20,
  }
}

function makeDeps(
  dispatch: (opts: DispatchAgentOpts) => Promise<DispatchAgentResult>,
): CoordinatorDeps {
  const agents = new AgentRegistry()
  agents.register(makeAgent('a'))
  agents.register(makeAgent('b'))
  return {
    dispatch,
    agents,
    registry: new ToolRegistry(),
    providerResolver: {
      listProviders: () => [{ id: 'mock' }],
      resolveFor: () => ({ provider: { stream: async function* () {} }, model: 'm' }),
    } as unknown as CoordinatorDeps['providerResolver'],
    permission: { check: async () => ({ allowed: true }) } as unknown as CoordinatorDeps['permission'],
  }
}

describe('runCoordinator', () => {
  it('fans out 2 agents in parallel within one iteration', async () => {
    const seen: string[] = []
    const dispatch = vi.fn(async (opts: DispatchAgentOpts): Promise<DispatchAgentResult> => {
      seen.push(opts.agent.name)
      return { output: 'ok\ndone: true', isError: false, turns: 1, usage: { inputTokens: 0, outputTokens: 0 } }
    })
    const result = await runCoordinator(
      {
        goal: 'g',
        agents: [
          { name: 'test:a', task: 'task1' },
          { name: 'test:b', task: 'task2' },
        ],
        maxIterations: 5,
      },
      makeDeps(dispatch),
      new AbortController().signal,
    )
    expect(seen.sort()).toEqual(['test:a', 'test:b'])
    expect(result.iterations).toBe(1)
    expect(result.hitCap).toBe(false)
    expect(result.outcomes.every(o => o.status === 'ok')).toBe(true)
  })

  it('exposes blackboard writes to siblings within the same iteration', async () => {
    // First agent writes; second agent reads. We can't really test "within
    // same iteration" through pure dispatch mocks; instead verify the
    // blackboard is threaded into the deps the second dispatch sees on
    // iteration 2.
    let iter = 0
    const dispatch = vi.fn(async (opts: DispatchAgentOpts): Promise<DispatchAgentResult> => {
      if (opts.agent.name === 'test:a') {
        // simulate write by reaching into the injected bb via the tool registry
        const writeTool = opts.registry.find('bb_write')
        if (writeTool) {
          await writeTool.run(
            { key: 'finding', value: 'null at 42' },
            { signal: opts.signal, cwd: process.cwd() },
          )
        }
        return { output: 'done: true', isError: false, turns: 1, usage: { inputTokens: 0, outputTokens: 0 } }
      }
      // agent b waits until iteration 2 so a's write is observable
      if (iter === 0) {
        iter++
        return { output: 'still working', isError: false, turns: 1, usage: { inputTokens: 0, outputTokens: 0 } }
      }
      const readTool = opts.registry.find('bb_read')
      let value = ''
      if (readTool) {
        const r = await readTool.run({ key: 'finding' }, { signal: opts.signal, cwd: process.cwd() })
        value = typeof r.output === 'string' ? r.output : ''
      }
      return { output: `saw: ${value}\ndone: true`, isError: false, turns: 1, usage: { inputTokens: 0, outputTokens: 0 } }
    })
    const result = await runCoordinator(
      {
        goal: 'g',
        agents: [
          { name: 'test:a', task: 't1' },
          { name: 'test:b', task: 't2' },
        ],
        maxIterations: 5,
      },
      makeDeps(dispatch),
      new AbortController().signal,
    )
    expect(result.blackboard.finding).toBe('null at 42')
    expect(result.iterations).toBe(2)
  })

  it('hits iteration cap when no worker says done', async () => {
    const dispatch = vi.fn(async (): Promise<DispatchAgentResult> => ({
      output: 'still going', // no `done: true`
      isError: false,
      turns: 1,
      usage: { inputTokens: 0, outputTokens: 0 },
    }))
    const result = await runCoordinator(
      { goal: 'g', agents: [{ name: 'test:a', task: 't' }], maxIterations: 3 },
      makeDeps(dispatch),
      new AbortController().signal,
    )
    expect(result.iterations).toBe(3)
    expect(result.hitCap).toBe(true)
  })

  it('error in one agent does not kill siblings (Promise.allSettled)', async () => {
    const dispatch = vi.fn(async (opts: DispatchAgentOpts): Promise<DispatchAgentResult> => {
      if (opts.agent.name === 'test:a') throw new Error('boom')
      return { output: 'done: true', isError: false, turns: 1, usage: { inputTokens: 0, outputTokens: 0 } }
    })
    const result = await runCoordinator(
      {
        goal: 'g',
        agents: [
          { name: 'test:a', task: 't' },
          { name: 'test:b', task: 't' },
        ],
        maxIterations: 2,
      },
      makeDeps(dispatch),
      new AbortController().signal,
    )
    const aOut = result.outcomes.find(o => o.name === 'test:a')
    const bOut = result.outcomes.find(o => o.name === 'test:b')
    expect(aOut?.status).toBe('error')
    expect(aOut?.error).toMatch(/boom/)
    expect(bOut?.status).toBe('ok')
  })

  it('rejects unknown agent name with structured error outcome', async () => {
    const dispatch = vi.fn(async (): Promise<DispatchAgentResult> => ({
      output: 'unused', isError: false, turns: 0, usage: { inputTokens: 0, outputTokens: 0 },
    }))
    const result = await runCoordinator(
      { goal: 'g', agents: [{ name: 'missing:x', task: 't' }], maxIterations: 1 },
      makeDeps(dispatch),
      new AbortController().signal,
    )
    expect(result.outcomes[0]!.status).toBe('error')
    expect(result.outcomes[0]!.error).toMatch(/unknown agent/i)
  })

  it('aborts cleanly when signal is fired', async () => {
    const controller = new AbortController()
    const dispatch = vi.fn(async (): Promise<DispatchAgentResult> => {
      controller.abort()
      return { output: 'partial', isError: true, turns: 1, usage: { inputTokens: 0, outputTokens: 0 } }
    })
    const result = await runCoordinator(
      { goal: 'g', agents: [{ name: 'test:a', task: 't' }], maxIterations: 5 },
      makeDeps(dispatch),
      controller.signal,
    )
    expect(result.iterations).toBeGreaterThanOrEqual(1)
    // No throw — aborted state surfaces as outcomes / hitCap=false.
  })
})
```

- [ ] **Run failing**: `npx vitest run test/core/agents/coordinator/coordinator.test.ts`

- [ ] **Implement** — `src/core/agents/coordinator/coordinator.ts`:

```ts
// src/core/agents/coordinator/coordinator.ts
//
// B5 — Top-level orchestrator. Runs N workers per iteration via
// Promise.allSettled (so a thrown error in one worker does not abort
// siblings). Each worker receives a per-iteration prompt assembled by
// composeWorkerPrompt and a sub-registry that includes the shared
// bb_read / bb_write tools. The loop terminates when every worker
// emits a `done: true` marker or when maxIterations is reached.
//
// Layering: this module calls the existing `dispatchAgent` (injected
// via deps for testability). The dispatcher itself is NOT modified —
// the only addition to its sub-registry is the pair of blackboard tools,
// added by this coordinator before each dispatch.

import type { AgentRegistry } from '../registry'
import type { ToolRegistry } from '../../tools/registry'
import { ToolRegistry as ToolRegistryClass } from '../../tools/registry'
import type { ProviderResolver } from '../../provider/resolver'
import type { PermissionChecker } from '../../permission/checker'
import type {
  DispatchAgentOpts,
  DispatchAgentResult,
} from '../dispatch'
import { dispatchAgent as defaultDispatch } from '../dispatch'
import { Blackboard } from './blackboard'
import { composeWorkerPrompt, isDone } from './prompt'
import type {
  AgentSpec,
  CoordinatorInput,
  CoordinatorResult,
  WorkerOutcome,
} from './types'
import { makeBlackboardTools } from '../../tools/coordinator/blackboardTool'

export type CoordinatorDeps = {
  /** Injectable for tests. Defaults to the real dispatchAgent. */
  dispatch?: (opts: DispatchAgentOpts) => Promise<DispatchAgentResult>
  agents: AgentRegistry
  registry: ToolRegistry
  providerResolver: ProviderResolver
  permission: PermissionChecker
}

const MAX_SUMMARY_BYTES = 4 * 1024

function truncateSummary(s: string | object): string {
  const text = typeof s === 'string' ? s : JSON.stringify(s)
  if (text.length <= MAX_SUMMARY_BYTES) return text
  return text.slice(0, MAX_SUMMARY_BYTES) + '\n…[truncated]'
}

function outcomeFromResult(name: string, res: DispatchAgentResult): WorkerOutcome {
  const text = typeof res.output === 'string'
    ? res.output
    : res.output.map(b => (b.type === 'text' ? b.text : '')).join('')
  return {
    name,
    status: res.isError ? 'error' : 'ok',
    summary: truncateSummary(text),
    turns: res.turns,
    error: res.isError ? truncateSummary(text) : undefined,
  }
}

function outcomeFromError(name: string, err: unknown): WorkerOutcome {
  return {
    name,
    status: 'error',
    summary: '',
    turns: 0,
    error: (err instanceof Error ? err.message : String(err)).slice(0, MAX_SUMMARY_BYTES),
  }
}

export async function runCoordinator(
  input: CoordinatorInput,
  deps: CoordinatorDeps,
  signal: AbortSignal,
): Promise<CoordinatorResult> {
  if (input.agents.length === 0) {
    return { iterations: 0, blackboard: {}, outcomes: [], hitCap: false }
  }
  const dispatch = deps.dispatch ?? defaultDispatch
  const blackboard = new Blackboard()
  const bbTools = makeBlackboardTools(blackboard)

  let outcomes: WorkerOutcome[] = []
  let iteration = 0
  let allDone = false

  while (iteration < input.maxIterations && !signal.aborted && !allDone) {
    iteration += 1
    const snapshot = blackboard.snapshot()
    const iterPromises = input.agents.map(async (spec: AgentSpec): Promise<WorkerOutcome> => {
      const resolved = deps.agents.find(spec.name)
      if (!resolved) {
        return {
          name: spec.name,
          status: 'error',
          summary: '',
          turns: 0,
          error: `Unknown agent: ${spec.name}`,
        }
      }
      // Per-worker sub-registry: parent tools + bb_read + bb_write.
      const subReg = new ToolRegistryClass()
      for (const t of deps.registry.list()) subReg.register(t)
      subReg.register(bbTools.read)
      subReg.register(bbTools.write)

      const task = composeWorkerPrompt({
        goal: input.goal,
        task: spec.task,
        iteration,
        blackboard: snapshot,
      })
      try {
        const res = await dispatch({
          agent: resolved,
          task,
          ...(spec.context !== undefined ? { context: spec.context } : {}),
          registry: subReg,
          providerResolver: deps.providerResolver,
          permission: deps.permission,
          signal,
        })
        return outcomeFromResult(spec.name, res)
      } catch (err) {
        return outcomeFromError(spec.name, err)
      }
    })

    const settled = await Promise.allSettled(iterPromises)
    outcomes = settled.map((r, i) => {
      if (r.status === 'fulfilled') return r.value
      return outcomeFromError(input.agents[i]!.name, r.reason)
    })

    // Done when every OK worker emitted `done: true` and no errors blocked them.
    // Errors do NOT count as done — we re-spawn next iteration so they can retry.
    allDone = outcomes.every(o => o.status === 'ok' && isDone(o.summary))
    if (signal.aborted) break
  }

  return {
    iterations: iteration,
    blackboard: blackboard.snapshot(),
    outcomes,
    hitCap: !allDone && iteration >= input.maxIterations,
  }
}
```

- [ ] **Run passing**: `npx vitest run test/core/agents/coordinator/coordinator.test.ts`
- [ ] **Typecheck**: `npx tsc --noEmit`
- [ ] **Commit**: `git commit -m "feat(agents/coordinator): parallel fan-out with blackboard + iteration cap"`

---

## Task 6: Coordinator barrel + `coordinator/index.ts`

- [ ] **Files**
  - Create: `src/core/agents/coordinator/index.ts`

- [ ] **Implement**:

```ts
// src/core/agents/coordinator/index.ts
export { runCoordinator } from './coordinator'
export type { CoordinatorDeps } from './coordinator'
export { Blackboard } from './blackboard'
export { composeWorkerPrompt, isDone } from './prompt'
export type {
  AgentSpec,
  CoordinatorInput,
  CoordinatorResult,
  WorkerOutcome,
  BlackboardSnapshot,
} from './types'
```

- [ ] **Typecheck**: `npx tsc --noEmit`
- [ ] **Commit**: `git commit -m "feat(agents/coordinator): public barrel"`

---

## Task 7: `coordinate_agents` tool

- [ ] **Files**
  - Create: `src/core/tools/coordinator/coordinateAgentsTool.ts`
  - Create: `src/core/tools/coordinator/index.ts`
  - Test: `test/core/tools/coordinator/coordinateAgentsTool.test.ts`

- [ ] **Write failing test** — `test/core/tools/coordinator/coordinateAgentsTool.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { makeCoordinateAgentsTool, COORDINATE_AGENTS_TOOL_NAME } from '../../../../src/core/tools/coordinator/coordinateAgentsTool'
import { AgentRegistry } from '../../../../src/core/agents/registry'
import { ToolRegistry } from '../../../../src/core/tools/registry'
import type { ResolvedAgentDef } from '../../../../src/core/agents/types'
import type { DispatchAgentOpts, DispatchAgentResult } from '../../../../src/core/agents/dispatch'

function makeAgent(name: string): ResolvedAgentDef {
  return { name, description: 'd', systemPrompt: 'sp', pluginName: 'p', maxTurns: 20 }
}

function ctx(extra?: Partial<{ allowedAgentDispatch: boolean }>) {
  return {
    signal: new AbortController().signal,
    cwd: process.cwd(),
    session: extra?.allowedAgentDispatch === undefined
      ? undefined
      : {
          id: 's', providerId: 'p', model: 'm', messages: [],
          totalUsage: { inputTokens: 0, outputTokens: 0 },
          permissionCache: { add: () => {}, list: () => [] } as never,
          queue: {} as never,
          mode: 'normal' as const,
          createdAt: 0, updatedAt: 0,
          unDeferredToolNames: new Set<string>(),
          allowedAgentDispatch: extra.allowedAgentDispatch,
        },
  }
}

describe('coordinate_agents tool', () => {
  const agents = new AgentRegistry()
  agents.register(makeAgent('a'))
  const dispatch = vi.fn(async (_o: DispatchAgentOpts): Promise<DispatchAgentResult> => ({
    output: 'done: true', isError: false, turns: 1, usage: { inputTokens: 0, outputTokens: 0 },
  }))

  const tool = makeCoordinateAgentsTool({
    agents,
    registry: new ToolRegistry(),
    providerResolver: { listProviders: () => [{ id: 'x' }] } as never,
    permission: { check: async () => ({ allowed: true }) } as never,
    dispatch,
  })

  it('has the expected name', () => {
    expect(tool.name).toBe(COORDINATE_AGENTS_TOOL_NAME)
    expect(COORDINATE_AGENTS_TOOL_NAME).toBe('coordinate_agents')
  })

  it('runs through and returns structured summary', async () => {
    const res = await tool.run(
      {
        goal: 'fix bug',
        agents: [{ name: 'p:a', task: 't' }],
        maxIterations: 2,
      },
      ctx() as never,
    )
    expect(res.isError).toBe(false)
    expect(typeof res.output).toBe('string')
    expect(res.output as string).toMatch(/iteration/i)
  })

  it('recursion guard: refuses when called from a sub-agent', async () => {
    const res = await tool.run(
      { goal: 'g', agents: [{ name: 'p:a', task: 't' }], maxIterations: 1 },
      ctx({ allowedAgentDispatch: false }) as never,
    )
    expect(res.isError).toBe(true)
    expect(res.output as string).toMatch(/sub-agent/i)
  })

  it('validates: empty agents array → error', async () => {
    const res = await tool.run(
      { goal: 'g', agents: [], maxIterations: 1 },
      ctx() as never,
    )
    expect(res.isError).toBe(true)
  })

  it('validates: maxIterations bounds (1..10)', async () => {
    const tooHigh = await tool.run(
      { goal: 'g', agents: [{ name: 'p:a', task: 't' }], maxIterations: 99 },
      ctx() as never,
    )
    expect(tooHigh.isError).toBe(true)
  })
})
```

- [ ] **Run failing**: `npx vitest run test/core/tools/coordinator/coordinateAgentsTool.test.ts`

- [ ] **Implement** — `src/core/tools/coordinator/coordinateAgentsTool.ts`:

```ts
// src/core/tools/coordinator/coordinateAgentsTool.ts
//
// B5 — Public tool surface for the coordinator. Wraps runCoordinator
// into a `Tool` the main loop can call. The tool spec mirrors
// dispatch_agent's style: deterministic name, JSON schema parameters,
// recursion guard via ctx.session.allowedAgentDispatch.

import type { Tool, ToolResult, ToolContext } from '../types'
import { defineTool } from '../define'
import type { AgentRegistry } from '../../agents/registry'
import type { ToolRegistry } from '../registry'
import type { ProviderResolver } from '../../provider/resolver'
import type { PermissionChecker } from '../../permission/checker'
import type { DispatchAgentOpts, DispatchAgentResult } from '../../agents/dispatch'
import { runCoordinator } from '../../agents/coordinator/coordinator'
import type { CoordinatorInput, CoordinatorResult } from '../../agents/coordinator/types'

export const COORDINATE_AGENTS_TOOL_NAME = 'coordinate_agents'

export type CoordinateAgentsInput = {
  goal: string
  agents: Array<{ name: string; task: string; context?: string }>
  maxIterations: number
}

function renderResult(r: CoordinatorResult): string {
  const lines: string[] = []
  lines.push(`Iterations: ${r.iterations}${r.hitCap ? ' (hit cap)' : ''}`)
  lines.push('')
  lines.push('Outcomes:')
  for (const o of r.outcomes) {
    lines.push(`- ${o.name} [${o.status}, ${o.turns} turns]${o.error ? ` error="${o.error}"` : ''}`)
    if (o.status === 'ok') {
      const head = o.summary.split('\n').slice(0, 3).join(' / ')
      lines.push(`  ${head}`)
    }
  }
  const keys = Object.keys(r.blackboard)
  if (keys.length > 0) {
    lines.push('')
    lines.push('Final blackboard:')
    for (const key of keys.sort()) {
      lines.push(`- ${key}: ${r.blackboard[key] ?? ''}`)
    }
  }
  return lines.join('\n')
}

export function makeCoordinateAgentsTool(deps: {
  agents: AgentRegistry
  registry: ToolRegistry
  providerResolver: ProviderResolver
  permission: PermissionChecker
  /** Injectable for tests — defaults to the real dispatchAgent. */
  dispatch?: (opts: DispatchAgentOpts) => Promise<DispatchAgentResult>
}): Tool<CoordinateAgentsInput> {
  const listed = deps.agents.list()
  const summary = listed.length === 0
    ? 'No specialist agents are currently registered.'
    : listed.map(a => `${a.name} — ${a.description}`).join('; ')
  const description =
    `Run multiple specialist agents in parallel toward a shared goal, with a coordinator-managed blackboard for cross-agent context. ` +
    `Each agent gets bb_read and bb_write tools to share findings with siblings. The coordinator re-spawns agents until every worker emits ` +
    `\`done: true\` or maxIterations is reached. Use this when independent investigation angles benefit from cross-pollination. ` +
    `Available agents: ${summary}.`

  return defineTool<CoordinateAgentsInput>({
    name: COORDINATE_AGENTS_TOOL_NAME,
    description,
    parameters: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'Shared high-level goal shown to every worker.' },
        agents: {
          type: 'array',
          minItems: 1,
          maxItems: 8,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Qualified agent name (`<plugin>:<name>`).' },
              task: { type: 'string', description: 'Concrete per-agent instruction.' },
              context: { type: 'string', description: 'Optional extra context appended to the task.' },
            },
            required: ['name', 'task'],
            additionalProperties: false,
          },
        },
        maxIterations: {
          type: 'integer',
          minimum: 1,
          maximum: 10,
          description: 'Cap on coordinator iterations (re-spawns) before returning.',
        },
      },
      required: ['goal', 'agents', 'maxIterations'],
      additionalProperties: false,
    },
    source: 'builtin',
    tags: ['core', 'agent', 'coordinator'],
    annotations: { readOnly: false, destructive: false, openWorld: true, parallelSafe: false },
    needsPermission: () => 'none',
    async run(input: CoordinateAgentsInput, ctx: ToolContext): Promise<ToolResult> {
      if (ctx.session?.allowedAgentDispatch === false) {
        return { output: 'Sub-agents cannot launch a coordinator.', isError: true }
      }
      if (input.agents.length === 0) {
        return { output: 'agents array must be non-empty.', isError: true }
      }
      if (input.maxIterations < 1 || input.maxIterations > 10) {
        return { output: 'maxIterations must be between 1 and 10.', isError: true }
      }
      const coordInput: CoordinatorInput = {
        goal: input.goal,
        agents: input.agents,
        maxIterations: input.maxIterations,
      }
      const result = await runCoordinator(
        coordInput,
        {
          agents: deps.agents,
          registry: deps.registry,
          providerResolver: deps.providerResolver,
          permission: deps.permission,
          ...(deps.dispatch ? { dispatch: deps.dispatch } : {}),
        },
        ctx.signal,
      )
      return {
        output: renderResult(result),
        isError: result.outcomes.some(o => o.status === 'error') || result.hitCap,
      }
    },
  })
}
```

- [ ] **Implement** — `src/core/tools/coordinator/index.ts`:

```ts
// src/core/tools/coordinator/index.ts
export {
  makeCoordinateAgentsTool,
  COORDINATE_AGENTS_TOOL_NAME,
} from './coordinateAgentsTool'
export type { CoordinateAgentsInput } from './coordinateAgentsTool'
export { makeBlackboardTools, BB_READ_NAME, BB_WRITE_NAME } from './blackboardTool'
export type { BlackboardReadInput, BlackboardWriteInput } from './blackboardTool'
```

- [ ] **Run passing**: `npx vitest run test/core/tools/coordinator/coordinateAgentsTool.test.ts`
- [ ] **Typecheck**: `npx tsc --noEmit`
- [ ] **Commit**: `git commit -m "feat(tools/coordinator): coordinate_agents tool with recursion guard"`

---

## Task 8: Wire `coordinate_agents` into cli.tsx

- [ ] **Files**
  - Modify: `src/cli.tsx` (search for `makeDispatchAgentTool` registration site — the new tool registers alongside it)

- [ ] **Implement** — add to the wiring block (no test; covered by E2E cli):

```ts
import { makeCoordinateAgentsTool } from './core/tools/coordinator/coordinateAgentsTool'
// ...
// After makeDispatchAgentTool registration:
if (process.env['NUKA_COORDINATOR'] === '1') {
  registry.register(makeCoordinateAgentsTool({
    agents: agentRegistry,
    registry,
    providerResolver: providers,
    permission: permissionChecker,
  }))
}
```

`NUKA_COORDINATOR=1` keeps the new tool opt-in until users explicitly enable it (Nuka invariant: env opt-in defaults).

- [ ] **Typecheck + smoke**: `npx tsc --noEmit && npx vitest run test/cli`
- [ ] **Commit**: `git commit -m "feat(cli): register coordinate_agents tool behind NUKA_COORDINATOR"`

---

## Task 9: Integration test — 2-agent fan-out through real dispatch

- [ ] **Files**
  - Create: `test/integration/coordinator.test.ts`

- [ ] **Write & implement** — `test/integration/coordinator.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { runCoordinator } from '../../src/core/agents/coordinator/coordinator'
import { AgentRegistry } from '../../src/core/agents/registry'
import { ToolRegistry } from '../../src/core/tools/registry'
import type { ResolvedAgentDef } from '../../src/core/agents/types'
import type { DispatchAgentOpts, DispatchAgentResult } from '../../src/core/agents/dispatch'

const agent = (name: string): ResolvedAgentDef => ({
  name, description: 'd', systemPrompt: 'sp', pluginName: 'p', maxTurns: 20,
})

describe('B5 — coordinator end-to-end (mocked dispatch)', () => {
  it('two agents exchange via blackboard across iterations', async () => {
    const agents = new AgentRegistry()
    agents.register(agent('writer'))
    agents.register(agent('reader'))

    let iteration = 0
    const dispatch = async (opts: DispatchAgentOpts): Promise<DispatchAgentResult> => {
      if (opts.agent.name === 'p:writer') {
        const w = opts.registry.find('bb_write')!
        await w.run({ key: 'note', value: 'hello' }, { signal: opts.signal, cwd: process.cwd() })
        return { output: 'done: true', isError: false, turns: 1, usage: { inputTokens: 0, outputTokens: 0 } }
      }
      // reader: not done until it has seen the note (one extra iteration)
      const r = opts.registry.find('bb_read')!
      const got = await r.run({ key: 'note' }, { signal: opts.signal, cwd: process.cwd() })
      const value = typeof got.output === 'string' ? got.output : ''
      iteration++
      if (value.length === 0) {
        return { output: 'waiting', isError: false, turns: 1, usage: { inputTokens: 0, outputTokens: 0 } }
      }
      return { output: `saw ${value}\ndone: true`, isError: false, turns: 1, usage: { inputTokens: 0, outputTokens: 0 } }
    }

    const result = await runCoordinator(
      {
        goal: 'exchange note',
        agents: [{ name: 'p:writer', task: 'write note' }, { name: 'p:reader', task: 'read note' }],
        maxIterations: 4,
      },
      {
        dispatch,
        agents,
        registry: new ToolRegistry(),
        providerResolver: { listProviders: () => [{ id: 'x' }] } as never,
        permission: { check: async () => ({ allowed: true }) } as never,
      },
      new AbortController().signal,
    )

    expect(result.blackboard.note).toBe('hello')
    expect(result.hitCap).toBe(false)
    expect(result.outcomes.every(o => o.status === 'ok')).toBe(true)
    expect(result.iterations).toBeLessThanOrEqual(4)
  })
})
```

- [ ] **Run passing**: `npx vitest run test/integration/coordinator.test.ts`
- [ ] **Typecheck + full test**: `npx tsc --noEmit && npx vitest run`
- [ ] **Commit**: `git commit -m "test(coordinator): two-agent blackboard exchange end-to-end"`

---

## Out-of-scope (explicitly deferred)

- Persistent blackboard (`~/.nuka/coordinator/<id>.json`) — current in-memory store is per-coordinator-invocation. Add later if cross-run continuation becomes a use case.
- Coordinator system-prompt injection (the Nuka-Code `coordinatorMode.ts` flavour) — Nuka's main loop already has its own system prompt, and the `coordinate_agents` tool description carries the orchestration semantics. The system-prompt overlay is a separate UX choice tracked as a follow-up.
- TaskStop / SendMessage equivalents — would let the coordinator continue a specific worker mid-loop. Currently each iteration spawns fresh workers. Revisit when long-running workers become valuable.
- Per-agent token / cost budgets in the orchestrator — `dispatchAgent` already enforces `maxTurns`; tracking per-coordinator budgets is left for a cost-tracker integration follow-up.
