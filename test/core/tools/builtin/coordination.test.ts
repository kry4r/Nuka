import { describe, it, expect, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { makeCoordinationDecomposeTool } from '../../../../src/core/tools/builtin/coordinationDecompose'
import { makeCoordinationStatusTool } from '../../../../src/core/tools/builtin/coordinationStatus'
import { makeCoordinationA2aSendTool } from '../../../../src/core/tools/builtin/coordinationA2aSend'

const validDecompose = JSON.stringify({
  tasks: [
    { id: 't1', title: 'A', profile: 'feature', testStrategy: 'tdd' },
    { id: 't2', title: 'B', profile: 'feature', testStrategy: 'tdd' },
  ],
  edges: [['t1', 't2', 'order']],
})

describe('coordination_decompose tool', () => {
  it('persists graph + returns summary', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-c-'))
    const graphPath = path.join(tmp, 'g.json')
    const tool = makeCoordinationDecomposeTool({
      runFork: vi.fn().mockResolvedValue({ text: validDecompose }),
      graphPath: () => graphPath,
    })
    const r = await tool.run({ rootMessage: 'r', profile: 'feature', difficulty: 'hard' }, {} as never)
    expect(r.isError).toBe(false)
    expect(JSON.parse(r.output as string).taskCount).toBe(2)
    expect(fs.existsSync(graphPath)).toBe(true)
  })
})

describe('coordination_status tool', () => {
  it('returns empty graph if file missing', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-s-'))
    const tool = makeCoordinationStatusTool({
      graphPath: () => path.join(tmp, 'nope.json'),
      subsPath: () => path.join(tmp, 'nope.subs.json'),
    })
    const r = await tool.run({}, {} as never)
    const parsed = JSON.parse(r.output as string)
    expect(parsed.graph.nodes).toEqual({})
    expect(parsed.subscriptions).toEqual([])
  })
})

describe('coordination_a2a_send tool', () => {
  it('delegates to router.send', async () => {
    const send = vi.fn().mockResolvedValue(true)
    const router = { send } as never
    const tool = makeCoordinationA2aSendTool({ router })
    const r = await tool.run(
      { fromAgentId: 'agent1', toAgentId: 'agent2', body: 'hello', reason: 'manual' },
      {} as never,
    )
    expect(r.isError).toBe(false)
    expect(send).toHaveBeenCalled()
    const env = send.mock.calls[0][0]
    expect(env.from).toBe('agent1')
    expect(env.to).toBe('agent2')
  })
})
