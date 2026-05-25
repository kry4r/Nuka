// test/core/tasks/manager.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { TaskManager } from '../../../src/core/tasks/manager'
import type { LocalAgentSpec } from '../../../src/core/tasks/types'
import { readMeta, readTranscript } from '../../../src/core/tasks/meta'
import { createEventBus } from '../../../src/core/events/bus'
import type { GitResult } from '../../../src/core/worktree/git'

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
    expect(t.agentId).toMatch(/^agent-[0-9a-f]{8}$/)
    expect(t.kind).toBe('local_agent')
    expect(t.state).toBe('running')
    expect(t.outputFile).toBe(path.join(home, '.nuka', 'tasks', `${t.id}.log`))
  })

  it('preserves an explicit local_agent agentId supplied by the caller', () => {
    const m = new TaskManager({ home })
    const t = m.enqueue({
      kind: 'local_agent',
      description: 'named agent',
      agentId: 'agent-custom-1',
      agentRunner: async function* () { /* yields nothing */ },
    })
    expect(t.agentId).toBe('agent-custom-1')
    expect(m.get(t.id)?.agentId).toBe('agent-custom-1')
  })

  it('persists running local_agent metadata immediately after enqueue', () => {
    const m = new TaskManager({ home })
    const t = m.enqueue({
      kind: 'local_agent',
      description: 'core:reviewer: inspect',
      agentId: 'agent-keepalive',
      agentName: 'core:reviewer',
      task: 'inspect state',
      context: 'prior context',
      providerId: 'custom-mimo',
      model: 'mimo-v2-pro',
      agentRunner: async function* () {
        await new Promise(r => setTimeout(r, 20))
        yield { text: 'done' }
      },
    })

    const meta = readMeta(home, t.id)

    expect(meta).toMatchObject({
      id: t.id,
      kind: 'local_agent',
      state: 'running',
      agentId: 'agent-keepalive',
      agentName: 'core:reviewer',
      agentTask: 'inspect state',
      agentContext: 'prior context',
      providerId: 'custom-mimo',
      model: 'mimo-v2-pro',
    })
    expect(meta?.startedAt).toBeTypeOf('number')
  })

  it('persists final local_agent output in task metadata after completion', async () => {
    const m = new TaskManager({ home })
    const t = m.enqueue({
      kind: 'local_agent',
      description: 'core:reviewer: summarize',
      agentId: 'agent-final-output',
      agentName: 'core:reviewer',
      task: 'summarize result',
      agentRunner: async function* () {
        yield { text: 'first line' }
        yield { text: 'final answer' }
      },
    })

    await m.drain()
    const meta = readMeta(home, t.id)

    expect(meta).toMatchObject({
      id: t.id,
      state: 'completed',
      agentId: 'agent-final-output',
      finalOutput: ['first line', 'final answer'].join('\n'),
    })
  })

  it('persists a local_agent transcript sidecar after completion', async () => {
    const m = new TaskManager({ home })
    const t = m.enqueue({
      kind: 'local_agent',
      description: 'core:reviewer: inspect',
      agentId: 'agent-transcript',
      agentName: 'core:reviewer',
      task: 'inspect this',
      context: 'prior context',
      providerId: 'p',
      model: 'm',
      cwd: '/tmp/nuka-agent-cwd',
      writeScope: {
        allow: ['src/core/agents', 'test/core/agents'],
        deny: ['docs/plans'],
        note: 'Stay inside the subagent runtime slice.',
      },
      agentRunner: async function* () {
        yield { text: 'final answer' }
      },
    })

    await m.drain()
    const transcript = readTranscript(home, t.id)

    expect(transcript).toMatchObject({
      id: t.id,
      agentId: 'agent-transcript',
      agentName: 'core:reviewer',
      providerId: 'p',
      model: 'm',
      cwd: '/tmp/nuka-agent-cwd',
      writeScope: {
        allow: ['src/core/agents', 'test/core/agents'],
        deny: ['docs/plans'],
        note: 'Stay inside the subagent runtime slice.',
      },
      messages: [
        { role: 'user', content: 'inspect this\n\nprior context' },
        { role: 'assistant', content: 'final answer' },
      ],
    })
    expect(readMeta(home, t.id)?.writeScope).toEqual({
      allow: ['src/core/agents', 'test/core/agents'],
      deny: ['docs/plans'],
      note: 'Stay inside the subagent runtime slice.',
    })
  })

  it('removes clean local_agent worktree isolation after completion', async () => {
    const gitCalls: string[][] = []
    const gitRunner = (args: string[], opts: { cwd: string }): GitResult => {
      gitCalls.push([opts.cwd, ...args])
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
        return { code: 0, stdout: '/repo\n', stderr: '' }
      }
      if (args[0] === 'status' && args[1] === '--porcelain') {
        return { code: 0, stdout: '', stderr: '' }
      }
      if (args[0] === 'worktree' && args[1] === 'remove') {
        return { code: 0, stdout: '', stderr: '' }
      }
      return { code: 1, stdout: '', stderr: `unexpected git call: ${args.join(' ')}` }
    }
    const m = new TaskManager({ home })
    const t = m.enqueue({
      kind: 'local_agent',
      description: 'core:reviewer: clean worktree',
      cwd: '/repo/.nuka/worktrees/clean-agent',
      worktree: ['/repo/.nuka/worktrees/clean-agent', '/repo'],
      gitRunner,
      agentRunner: async function* () {
        yield { text: 'done' }
      },
    })

    await m.drain()

    expect(m.get(t.id)?.state).toBe('completed')
    expect(gitCalls).toContainEqual(['/repo/.nuka/worktrees/clean-agent', 'status', '--porcelain'])
    expect(gitCalls).toContainEqual([
      '/repo',
      'worktree',
      'remove',
      '/repo/.nuka/worktrees/clean-agent',
    ])
    expect(readMeta(home, t.id)?.cwd).toBeUndefined()
  })

  it('keeps dirty local_agent worktree isolation after completion', async () => {
    const gitCalls: string[][] = []
    const gitRunner = (args: string[], opts: { cwd: string }): GitResult => {
      gitCalls.push([opts.cwd, ...args])
      if (args[0] === 'status' && args[1] === '--porcelain') {
        return { code: 0, stdout: ' M src/app.ts\n', stderr: '' }
      }
      if (args[0] === 'worktree' && args[1] === 'remove') {
        return { code: 0, stdout: '', stderr: '' }
      }
      return { code: 1, stdout: '', stderr: `unexpected git call: ${args.join(' ')}` }
    }
    const m = new TaskManager({ home })
    const t = m.enqueue({
      kind: 'local_agent',
      description: 'core:reviewer: dirty worktree',
      cwd: '/repo/.nuka/worktrees/dirty-agent',
      worktree: ['/repo/.nuka/worktrees/dirty-agent', '/repo'],
      gitRunner,
      agentRunner: async function* () {
        yield { text: 'changed files' }
      },
    })

    await m.drain()

    expect(m.get(t.id)?.state).toBe('completed')
    expect(gitCalls).toContainEqual(['/repo/.nuka/worktrees/dirty-agent', 'status', '--porcelain'])
    expect(gitCalls).not.toContainEqual([
      '/repo',
      'worktree',
      'remove',
      '/repo/.nuka/worktrees/dirty-agent',
    ])
    expect(readMeta(home, t.id)?.cwd).toBe('/repo/.nuka/worktrees/dirty-agent')
  })

  it('removes clean local_agent worktree isolation after failure', async () => {
    const gitCalls: string[][] = []
    const gitRunner = (args: string[], opts: { cwd: string }): GitResult => {
      gitCalls.push([opts.cwd, ...args])
      if (args[0] === 'status' && args[1] === '--porcelain') {
        return { code: 0, stdout: '', stderr: '' }
      }
      if (args[0] === 'worktree' && args[1] === 'remove') {
        return { code: 0, stdout: '', stderr: '' }
      }
      return { code: 1, stdout: '', stderr: `unexpected git call: ${args.join(' ')}` }
    }
    const m = new TaskManager({ home })
    const t = m.enqueue({
      kind: 'local_agent',
      description: 'core:reviewer: failed worktree',
      cwd: '/repo/.nuka/worktrees/failed-agent',
      worktree: ['/repo/.nuka/worktrees/failed-agent', '/repo'],
      gitRunner,
      agentRunner: async function* () {
        throw new Error('agent failed')
      },
    })

    await m.drain()

    expect(m.get(t.id)?.state).toBe('failed')
    expect(gitCalls).toContainEqual(['/repo/.nuka/worktrees/failed-agent', 'status', '--porcelain'])
    expect(gitCalls).toContainEqual([
      '/repo',
      'worktree',
      'remove',
      '/repo/.nuka/worktrees/failed-agent',
    ])
    expect(readMeta(home, t.id)?.cwd).toBeUndefined()
  })

  it('removes clean local_agent worktree isolation after cancellation settles', async () => {
    const gitCalls: string[][] = []
    const gitRunner = (args: string[], opts: { cwd: string }): GitResult => {
      gitCalls.push([opts.cwd, ...args])
      if (args[0] === 'status' && args[1] === '--porcelain') {
        return { code: 0, stdout: '', stderr: '' }
      }
      if (args[0] === 'worktree' && args[1] === 'remove') {
        return { code: 0, stdout: '', stderr: '' }
      }
      return { code: 1, stdout: '', stderr: `unexpected git call: ${args.join(' ')}` }
    }
    const m = new TaskManager({ home })
    const t = m.enqueue({
      kind: 'local_agent',
      description: 'core:reviewer: cancelled worktree',
      cwd: '/repo/.nuka/worktrees/cancelled-agent',
      worktree: ['/repo/.nuka/worktrees/cancelled-agent', '/repo'],
      gitRunner,
      agentRunner: async function* (signal) {
        await new Promise<void>((resolve) => {
          if (signal.aborted) {
            resolve()
            return
          }
          signal.addEventListener('abort', () => resolve(), { once: true })
        })
      },
    })

    await m.cancel(t.id)

    expect(m.get(t.id)?.state).toBe('killed')
    expect(gitCalls).toContainEqual(['/repo/.nuka/worktrees/cancelled-agent', 'status', '--porcelain'])
    expect(gitCalls).toContainEqual([
      '/repo',
      'worktree',
      'remove',
      '/repo/.nuka/worktrees/cancelled-agent',
    ])
    expect(readMeta(home, t.id)?.cwd).toBeUndefined()
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

  it('emits extension-visible local subagent start and end events', async () => {
    const bus = createEventBus()
    const agentEvents: any[] = []
    bus.subscribe('agent', (event: any) => agentEvents.push(event))
    const m = new TaskManager({ home, bus })

    const task = m.enqueue({
      kind: 'local_agent',
      description: 'verify patch',
      agentId: 'agent-visible',
      agentName: 'core:verifier',
      providerId: 'custom-mimo',
      model: 'mimo-v2-pro',
      cwd: '/tmp/nuka-visible',
      resumed: true,
      taskSessionId: 'parent-session',
      agentRunner: async function* () {
        yield { text: 'checked' }
      },
    })

    await m.drain()

    expect(agentEvents).toContainEqual(expect.objectContaining({
      type: 'agent.subagent.start',
      taskId: task.id,
      agentId: 'agent-visible',
      agentName: 'core:verifier',
      sessionId: 'parent-session',
      description: 'verify patch',
      providerId: 'custom-mimo',
      model: 'mimo-v2-pro',
      cwd: '/tmp/nuka-visible',
      resumed: true,
    }))
    expect(agentEvents).toContainEqual(expect.objectContaining({
      type: 'agent.subagent.end',
      taskId: task.id,
      agentId: 'agent-visible',
      agentName: 'core:verifier',
      sessionId: 'parent-session',
      status: 'completed',
    }))
  })

  it('emits failed local subagent summaries on agent and task events', async () => {
    const bus = createEventBus()
    const agentEvents: any[] = []
    const taskEvents: any[] = []
    bus.subscribe('agent', (event: any) => agentEvents.push(event))
    bus.subscribe('task', (event: any) => taskEvents.push(event))
    const m = new TaskManager({ home, bus })

    const task = m.enqueue({
      kind: 'local_agent',
      description: 'review unsafe edit',
      agentId: 'agent-failed',
      agentName: 'core:verifier',
      taskSessionId: 'parent-session',
      agentRunner: async function* () {
        throw new Error('permission denied while editing src/app.ts')
      },
    })

    await m.drain()

    expect(m.get(task.id)?.state).toBe('failed')
    expect(agentEvents).toContainEqual(expect.objectContaining({
      type: 'agent.subagent.end',
      taskId: task.id,
      agentId: 'agent-failed',
      status: 'failed',
      error: 'permission denied while editing src/app.ts',
      summary: 'permission denied while editing src/app.ts',
    }))
    expect(taskEvents).toContainEqual(expect.objectContaining({
      type: 'task.state',
      id: task.id,
      to: 'failed',
      error: 'permission denied while editing src/app.ts',
      summary: 'permission denied while editing src/app.ts',
    }))
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
