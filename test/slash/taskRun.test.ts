import { describe, it, expect } from 'vitest'
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
    sessions: {
      active: () => ({ providerId: 'p', model: 'm', id: 'sess-1', messages: [], ts: 0 }),
    } as never,
    providers: {
      resolveFor: (_session: unknown) => ({
        provider: {
          id: 'p',
          format: 'anthropic',
          stream: async function* () {
            yield { type: 'text_delta', text: 'hello from task' }
            return
          },
          listRemoteModels: async () => [],
        } as never,
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
