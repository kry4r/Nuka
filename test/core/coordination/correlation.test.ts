import { describe, it, expect, vi } from 'vitest'
import { generateCorrelationTests } from '../../../src/core/coordination/correlation'
import { TaskGraph } from '../../../src/core/coordination/taskGraph'

describe('generateCorrelationTests', () => {
  const mk = (id: string, dependsOn: string[] = []): Parameters<TaskGraph['add']>[0] => ({
    id,
    title: id,
    profile: 'feature',
    testStrategy: 'tdd',
    agentId: null,
    status: 'pending',
    dependsOn,
    contextFor: [],
    result: null,
  })

  it('无 correlations 返回 []', async () => {
    const g = new TaskGraph({ rootMessage: 'r', difficulty: 'medium' })
    g.add(mk('a'))
    g.add(mk('b'))
    const fork = vi.fn()
    const specs = await generateCorrelationTests({ graph: g, runFork: fork })
    expect(specs).toEqual([])
    expect(fork).not.toHaveBeenCalled()
  })

  it('有 correlations 时为每对生成一个 spec', async () => {
    const g = new TaskGraph({ rootMessage: 'r', difficulty: 'hard' })
    g.add(mk('a'))
    g.add(mk('b'))
    g.add(mk('c'))
    g.link('a', 'b', 'a&b share state')
    g.link('a', 'c', 'a&c share schema')
    const fork = vi.fn().mockResolvedValue({ text: 'describe("test", () => { it("works", () => {}) })' })
    const specs = await generateCorrelationTests({ graph: g, runFork: fork })
    expect(specs).toHaveLength(2)
    expect(specs[0].testFile).toContain('test/correlation/')
    expect(specs[0].testFile).toMatch(/\.test\.ts$/)
    expect(specs[0].body).toContain('describe')
  })

  it('LLM fork 失败时使用 fallback 模板', async () => {
    const g = new TaskGraph({ rootMessage: 'r', difficulty: 'hard' })
    g.add(mk('a'))
    g.add(mk('b'))
    g.link('a', 'b', 'shared module X')
    const fork = vi.fn().mockRejectedValue(new Error('LLM down'))
    const specs = await generateCorrelationTests({ graph: g, runFork: fork })
    expect(specs).toHaveLength(1)
    expect(specs[0].body).toContain('TODO')
    expect(specs[0].body).toContain('shared module X')
  })

  it('文件名基于 hash 稳定', async () => {
    const g = new TaskGraph({ rootMessage: 'r', difficulty: 'hard' })
    g.add(mk('a'))
    g.add(mk('b'))
    g.link('a', 'b', 'reason')
    const fork = vi.fn().mockResolvedValue({ text: 'x' })
    const r1 = await generateCorrelationTests({ graph: g, runFork: fork })
    const r2 = await generateCorrelationTests({ graph: g, runFork: fork })
    expect(r1[0].testFile).toBe(r2[0].testFile)
  })
})
