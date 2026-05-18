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
