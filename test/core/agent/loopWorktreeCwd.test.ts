// test/core/agent/loopWorktreeCwd.test.ts
//
// P1 #6 — Worktree cwdOverride wiring integration test.
//
// Verifies that when a WorktreeStore is threaded into runAgent deps:
//   1. Tools run with `ctx.cwd === process.cwd()` while no worktree is
//      active (default behaviour, unchanged).
//   2. EnterWorktree's `setActive` side effect lands on the very next
//      tool call's `ctx.cwd` (per turn, since EnterWorktree completes
//      its own turn before the model emits another tool call).
//   3. ExitWorktree (via `store.remove`) restores `ctx.cwd` to
//      `process.cwd()` on the subsequent tool call.
//
// All git side effects are stubbed via a fake `GitRunner`; the real
// `process.cwd()` is used as the fallback so we don't rely on running
// inside a worktree.

import { describe, it, expect } from 'vitest'
import { runAgent } from '../../../src/core/agent/loop'
import { createSession } from '../../../src/core/session/session'
import type { LLMProvider, ProviderEvent } from '../../../src/core/provider/types'
import { ToolRegistry } from '../../../src/core/tools/registry'
import { PermissionChecker } from '../../../src/core/permission/checker'
import { createWorktreeStore } from '../../../src/core/worktree/store'
import {
  makeEnterWorktreeTool,
  makeExitWorktreeTool,
} from '../../../src/core/worktree/tools'
import type { GitRunner, GitResult } from '../../../src/core/worktree/git'
import type { Tool } from '../../../src/core/tools/types'

function stubProvider(scripts: ProviderEvent[][]): LLMProvider {
  let i = 0
  return {
    id: 'p',
    format: 'openai',
    async *stream() {
      const script = scripts[i++] ?? []
      for (const ev of script) yield ev
    },
    async listRemoteModels() { return [] },
  } as LLMProvider
}

/** Fake git runner that pretends `/repo` is always the toplevel. */
function fakeGitRunner(): GitRunner {
  return (args, _opts): GitResult => {
    if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
      return { code: 0, stdout: '/repo\n', stderr: '' }
    }
    if (args[0] === 'worktree' && (args[1] === 'add' || args[1] === 'remove')) {
      return { code: 0, stdout: '', stderr: '' }
    }
    return { code: 1, stdout: '', stderr: 'unhandled args' }
  }
}

/**
 * Spy tool that records every cwd it was invoked with. Read-only so
 * canParallelize doesn't kick in for a single call (it requires ≥2).
 */
function makeSpyTool(label: string, sink: { name: string; cwd: string }[]): Tool {
  return {
    name: label,
    description: 'spy tool',
    parameters: { type: 'object', properties: {} },
    source: 'builtin',
    tags: ['core'],
    annotations: { readOnly: false }, // serial path
    needsPermission: () => 'none',
    run: async (_input, ctx) => {
      sink.push({ name: label, cwd: ctx.cwd })
      return { output: `${label} ran in ${ctx.cwd}`, isError: false }
    },
  }
}

describe('runAgent worktree cwd override (P1 #6)', () => {
  it('routes ctx.cwd through the active worktree across turns', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    const sink: { name: string; cwd: string }[] = []
    const store = createWorktreeStore()
    const gitRunner = fakeGitRunner()

    const tools = new ToolRegistry()
    tools.register(makeSpyTool('Spy', sink))
    tools.register(makeEnterWorktreeTool({ store, gitRunner }))
    tools.register(makeExitWorktreeTool({ store, gitRunner }))

    // Turn 1: model calls Spy first (baseline cwd).
    const turn1: ProviderEvent[] = [
      { type: 'tool_use_start', id: 's1', name: 'Spy' },
      { type: 'tool_use_stop', id: 's1', input: {} },
      { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 } },
    ]
    // Turn 2: model calls EnterWorktree.
    const turn2: ProviderEvent[] = [
      { type: 'tool_use_start', id: 'e1', name: 'EnterWorktree' },
      { type: 'tool_use_stop', id: 'e1', input: { name: 'feat-a' } },
      { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 } },
    ]
    // Turn 3: model calls Spy again (should land in worktree path).
    const turn3: ProviderEvent[] = [
      { type: 'tool_use_start', id: 's2', name: 'Spy' },
      { type: 'tool_use_stop', id: 's2', input: {} },
      { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 } },
    ]
    // Turn 4: ExitWorktree (need the id from turn 2's result — discovered post-hoc).
    // To keep this deterministic we look up the active record's id after turn 2
    // by stopping the model's iter and re-driving. Simpler: have turn 4's input
    // be a placeholder; we'll patch via a wrapper provider below.
    // For test cleanliness, we precompute by running the loop in 2 phases.

    const phaseAProvider = stubProvider([turn1, turn2, turn3])

    const permission = new PermissionChecker(
      () => session.permissionCache,
      async () => ({ allowed: true }),
    )

    // Phase A: drive 3 turns → end on Spy that hit worktree cwd. The loop
    // continues until the model emits no tool calls, so we add a final
    // empty turn to terminate.
    const turnEnd: ProviderEvent[] = [
      { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } },
    ]
    const phaseAFull = stubProvider([turn1, turn2, turn3, turnEnd])

    for await (const _ev of runAgent(
      { text: 'go' },
      session,
      {
        provider: { resolveFor: () => ({ provider: phaseAFull, model: 'm' }) } as any,
        tools,
        permission,
        worktreeStore: store,
      },
      new AbortController().signal,
    )) {
      // drain
    }

    // Suppress unused-var lint
    void phaseAProvider

    // Assertions: Spy ran twice. First call saw process.cwd(), second saw
    // the worktree path.
    const spyHits = sink.filter(s => s.name === 'Spy')
    expect(spyHits).toHaveLength(2)
    expect(spyHits[0]!.cwd).toBe(process.cwd())
    expect(spyHits[1]!.cwd).toBe('/repo/.nuka/worktrees/feat-a')

    // The store's active pointer should still be set (no ExitWorktree was
    // called in this phase).
    expect(store.getActive()?.path).toBe('/repo/.nuka/worktrees/feat-a')

    // Phase B: run a fresh session with the SAME store, call ExitWorktree
    // then Spy. The fallback should re-engage.
    const session2 = createSession({ providerId: 'p', model: 'm' })
    const activeId = store.getActive()!.id
    const phaseB: ProviderEvent[][] = [
      [
        { type: 'tool_use_start', id: 'x1', name: 'ExitWorktree' },
        { type: 'tool_use_stop', id: 'x1', input: { id: activeId } },
        { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 } },
      ],
      [
        { type: 'tool_use_start', id: 's3', name: 'Spy' },
        { type: 'tool_use_stop', id: 's3', input: {} },
        { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 } },
      ],
      turnEnd,
    ]
    const phaseBProvider = stubProvider(phaseB)

    for await (const _ev of runAgent(
      { text: 'exit' },
      session2,
      {
        provider: { resolveFor: () => ({ provider: phaseBProvider, model: 'm' }) } as any,
        tools,
        permission,
        worktreeStore: store,
      },
      new AbortController().signal,
    )) {
      // drain
    }

    const allSpyHits = sink.filter(s => s.name === 'Spy')
    expect(allSpyHits).toHaveLength(3)
    expect(allSpyHits[2]!.cwd).toBe(process.cwd())
    expect(store.getActive()).toBeUndefined()
  })

  it('uses process.cwd() when worktreeStore is omitted (default behaviour)', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    const sink: { name: string; cwd: string }[] = []
    const tools = new ToolRegistry()
    tools.register(makeSpyTool('Spy', sink))

    const turn: ProviderEvent[] = [
      { type: 'tool_use_start', id: 's1', name: 'Spy' },
      { type: 'tool_use_stop', id: 's1', input: {} },
      { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 } },
    ]
    const turnEnd: ProviderEvent[] = [
      { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } },
    ]
    const provider = stubProvider([turn, turnEnd])
    const permission = new PermissionChecker(
      () => session.permissionCache,
      async () => ({ allowed: true }),
    )

    for await (const _ev of runAgent(
      { text: 'go' },
      session,
      {
        provider: { resolveFor: () => ({ provider, model: 'm' }) } as any,
        tools,
        permission,
        // no worktreeStore
      },
      new AbortController().signal,
    )) {
      // drain
    }

    expect(sink).toHaveLength(1)
    expect(sink[0]!.cwd).toBe(process.cwd())
  })
})
