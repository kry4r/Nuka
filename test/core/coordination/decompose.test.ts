import { describe, it, expect, vi } from 'vitest'
import { decomposeTask } from '../../../src/core/coordination/decompose'

const validJson = JSON.stringify({
  tasks: [
    { id: 't1', title: 'do A', profile: 'feature', testStrategy: 'tdd' },
    { id: 't2', title: 'do B', profile: 'feature', testStrategy: 'cross-module' },
  ],
  edges: [['t1', 't2', 't1 must finish first']],
})

describe('decomposeTask', () => {
  it('解析有效 JSON 返回 TaskGraph', async () => {
    const fork = vi.fn().mockResolvedValue({ text: validJson })
    const g = await decomposeTask({
      rootMessage: 'big task',
      profile: 'feature',
      difficulty: 'hard',
      runFork: fork,
    })
    const snap = g.snapshot()
    expect(Object.keys(snap.nodes).sort()).toEqual(['t1', 't2'])
    expect(snap.nodes.t2.dependsOn).toContain('t1')
    expect(snap.correlations).toHaveLength(1)
  })

  it('JSON 损坏时重试', async () => {
    const fork = vi
      .fn<(prompt: string) => Promise<{ text: string }>>()
      .mockResolvedValueOnce({ text: 'garbage' })
      .mockResolvedValueOnce({ text: validJson })
    const g = await decomposeTask({
      rootMessage: 'x',
      profile: 'feature',
      difficulty: 'hard',
      runFork: fork,
    })
    expect(fork).toHaveBeenCalledTimes(2)
    expect(Object.keys(g.snapshot().nodes)).toHaveLength(2)
  })

  it('两次失败 fallback 单点 graph', async () => {
    const fork = vi.fn().mockResolvedValue({ text: 'still garbage' })
    const g = await decomposeTask({
      rootMessage: 'do a thing',
      profile: 'debug-fix',
      difficulty: 'hard',
      runFork: fork,
    })
    const snap = g.snapshot()
    expect(Object.keys(snap.nodes)).toHaveLength(1)
    const onlyTask = Object.values(snap.nodes)[0]
    expect(onlyTask.title).toBe('do a thing')
    expect(onlyTask.profile).toBe('debug-fix')
  })

  it('支持 ```json 包裹的输出', async () => {
    const wrapped = '```json\n' + validJson + '\n```'
    const fork = vi.fn().mockResolvedValue({ text: wrapped })
    const g = await decomposeTask({
      rootMessage: 'x',
      profile: 'feature',
      difficulty: 'hard',
      runFork: fork,
    })
    expect(Object.keys(g.snapshot().nodes)).toHaveLength(2)
  })

  it('保留 difficulty 在生成的 graph 中', async () => {
    const fork = vi.fn().mockResolvedValue({ text: validJson })
    const g = await decomposeTask({
      rootMessage: 'x',
      profile: 'feature',
      difficulty: 'hell',
      runFork: fork,
    })
    expect(g.snapshot().difficulty).toBe('hell')
  })
})
