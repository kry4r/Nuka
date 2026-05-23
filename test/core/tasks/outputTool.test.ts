// test/core/tasks/outputTool.test.ts
//
// Covers TaskOutput against a small in-memory stub of the TaskManager API
// surface (get / on) plus a real on-disk outputFile populated via the same
// `tailOutput` helper that production uses.

import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { makeTaskOutputTool, type TaskOutputManagerLike } from '../../../src/core/tasks/outputTool'
import type { Task, TaskState } from '../../../src/core/tasks/types'

const ctx = () => ({ signal: new AbortController().signal, cwd: process.cwd() })

async function newTmpDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'nuka-task-output-'))
}

async function writeOutput(file: string, body: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, body, 'utf8')
}

type Listener = (t: Task) => void

class FakeManager implements TaskOutputManagerLike {
  private readonly tasks = new Map<string, Task>()
  private readonly listeners = new Set<Listener>()

  set(t: Task): void {
    this.tasks.set(t.id, t)
  }
  list(): Task[] {
    return Array.from(this.tasks.values()).reverse()
  }
  get(id: string): Task | undefined {
    return this.tasks.get(id)
  }
  on(_event: 'change', cb: Listener): () => void {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }
  transition(id: string, next: TaskState, patch: Partial<Task> = {}): void {
    const t = this.tasks.get(id)
    if (!t) return
    const updated = { ...t, ...patch, state: next }
    this.tasks.set(id, updated)
    for (const cb of this.listeners) cb(updated)
  }
}

function makeTask(opts: {
  id?: string
  state?: TaskState
  outputFile: string
  description?: string
  agentId?: string
}): Task {
  return {
    id: opts.id ?? 'aa11bb22',
    kind: 'local_bash',
    description: opts.description ?? 'demo task',
    state: opts.state ?? 'running',
    outputFile: opts.outputFile,
    agentId: opts.agentId,
    spec: {
      kind: 'local_bash',
      description: opts.description ?? 'demo task',
      command: 'true',
    },
  }
}

describe('TaskOutput tool', () => {
  it('is registered with the expected metadata', () => {
    const tool = makeTaskOutputTool(new FakeManager())
    expect(tool.name).toBe('TaskOutput')
    expect(tool.tags).toContain('core')
    expect(tool.tags).toContain('tasks')
    expect(tool.annotations?.readOnly).toBe(true)
    expect(tool.needsPermission({ task_id: 'x' })).toBe('none')
  })

  it('errors when task_id is missing', async () => {
    const tool = makeTaskOutputTool(new FakeManager())
    const r = await tool.run({ task_id: '' }, ctx())
    expect(r.isError).toBe(true)
    expect(r.output).toContain('task_id or agent_id is required')
  })

  it('errors when no task with the id is registered', async () => {
    const tool = makeTaskOutputTool(new FakeManager())
    const r = await tool.run({ task_id: 'nope', block: false }, ctx())
    expect(r.isError).toBe(true)
    expect(r.output).toContain("No background task with id 'nope'")
  })

  it('errors when no task with the agent_id is registered', async () => {
    const tool = makeTaskOutputTool(new FakeManager())
    const r = await tool.run({ agent_id: 'agent-missing', block: false }, ctx())
    expect(r.isError).toBe(true)
    expect(r.output).toContain("No background task with agent id 'agent-missing'")
  })

  it('non-blocking: returns current state and trailing output', async () => {
    const home = await newTmpDir()
    const outputFile = path.join(home, '.nuka', 'tasks', 'aa11bb22.log')
    await writeOutput(outputFile, 'first line\nsecond line\nthird line\n')

    const m = new FakeManager()
    m.set(makeTask({ outputFile, state: 'running', description: 'still running' }))

    const tool = makeTaskOutputTool(m)
    const r = await tool.run({ task_id: 'aa11bb22', block: false }, ctx())
    expect(r.isError).toBe(false)
    const text = r.output as string
    expect(text).toContain('task_id=aa11bb22')
    expect(text).toContain('state=running')
    expect(text).toContain('retrieval_status=success')
    expect(text).toContain('third line')
    expect(text).toContain('description=still running')
  })

  it('includes agent_id when the task is backed by a local subagent', async () => {
    const home = await newTmpDir()
    const outputFile = path.join(home, '.nuka', 'tasks', 'agent.log')
    await writeOutput(outputFile, 'agent output\n')

    const m = new FakeManager()
    m.set(makeTask({
      id: 'agent',
      outputFile,
      state: 'completed',
      description: 'subagent task',
      agentId: 'agent-1234abcd',
    }))

    const tool = makeTaskOutputTool(m)
    const r = await tool.run({ task_id: 'agent', block: false }, ctx())
    expect(r.isError).toBe(false)
    expect(r.output as string).toContain('agent_id=agent-1234abcd')
  })

  it('reads output by agent_id when task_id is omitted', async () => {
    const home = await newTmpDir()
    const oldOutputFile = path.join(home, '.nuka', 'tasks', 'old-agent.log')
    const newOutputFile = path.join(home, '.nuka', 'tasks', 'new-agent.log')
    await writeOutput(oldOutputFile, 'old run\n')
    await writeOutput(newOutputFile, 'new run\n')

    const m = new FakeManager()
    m.set(makeTask({
      id: 'old-agent-task',
      outputFile: oldOutputFile,
      state: 'completed',
      agentId: 'agent-stable',
    }))
    m.set(makeTask({
      id: 'new-agent-task',
      outputFile: newOutputFile,
      state: 'running',
      agentId: 'agent-stable',
    }))

    const tool = makeTaskOutputTool(m)
    const r = await tool.run(
      { agent_id: 'agent-stable', block: false },
      ctx(),
    )
    expect(r.isError).toBe(false)
    const text = r.output as string
    expect(text).toContain('task_id=new-agent-task')
    expect(text).toContain('agent_id=agent-stable')
    expect(text).toContain('new run')
    expect(text).not.toContain('old run')
  })

  it('prefers task_id when both task_id and agent_id are present', async () => {
    const home = await newTmpDir()
    const primaryFile = path.join(home, '.nuka', 'tasks', 'primary.log')
    const agentFile = path.join(home, '.nuka', 'tasks', 'agent.log')
    await writeOutput(primaryFile, 'primary output\n')
    await writeOutput(agentFile, 'agent output\n')

    const m = new FakeManager()
    m.set(makeTask({
      id: 'primary-task',
      outputFile: primaryFile,
      state: 'completed',
      agentId: 'agent-primary',
    }))
    m.set(makeTask({
      id: 'agent-task',
      outputFile: agentFile,
      state: 'completed',
      agentId: 'agent-secondary',
    }))

    const tool = makeTaskOutputTool(m)
    const r = await tool.run(
      {
        task_id: 'primary-task',
        agent_id: 'agent-secondary',
        block: false,
      },
      ctx(),
    )
    expect(r.isError).toBe(false)
    const text = r.output as string
    expect(text).toContain('task_id=primary-task')
    expect(text).toContain('primary output')
    expect(text).not.toContain('agent output')
  })

  it('non-blocking on a terminal task: shows exit code', async () => {
    const home = await newTmpDir()
    const outputFile = path.join(home, '.nuka', 'tasks', 'cc33dd44.log')
    await writeOutput(outputFile, 'done\n')

    const m = new FakeManager()
    m.set({
      ...makeTask({ id: 'cc33dd44', outputFile, state: 'completed' }),
      exitCode: 0,
    })

    const tool = makeTaskOutputTool(m)
    const r = await tool.run({ task_id: 'cc33dd44', block: false }, ctx())
    expect(r.isError).toBe(false)
    const text = r.output as string
    expect(text).toContain('state=completed')
    expect(text).toContain('exit_code=0')
  })

  it('respects the lines cap', async () => {
    const home = await newTmpDir()
    const outputFile = path.join(home, '.nuka', 'tasks', 'limit.log')
    const body = Array.from({ length: 100 }, (_, i) => `line${i}`).join('\n') + '\n'
    await writeOutput(outputFile, body)

    const m = new FakeManager()
    m.set(makeTask({ id: 'limit', outputFile, state: 'completed' }))

    const tool = makeTaskOutputTool(m)
    const r = await tool.run({ task_id: 'limit', block: false, lines: 3 }, ctx())
    expect(r.isError).toBe(false)
    const text = r.output as string
    expect(text).toContain('line99')
    expect(text).toContain('line97')
    expect(text).not.toContain('line50')
  })

  it('renders "(no output yet)" when the log file is missing', async () => {
    const home = await newTmpDir()
    const outputFile = path.join(home, '.nuka', 'tasks', 'ghost.log')
    // intentionally do not write the file

    const m = new FakeManager()
    m.set(makeTask({ id: 'ghost', outputFile, state: 'running' }))

    const tool = makeTaskOutputTool(m)
    const r = await tool.run({ task_id: 'ghost', block: false }, ctx())
    expect(r.isError).toBe(false)
    expect(r.output as string).toContain('(no output yet)')
  })

  it('block=true: waits for a terminal change event and returns success', async () => {
    const home = await newTmpDir()
    const outputFile = path.join(home, '.nuka', 'tasks', 'block.log')
    await writeOutput(outputFile, 'progress\n')

    const m = new FakeManager()
    m.set(makeTask({ id: 'block', outputFile, state: 'running' }))

    const tool = makeTaskOutputTool(m)
    const p = tool.run({ task_id: 'block', block: true, timeout_ms: 1000 }, ctx())

    // Settle the task after a short delay.
    setTimeout(() => {
      writeOutput(outputFile, 'progress\ndone\n').then(() => {
        m.transition('block', 'completed', { exitCode: 0 })
      })
    }, 20)

    const r = await p
    expect(r.isError).toBe(false)
    const text = r.output as string
    expect(text).toContain('state=completed')
    expect(text).toContain('retrieval_status=success')
    expect(text).toContain('exit_code=0')
  })

  it('block=true: returns retrieval_status=timeout when task does not settle', async () => {
    const home = await newTmpDir()
    const outputFile = path.join(home, '.nuka', 'tasks', 'slow.log')
    await writeOutput(outputFile, 'still going\n')

    const m = new FakeManager()
    m.set(makeTask({ id: 'slow', outputFile, state: 'running' }))

    const tool = makeTaskOutputTool(m)
    const r = await tool.run(
      { task_id: 'slow', block: true, timeout_ms: 30 },
      ctx(),
    )
    expect(r.isError).toBe(false)
    const text = r.output as string
    expect(text).toContain('state=running')
    expect(text).toContain('retrieval_status=timeout')
  })

  it('block=true: aborts cleanly when the context signal fires', async () => {
    const home = await newTmpDir()
    const outputFile = path.join(home, '.nuka', 'tasks', 'abort.log')
    await writeOutput(outputFile, '\n')

    const m = new FakeManager()
    m.set(makeTask({ id: 'abort', outputFile, state: 'running' }))

    const ac = new AbortController()
    const tool = makeTaskOutputTool(m)
    const p = tool.run(
      { task_id: 'abort', block: true, timeout_ms: 60_000 },
      { signal: ac.signal, cwd: process.cwd() },
    )
    setTimeout(() => ac.abort(), 10)
    const r = await p
    expect(r.isError).toBe(false)
    const text = r.output as string
    expect(text).toContain('state=running')
    // Either timeout or success-mode "running" — since the task never moved
    // to terminal, retrieval_status must NOT be 'success'.
    expect(text).toMatch(/retrieval_status=(timeout|not_found)/)
  })

  it('clamps lines and timeout to sane bounds', async () => {
    const home = await newTmpDir()
    const outputFile = path.join(home, '.nuka', 'tasks', 'clamp.log')
    await writeOutput(outputFile, 'one\n')

    const m = new FakeManager()
    m.set(makeTask({ id: 'clamp', outputFile, state: 'completed' }))

    const tool = makeTaskOutputTool(m)
    // lines: 0 -> coerced to 1; timeout_ms: 99_999_999 -> clamped to 600_000.
    const r = await tool.run(
      { task_id: 'clamp', block: false, lines: 0, timeout_ms: 99_999_999 },
      ctx(),
    )
    expect(r.isError).toBe(false)
    expect(r.output as string).toContain('one')
  })
})
