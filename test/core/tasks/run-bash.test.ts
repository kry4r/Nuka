// test/core/tasks/run-bash.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { TaskManager } from '../../../src/core/tasks/manager'
import type { LocalBashSpec } from '../../../src/core/tasks/types'

async function newHome(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'nuka-tasks-'))
}

describe('local_bash task runner', () => {
  let home: string
  beforeEach(async () => { home = await newHome() })

  it('captures stdout into the task outputFile and exits with 0', async () => {
    const m = new TaskManager({ home })
    const spec: LocalBashSpec = {
      kind: 'local_bash',
      description: 'echo',
      command: 'sh',
      args: ['-c', 'echo hello-task'],
    }
    const t = m.enqueue(spec)
    await m.drain()
    const after = m.get(t.id)!
    expect(after.state).toBe('completed')
    expect(after.exitCode).toBe(0)
    const out = await readFile(t.outputFile, 'utf8')
    expect(out).toContain('hello-task')
  })

  it('records non-zero exit codes as failed', async () => {
    const m = new TaskManager({ home })
    const t = m.enqueue({
      kind: 'local_bash',
      description: 'fail',
      command: 'sh',
      args: ['-c', 'echo doomed; exit 7'],
    })
    await m.drain()
    const after = m.get(t.id)!
    expect(after.state).toBe('failed')
    expect(after.exitCode).toBe(7)
    const out = await readFile(t.outputFile, 'utf8')
    expect(out).toContain('doomed')
  })

  it('cancel kills a long-running bash via SIGTERM', async () => {
    const m = new TaskManager({ home })
    const t = m.enqueue({
      kind: 'local_bash',
      description: 'sleep',
      command: 'sh',
      args: ['-c', 'sleep 30'],
    })
    // Give the spawn a moment to land.
    await new Promise(r => setTimeout(r, 30))
    await m.cancel(t.id)
    const after = m.get(t.id)!
    expect(after.state).toBe('killed')
  })

  it('captures stderr alongside stdout', async () => {
    const m = new TaskManager({ home })
    const t = m.enqueue({
      kind: 'local_bash',
      description: 'mixed',
      command: 'sh',
      args: ['-c', 'echo out; echo err 1>&2'],
    })
    await m.drain()
    const out = await readFile(t.outputFile, 'utf8')
    expect(out).toContain('out')
    expect(out).toContain('err')
  })
})
