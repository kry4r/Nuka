// test/core/tasks/run-agent.test.ts
//
// Phase 10 §4.3 — `local_agent` runner. Production wires Phase-5
// `dispatchAgent` into the spec's `agentRunner` injection; here we
// drive it with a hand-rolled async iterable so the tests stay
// hermetic.

import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { TaskManager } from '../../../src/core/tasks/manager'
import { runAgent } from '../../../src/core/tasks/run-agent'
import {
  ensureTasksDirSync,
  taskOutputPath,
} from '../../../src/core/tasks/persist'

async function newHome(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'nuka-tasks-agent-'))
}

describe('local_agent runner', () => {
  let home: string
  beforeEach(async () => { home = await newHome() })

  it('persists each chunk to outputFile (newline-terminated)', async () => {
    ensureTasksDirSync(home)
    const file = taskOutputPath(home, 'tst1')
    const ctrl = new AbortController()
    await runAgent({
      spec: {
        kind: 'local_agent',
        description: 't',
        agentRunner: async function* () {
          yield { text: 'first' }
          yield { text: 'second\n' }   // pre-terminated
          yield { text: 'third' }
        },
      },
      outputFile: file,
      signal: ctrl.signal,
    })
    const text = await readFile(file, 'utf8')
    expect(text).toBe('first\nsecond\nthird\n')
  })

  it('skips empty chunks', async () => {
    ensureTasksDirSync(home)
    const file = taskOutputPath(home, 'tst2')
    const ctrl = new AbortController()
    await runAgent({
      spec: {
        kind: 'local_agent',
        description: 't',
        agentRunner: async function* () {
          yield { text: '' }
          yield { text: 'data' }
        },
      },
      outputFile: file,
      signal: ctrl.signal,
    })
    const text = await readFile(file, 'utf8')
    expect(text).toBe('data\n')
  })

  it('returns immediately when signal is pre-aborted', async () => {
    ensureTasksDirSync(home)
    const file = taskOutputPath(home, 'tst3')
    const ctrl = new AbortController()
    ctrl.abort()
    let yielded = false
    await runAgent({
      spec: {
        kind: 'local_agent',
        description: 't',
        agentRunner: async function* () { yielded = true; yield { text: 'x' } },
      },
      outputFile: file,
      signal: ctrl.signal,
    })
    expect(yielded).toBe(false)
  })

  it('TaskManager: marks completed and persists transcript', async () => {
    const m = new TaskManager({ home })
    const t = m.enqueue({
      kind: 'local_agent',
      description: 'echoes',
      agentRunner: async function* () {
        yield { text: 'hello' }
        yield { text: 'world' }
      },
    })
    await m.drain()
    const after = m.get(t.id)!
    expect(after.state).toBe('completed')
    const text = await readFile(after.outputFile, 'utf8')
    expect(text).toContain('hello')
    expect(text).toContain('world')
  })

  it('TaskManager: surfaces a thrown error as failed', async () => {
    const m = new TaskManager({ home })
    const t = m.enqueue({
      kind: 'local_agent',
      description: 'kaboom',
      agentRunner: async function* () {
        yield { text: 'partial' }
        throw new Error('agent exploded')
      },
    })
    await m.drain()
    const after = m.get(t.id)!
    expect(after.state).toBe('failed')
    expect(after.error).toContain('agent exploded')
    const text = await readFile(after.outputFile, 'utf8')
    expect(text).toContain('partial')
    expect(text).toContain('agent exploded')
  })
})
