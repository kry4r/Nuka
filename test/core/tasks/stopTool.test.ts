// test/core/tasks/stopTool.test.ts
//
// Covers TaskStop against a small in-memory stub of the TaskManager API.

import { describe, expect, it, vi } from 'vitest'
import { makeTaskStopTool, type TaskStopManagerLike } from '../../../src/core/tasks/stopTool'
import type { Task, TaskState } from '../../../src/core/tasks/types'

const ctx = () => ({ signal: new AbortController().signal, cwd: process.cwd() })

function makeTask(opts: {
  id?: string
  state?: TaskState
  description?: string
  exitCode?: number
}): Task {
  return {
    id: opts.id ?? 'task-1',
    kind: 'local_bash',
    description: opts.description ?? 'demo',
    state: opts.state ?? 'running',
    outputFile: '/tmp/nuka-test-output.log',
    spec: {
      kind: 'local_bash',
      description: opts.description ?? 'demo',
      command: 'true',
    },
    ...(opts.exitCode !== undefined ? { exitCode: opts.exitCode } : {}),
  }
}

class FakeManager implements TaskStopManagerLike {
  private readonly tasks = new Map<string, Task>()
  cancelMock = vi.fn<(id: string) => Promise<void>>()
  cancelImpl: (id: string) => Promise<void> = async (id) => {
    const t = this.tasks.get(id)
    if (t) this.tasks.set(id, { ...t, state: 'killed' })
  }

  set(t: Task): void {
    this.tasks.set(t.id, t)
  }
  get(id: string): Task | undefined {
    return this.tasks.get(id)
  }
  async cancel(id: string): Promise<void> {
    this.cancelMock(id)
    await this.cancelImpl(id)
  }
}

describe('TaskStop tool', () => {
  it('is registered with the expected metadata', () => {
    const tool = makeTaskStopTool(new FakeManager())
    expect(tool.name).toBe('TaskStop')
    expect(tool.aliases).toContain('KillShell')
    expect(tool.tags).toContain('core')
    expect(tool.tags).toContain('tasks')
    expect(tool.needsPermission({ task_id: 'x' })).toBe('none')
    expect(tool.annotations?.readOnly).toBe(false)
  })

  it('errors when neither task_id nor shell_id is provided', async () => {
    const tool = makeTaskStopTool(new FakeManager())
    const r = await tool.run({}, ctx())
    expect(r.isError).toBe(true)
    expect(r.output).toContain('task_id')
  })

  it('errors when the task is unknown', async () => {
    const tool = makeTaskStopTool(new FakeManager())
    const r = await tool.run({ task_id: 'ghost' }, ctx())
    expect(r.isError).toBe(true)
    expect(r.output).toContain("No background task with id 'ghost'")
  })

  it('cancels a running task via manager.cancel', async () => {
    const m = new FakeManager()
    m.set(makeTask({ id: 'r1', state: 'running', description: 'long curl' }))
    const tool = makeTaskStopTool(m)
    const r = await tool.run({ task_id: 'r1' }, ctx())
    expect(r.isError).toBe(false)
    expect(m.cancelMock).toHaveBeenCalledWith('r1')
    expect(r.output).toContain('Stopped task r1')
    expect(r.output).toContain('long curl')
    expect(r.output).toContain('state=killed')
  })

  it('accepts shell_id as a deprecated alias', async () => {
    const m = new FakeManager()
    m.set(makeTask({ id: 'sh1', state: 'running' }))
    const tool = makeTaskStopTool(m)
    const r = await tool.run({ shell_id: 'sh1' }, ctx())
    expect(r.isError).toBe(false)
    expect(m.cancelMock).toHaveBeenCalledWith('sh1')
  })

  it('prefers task_id when both task_id and shell_id are present', async () => {
    const m = new FakeManager()
    m.set(makeTask({ id: 'primary', state: 'running' }))
    m.set(makeTask({ id: 'secondary', state: 'running' }))
    const tool = makeTaskStopTool(m)
    const r = await tool.run(
      { task_id: 'primary', shell_id: 'secondary' },
      ctx(),
    )
    expect(r.isError).toBe(false)
    expect(m.cancelMock).toHaveBeenCalledWith('primary')
    expect(m.cancelMock).not.toHaveBeenCalledWith('secondary')
  })

  it('does not call cancel on a terminal task; reports the state', async () => {
    const m = new FakeManager()
    m.set(makeTask({ id: 'done', state: 'completed', exitCode: 0 }))
    const tool = makeTaskStopTool(m)
    const r = await tool.run({ task_id: 'done' }, ctx())
    expect(r.isError).toBe(false)
    expect(m.cancelMock).not.toHaveBeenCalled()
    expect(r.output).toContain('already completed')
    expect(r.output).toContain('exit 0')
  })

  it('reports a clean error if manager.cancel throws', async () => {
    const m = new FakeManager()
    m.set(makeTask({ id: 'bad', state: 'running' }))
    m.cancelImpl = async () => {
      throw new Error('signal failed')
    }
    const tool = makeTaskStopTool(m)
    const r = await tool.run({ task_id: 'bad' }, ctx())
    expect(r.isError).toBe(true)
    expect(r.output).toContain('Failed to stop task bad')
    expect(r.output).toContain('signal failed')
  })

  it('trims whitespace around the task id', async () => {
    const m = new FakeManager()
    m.set(makeTask({ id: 'pad', state: 'running' }))
    const tool = makeTaskStopTool(m)
    const r = await tool.run({ task_id: '  pad  ' }, ctx())
    expect(r.isError).toBe(false)
    expect(m.cancelMock).toHaveBeenCalledWith('pad')
  })
})
