import { describe, it, expect, vi } from 'vitest'
import { makeHarnessCommand } from '../../src/slash/harness'

const fakeTriage = { profile: 'feature', difficulty: 'medium', testStrategy: 'tdd', reasoning: 'r', userConfirmed: true }

describe('/harness', () => {
  it('deep sets mode', async () => {
    const harness = {
      setMode: vi.fn(),
      snapshot: () => ({ mode: 'deep', sessionId: 's', triage: null, currentStage: null, history: [], scratchpadPath: '/x', taskGraphPath: '/y', startedAt: 0 }),
    }
    const cmd = makeHarnessCommand(harness as any)
    const result = await cmd.run('deep', {} as any)
    expect(harness.setMode).toHaveBeenCalledWith('deep')
    expect(result.type).toBe('text')
    expect((result as any).text).toContain('deep')
  })

  it('status prints snapshot with three-axis triage', async () => {
    const harness = {
      snapshot: () => ({
        sessionId: 's',
        mode: 'deep',
        triage: fakeTriage,
        currentStage: 'plan',
        history: [],
        scratchpadPath: '/x',
        taskGraphPath: '/y',
        startedAt: 0,
      }),
    }
    const cmd = makeHarnessCommand(harness as any)
    const result = await cmd.run('status', {} as any)
    expect(result.type).toBe('text')
    const text = (result as any).text as string
    expect(text).toContain('feature')
    expect(text).toContain('medium')
    expect(text).toContain('tdd')
  })

  it('transition refuses invalid', async () => {
    const harness = { transition: vi.fn(async () => { throw new Error('refused: forbidden') }) }
    const cmd = makeHarnessCommand(harness as any)
    const result = await cmd.run('transition implement', {} as any)
    expect(result.type).toBe('text')
    expect((result as any).text).toMatch(/refused/)
  })
})
