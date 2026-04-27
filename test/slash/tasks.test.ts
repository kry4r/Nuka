// test/slash/tasks.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { TasksCommand } from '../../src/slash/tasks'
import { TaskManager } from '../../src/core/tasks/manager'
import { SessionManager } from '../../src/core/session/manager'
import type { SlashContext } from '../../src/slash/types'

async function newHome(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'nuka-tasks-slash-'))
}

function ctx(overrides: Partial<SlashContext> = {}): SlashContext {
  const sessions = new SessionManager()
  sessions.start({ providerId: 'p', model: 'm' })
  return {
    sessions,
    providers: { getProviderConfig: () => undefined, listProviders: () => [] } as any,
    config: { providers: [], active: { providerId: 'p' } } as any,
    ...overrides,
  }
}

describe('/tasks slash command', () => {
  let home: string
  beforeEach(async () => { home = await newHome() })

  it('returns "not enabled" hint when no taskManager is wired', async () => {
    const res = await TasksCommand.run('', ctx())
    expect(res.type).toBe('text')
    if (res.type === 'text') expect(res.text).toMatch(/not enabled/i)
  })

  it('default subcommand lists "No background tasks" when empty', async () => {
    const m = new TaskManager({ home })
    const res = await TasksCommand.run('', ctx({ taskManager: m }))
    expect(res.type).toBe('text')
    if (res.type === 'text') expect(res.text).toMatch(/No background tasks/)
  })

  it('lists running + completed tasks with id/state/kind columns', async () => {
    const m = new TaskManager({ home })
    const t = m.enqueue({
      kind: 'local_agent',
      description: 'demo',
      agentRunner: async function* () { yield { text: 'hi' } },
    })
    await m.drain()
    const res = await TasksCommand.run('', ctx({ taskManager: m }))
    expect(res.type).toBe('text')
    if (res.type === 'text') {
      expect(res.text).toContain(t.id)
      expect(res.text).toContain('done')
      expect(res.text).toContain('local_agent')
      expect(res.text).toContain('demo')
    }
  })

  it('show <id> tails the output file', async () => {
    const m = new TaskManager({ home })
    const t = m.enqueue({
      kind: 'local_agent',
      description: 'persisted',
      agentRunner: async function* () {
        yield { text: 'first-line' }
        yield { text: 'second-line' }
      },
    })
    await m.drain()
    const res = await TasksCommand.run(`show ${t.id}`, ctx({ taskManager: m }))
    expect(res.type).toBe('text')
    if (res.type === 'text') {
      expect(res.text).toContain('first-line')
      expect(res.text).toContain('second-line')
    }
  })

  it('show <id> reports unknown ids', async () => {
    const m = new TaskManager({ home })
    const res = await TasksCommand.run('show nope', ctx({ taskManager: m }))
    expect(res.type).toBe('text')
    if (res.type === 'text') expect(res.text).toMatch(/No task/)
  })

  it('cancel <id> kills a running task', async () => {
    const m = new TaskManager({ home })
    const t = m.enqueue({
      kind: 'local_agent',
      description: 'forever',
      agentRunner: async function* (signal) {
        while (!signal.aborted) {
          yield { text: 'tick' }
          await new Promise(r => setTimeout(r, 5))
        }
      },
    })
    await new Promise(r => setTimeout(r, 15))
    const res = await TasksCommand.run(`cancel ${t.id}`, ctx({ taskManager: m }))
    expect(res.type).toBe('text')
    if (res.type === 'text') expect(res.text).toMatch(/Cancelled/)
    expect(m.get(t.id)!.state).toBe('killed')
  })

  it('cancel <id> says "already X" for finished tasks', async () => {
    const m = new TaskManager({ home })
    const t = m.enqueue({
      kind: 'local_agent',
      description: 'fast',
      agentRunner: async function* () { yield { text: 'x' } },
    })
    await m.drain()
    const res = await TasksCommand.run(`cancel ${t.id}`, ctx({ taskManager: m }))
    expect(res.type).toBe('text')
    if (res.type === 'text') expect(res.text).toMatch(/already done/)
  })

  it('rejects unknown subcommands with a helpful hint', async () => {
    const m = new TaskManager({ home })
    const res = await TasksCommand.run('zap abc', ctx({ taskManager: m }))
    expect(res.type).toBe('text')
    if (res.type === 'text') expect(res.text).toMatch(/Unknown subcommand/)
  })

  it('show with no id prints usage', async () => {
    const m = new TaskManager({ home })
    const res = await TasksCommand.run('show', ctx({ taskManager: m }))
    expect(res.type).toBe('text')
    if (res.type === 'text') expect(res.text).toMatch(/Usage:.*show <id>/)
  })
})
