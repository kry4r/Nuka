import { describe, it, expect, vi } from 'vitest'
import { confirmTriage } from '../../../src/core/harness/triage'
import type { Triage } from '../../../src/core/harness/types'

const baseTriage: Triage = {
  profile: 'feature',
  difficulty: 'medium',
  testStrategy: 'tdd',
  reasoning: 'r',
  userConfirmed: false,
}

describe('confirmTriage', () => {
  it('用户回复 ok 时直接 commit (userConfirmed=true)', async () => {
    const askUser = vi.fn().mockResolvedValue('ok')
    const runFork = vi.fn()
    const t = await confirmTriage(baseTriage, { askUser, runFork })
    expect(t.userConfirmed).toBe(true)
    expect(runFork).not.toHaveBeenCalled()
  })

  it('用户回复 yes/确认 也算确认', async () => {
    const askUser = vi.fn().mockResolvedValue('yes please')
    const t = await confirmTriage(baseTriage, { askUser, runFork: vi.fn() })
    expect(t.userConfirmed).toBe(true)
  })

  it('用户回复 hint 触发再次 fork (userConfirmed=true on second JSON)', async () => {
    const askUser = vi.fn().mockResolvedValue('actually this is hard')
    const runFork = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        profile: 'feature',
        difficulty: 'hard',
        testStrategy: 'cross-module',
        reasoning: 'user hinted hard',
      }),
    })
    const t = await confirmTriage(baseTriage, { askUser, runFork })
    expect(runFork).toHaveBeenCalledTimes(1)
    expect(t.difficulty).toBe('hard')
    expect(t.testStrategy).toBe('cross-module')
    expect(t.userConfirmed).toBe(true)
  })

  it('refork 失败时保留原 triage 但标记 userConfirmed=true', async () => {
    const askUser = vi.fn().mockResolvedValue('hmm not sure')
    const runFork = vi.fn().mockResolvedValue({ text: 'garbage' })
    const t = await confirmTriage(baseTriage, { askUser, runFork })
    expect(t.profile).toBe('feature')
    expect(t.difficulty).toBe('medium')
    expect(t.userConfirmed).toBe(true)
    expect(t.reasoning).toContain('user hint did not yield')
  })
})
