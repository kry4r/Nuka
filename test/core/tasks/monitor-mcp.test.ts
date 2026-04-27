// test/core/tasks/monitor-mcp.test.ts
//
// Phase 10 §4.3 — `monitor_mcp` runner. Production wires McpManager's
// progress events into the spec's `eventStream` injection; the tests
// here use synthetic generators.

import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { TaskManager } from '../../../src/core/tasks/manager'
import { runMonitorMcp } from '../../../src/core/tasks/monitor-mcp'
import {
  ensureTasksDirSync,
  taskOutputPath,
} from '../../../src/core/tasks/persist'

async function newHome(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'nuka-tasks-mcp-'))
}

describe('monitor_mcp runner', () => {
  let home: string
  beforeEach(async () => { home = await newHome() })

  it('appends progress events to outputFile and resolves cleanly on done', async () => {
    ensureTasksDirSync(home)
    const file = taskOutputPath(home, 'm1')
    const ctrl = new AbortController()
    const result = await runMonitorMcp({
      spec: {
        kind: 'monitor_mcp',
        description: 'm',
        eventStream: async function* () {
          yield { message: 'connecting' }
          yield { message: 'streaming' }
          yield { message: 'finished', done: true }
        },
      },
      outputFile: file,
      signal: ctrl.signal,
    })
    expect(result.error).toBeUndefined()
    const text = await readFile(file, 'utf8')
    expect(text).toContain('connecting')
    expect(text).toContain('streaming')
    expect(text).toContain('finished')
  })

  it('surfaces error from final event', async () => {
    ensureTasksDirSync(home)
    const file = taskOutputPath(home, 'm2')
    const ctrl = new AbortController()
    const result = await runMonitorMcp({
      spec: {
        kind: 'monitor_mcp',
        description: 'm',
        eventStream: async function* () {
          yield { message: 'starting' }
          yield { message: 'failed', done: true, error: 'tool timed out' }
        },
      },
      outputFile: file,
      signal: ctrl.signal,
    })
    expect(result.error).toBe('tool timed out')
    const text = await readFile(file, 'utf8')
    expect(text).toContain('failed')
    expect(text).toContain('tool timed out')
  })

  it('exits cleanly when signal is pre-aborted', async () => {
    ensureTasksDirSync(home)
    const file = taskOutputPath(home, 'm3')
    const ctrl = new AbortController()
    ctrl.abort()
    let yielded = false
    const result = await runMonitorMcp({
      spec: {
        kind: 'monitor_mcp',
        description: 'm',
        eventStream: async function* () { yielded = true; yield { message: 'never' } },
      },
      outputFile: file,
      signal: ctrl.signal,
    })
    expect(result.error).toBeUndefined()
    expect(yielded).toBe(false)
  })

  it('TaskManager: marks failed when final event carries error', async () => {
    const m = new TaskManager({ home })
    const t = m.enqueue({
      kind: 'monitor_mcp',
      description: 'subscribe',
      eventStream: async function* () {
        yield { message: 'progress 1' }
        yield { message: 'gave up', done: true, error: 'rpc closed' }
      },
    })
    await m.drain()
    const after = m.get(t.id)!
    expect(after.state).toBe('failed')
    expect(after.error).toContain('rpc closed')
  })

  it('TaskManager: cancel mid-stream marks killed', async () => {
    const m = new TaskManager({ home })
    const t = m.enqueue({
      kind: 'monitor_mcp',
      description: 'forever',
      eventStream: async function* (signal) {
        let i = 0
        while (!signal.aborted) {
          yield { message: `tick ${i++}` }
          await new Promise(r => setTimeout(r, 5))
        }
      },
    })
    await new Promise(r => setTimeout(r, 25))
    await m.cancel(t.id)
    const after = m.get(t.id)!
    expect(after.state).toBe('killed')
  })
})
