// test/core/tasks/manager.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { TaskManager } from '../../../src/core/tasks/manager'
import type { LocalAgentSpec, MonitorMcpSpec } from '../../../src/core/tasks/types'

async function newHome(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'nuka-tasks-'))
}

function waitFor<T>(
  manager: TaskManager,
  predicate: (t: import('../../../src/core/tasks/types').Task) => boolean,
): Promise<import('../../../src/core/tasks/types').Task> {
  return new Promise((resolve) => {
    const off = manager.on('change', (t) => {
      if (predicate(t)) {
        off()
        resolve(t)
      }
    })
  })
}

describe('TaskManager', () => {
  let home: string
  beforeEach(async () => { home = await newHome() })

  it('enqueue returns a running task with a stable id and outputFile', () => {
    const m = new TaskManager({ home })
    const t = m.enqueue({
      kind: 'local_agent',
      description: 'noop',
      agentRunner: async function* () { /* yields nothing */ },
    })
    expect(t.id).toMatch(/^[0-9a-f]{8}$/)
    expect(t.kind).toBe('local_agent')
    expect(t.state).toBe('running')
    expect(t.outputFile).toBe(path.join(home, '.nuka', 'tasks', `${t.id}.log`))
  })

  it('list() returns enqueued tasks (newest first)', async () => {
    const m = new TaskManager({ home })
    const a = m.enqueue({
      kind: 'local_agent',
      description: 'a',
      agentRunner: async function* () { /* empty */ },
    })
    // ensure timestamp ordering is observable
    await new Promise(r => setTimeout(r, 5))
    const b = m.enqueue({
      kind: 'local_agent',
      description: 'b',
      agentRunner: async function* () { /* empty */ },
    })
    const ids = m.list().map(t => t.id)
    expect(ids[0]).toBe(b.id)
    expect(ids).toContain(a.id)
  })

  it('get(id) returns the task and undefined for unknown ids', () => {
    const m = new TaskManager({ home })
    const t = m.enqueue({
      kind: 'local_agent',
      description: 'get-test',
      agentRunner: async function* () { /* empty */ },
    })
    expect(m.get(t.id)?.id).toBe(t.id)
    expect(m.get('nope')).toBeUndefined()
  })

  it('emits a change event on completion', async () => {
    const m = new TaskManager({ home })
    const events: string[] = []
    m.on('change', t => events.push(t.state))
    m.enqueue({
      kind: 'local_agent',
      description: 'finish-fast',
      agentRunner: async function* () { yield { text: 'hello' } },
    })
    await m.drain()
    expect(events).toContain('completed')
  })

  it('drain() resolves once all tasks settle', async () => {
    const m = new TaskManager({ home })
    let resolved = false
    const spec: LocalAgentSpec = {
      kind: 'local_agent',
      description: 'slow',
      agentRunner: async function* () {
        await new Promise(r => setTimeout(r, 20))
        yield { text: 'done' }
      },
    }
    m.enqueue(spec)
    await m.drain()
    resolved = true
    expect(resolved).toBe(true)
    const all = m.list()
    expect(all.every(t => t.state === 'completed')).toBe(true)
  })

  it('cancel transitions the task to killed', async () => {
    const m = new TaskManager({ home })
    const spec: LocalAgentSpec = {
      kind: 'local_agent',
      description: 'long-running',
      agentRunner: async function* (signal) {
        while (!signal.aborted) {
          yield { text: 'tick' }
          await new Promise(r => setTimeout(r, 10))
        }
      },
    }
    const t = m.enqueue(spec)
    await new Promise(r => setTimeout(r, 30))
    await m.cancel(t.id)
    const after = m.get(t.id)!
    expect(after.state).toBe('killed')
    expect(after.finishedAt).toBeTypeOf('number')
  })

  it('failed monitor_mcp final event is recorded as failed state', async () => {
    const m = new TaskManager({ home })
    const spec: MonitorMcpSpec = {
      kind: 'monitor_mcp',
      description: 'will-fail',
      eventStream: async function* () {
        yield { message: 'starting' }
        yield { message: 'oh no', done: true, error: 'broken pipe' }
      },
    }
    const t = m.enqueue(spec)
    await waitFor(m, x => x.id === t.id && (x.state === 'failed' || x.state === 'completed'))
    const after = m.get(t.id)!
    expect(after.state).toBe('failed')
    expect(after.error).toContain('broken pipe')
  })

  it('persists output to <home>/.nuka/tasks/<id>.log for monitor events', async () => {
    const m = new TaskManager({ home })
    const t = m.enqueue({
      kind: 'monitor_mcp',
      description: 'persist',
      eventStream: async function* () {
        yield { message: 'first' }
        yield { message: 'second', done: true }
      },
    })
    await m.drain()
    const text = await readFile(t.outputFile, 'utf8')
    expect(text).toContain('first')
    expect(text).toContain('second')
  })

  it('on(\"change\") returns an unsubscribe function', () => {
    const m = new TaskManager({ home })
    const events: string[] = []
    const off = m.on('change', t => events.push(t.state))
    off()
    m.enqueue({
      kind: 'local_agent',
      description: 'noop',
      agentRunner: async function* () { /* empty */ },
    })
    expect(events).toHaveLength(0)
  })

  it('listener errors do not break further dispatch', async () => {
    const m = new TaskManager({ home })
    let secondCalled = false
    m.on('change', () => { throw new Error('boom') })
    m.on('change', () => { secondCalled = true })
    m.enqueue({
      kind: 'local_agent',
      description: 'noop',
      agentRunner: async function* () { /* empty */ },
    })
    await m.drain()
    expect(secondCalled).toBe(true)
  })
})
