import { describe, it, expect, vi } from 'vitest'
import { triageMessage } from '../../../src/core/harness/triage'

const validJson = JSON.stringify({
  profile: 'feature',
  difficulty: 'medium',
  testStrategy: 'tdd',
  reasoning: 'looks routine',
})

describe('triage', () => {
  it('解析有效 JSON', async () => {
    const fork = vi.fn().mockResolvedValue({ text: validJson })
    const t = await triageMessage({ userMessage: 'add login', repoSummary: '', runFork: fork })
    expect(t.profile).toBe('feature')
    expect(t.difficulty).toBe('medium')
    expect(t.testStrategy).toBe('tdd')
    expect(t.reasoning).toBe('looks routine')
    expect(t.userConfirmed).toBe(false)
  })

  it('JSON 损坏时重试一次', async () => {
    const fork = vi
      .fn<(prompt: string) => Promise<{ text: string }>>()
      .mockResolvedValueOnce({ text: 'garbage' })
      .mockResolvedValueOnce({ text: validJson })
    const t = await triageMessage({ userMessage: 'x', repoSummary: '', runFork: fork })
    expect(fork).toHaveBeenCalledTimes(2)
    expect(t.profile).toBe('feature')
  })

  it('两次失败 fallback 到 {feature, medium, tdd}', async () => {
    const fork = vi.fn().mockResolvedValue({ text: 'still garbage' })
    const t = await triageMessage({ userMessage: 'x', repoSummary: '', runFork: fork })
    expect(t).toMatchObject({ profile: 'feature', difficulty: 'medium', testStrategy: 'tdd' })
    expect(t.reasoning).toContain('fallback')
    expect(t.userConfirmed).toBe(false)
  })

  it('支持 ```json 代码块包裹', async () => {
    const wrapped = '```json\n' + validJson + '\n```'
    const fork = vi.fn().mockResolvedValue({ text: wrapped })
    const t = await triageMessage({ userMessage: 'x', repoSummary: '', runFork: fork })
    expect(t.profile).toBe('feature')
  })

  it('拒绝枚举之外的值，触发重试', async () => {
    const bad = JSON.stringify({ profile: 'unknown', difficulty: 'medium', testStrategy: 'tdd', reasoning: 'r' })
    const fork = vi
      .fn<(prompt: string) => Promise<{ text: string }>>()
      .mockResolvedValueOnce({ text: bad })
      .mockResolvedValueOnce({ text: validJson })
    const t = await triageMessage({ userMessage: 'x', repoSummary: '', runFork: fork })
    expect(fork).toHaveBeenCalledTimes(2)
    expect(t.profile).toBe('feature')
  })
})
