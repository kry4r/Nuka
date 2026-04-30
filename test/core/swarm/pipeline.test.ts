import { describe, it, expect } from 'vitest'
import { topoLevels, runPipeline } from '../../../src/core/swarm/pipeline'

describe('topoLevels', () => {
  it('handles a 4-node diamond: a → b,c → d', () => {
    const nodes = [
      { id: 'a', agent: 'x', prompt: '', next: ['b', 'c'], timeoutMs: 0 },
      { id: 'b', agent: 'x', prompt: '', next: ['d'], timeoutMs: 0 },
      { id: 'c', agent: 'x', prompt: '', next: ['d'], timeoutMs: 0 },
      { id: 'd', agent: 'x', prompt: '', next: [], timeoutMs: 0 },
    ]
    expect(topoLevels(nodes, 'a')).toEqual([['a'], ['b', 'c'], ['d']])
  })
  it('throws on cycle', () => {
    expect(() => topoLevels([{ id: 'a', agent: 'x', prompt: '', next: ['a'], timeoutMs: 0 }], 'a')).toThrow(/cycle/i)
  })
})

describe('runPipeline (with fake worker)', () => {
  it('runs 3 stages in order, threading {{prev}}', async () => {
    const log: string[] = []
    const fakeWorker = async (nodeId: string, prompt: string): Promise<string> => {
      log.push(`${nodeId}:${prompt}`)
      return `output-${nodeId}`
    }
    const r = await runPipeline({
      input: {
        entry: 'a',
        nodes: [
          { id: 'a', agent: 'x', prompt: 'first {{prev}}', next: ['b'], timeoutMs: 0 },
          { id: 'b', agent: 'x', prompt: 'second {{prev}}', next: ['c'], timeoutMs: 0 },
          { id: 'c', agent: 'x', prompt: 'third {{prev}}', next: [], timeoutMs: 0 },
        ],
      },
      runStage: fakeWorker,
    })
    expect(r.ok).toBe(true)
    expect(log).toEqual(['a:first ', 'b:second output-a', 'c:third output-b'])
  })
})
