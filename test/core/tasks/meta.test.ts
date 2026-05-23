import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { writeMeta, readMeta, fromTask, findLatestMetaByAgentId } from '../../../src/core/tasks/meta'

describe('task meta sidecar', () => {
  let home: string
  beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-meta-')) })

  it('round-trips a meta record', () => {
    fs.mkdirSync(path.join(home, '.nuka', 'tasks'), { recursive: true })
    writeMeta(home, {
      id: 'a1',
      kind: 'local_agent',
      state: 'completed',
      startedAt: 1,
      finishedAt: 2,
      agentId: 'agent-a1',
    })
    const back = readMeta(home, 'a1')
    expect(back?.id).toBe('a1')
    expect(back?.state).toBe('completed')
    expect(back?.agentId).toBe('agent-a1')
  })

  it('returns undefined when the meta file is missing', () => {
    expect(readMeta(home, 'nope')).toBeUndefined()
  })

  it('returns undefined when the meta file is corrupt JSON', () => {
    const dir = path.join(home, '.nuka', 'tasks')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'corrupt.meta.json'), '{not json')
    expect(readMeta(home, 'corrupt')).toBeUndefined()
  })

  it('includes local-agent resume metadata in sidecar records', () => {
    const meta = fromTask({
      id: 'task-1',
      kind: 'local_agent',
      description: 'core:reviewer: continue',
      state: 'running',
      startedAt: 10,
      outputFile: '/tmp/task-1.log',
      agentId: 'agent-123',
      spec: {
        kind: 'local_agent',
        description: 'core:reviewer: continue',
        agentId: 'agent-123',
        agentName: 'core:reviewer',
        task: 'continue from here',
        context: 'old context\n\nnew facts',
        resumed: true,
        providerId: 'p',
        model: 'm',
        agentRunner: async function* () { yield { text: 'ok' } },
      },
    })

    expect(meta).toMatchObject({
      id: 'task-1',
      agentId: 'agent-123',
      agentName: 'core:reviewer',
      agentTask: 'continue from here',
      agentContext: 'old context\n\nnew facts',
      resumed: true,
      providerId: 'p',
      model: 'm',
    })
  })

  it('finds the newest sidecar for a stable local-agent id', () => {
    writeMeta(home, {
      id: 'older',
      kind: 'local_agent',
      state: 'completed',
      startedAt: 10,
      agentId: 'agent-123',
      agentName: 'core:reviewer',
    })
    writeMeta(home, {
      id: 'newer',
      kind: 'local_agent',
      state: 'completed',
      startedAt: 30,
      agentId: 'agent-123',
      agentName: 'core:reviewer',
      agentContext: 'latest context',
    })
    writeMeta(home, {
      id: 'other',
      kind: 'local_agent',
      state: 'completed',
      startedAt: 40,
      agentId: 'agent-other',
      agentName: 'core:other',
    })

    const found = findLatestMetaByAgentId(home, 'agent-123')

    expect(found?.id).toBe('newer')
    expect(found?.agentContext).toBe('latest context')
  })
})
