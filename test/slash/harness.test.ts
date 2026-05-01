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

  it('retriage without deps returns a stub message', async () => {
    const harness = { setTriage: vi.fn() }
    const cmd = makeHarnessCommand(harness as any)
    const result = await cmd.run('retriage refactor the auth module', {} as any)
    expect(result.type).toBe('text')
    expect((result as any).text).toMatch(/unavailable/i)
    expect(harness.setTriage).not.toHaveBeenCalled()
  })

  it('retriage without a hint returns usage', async () => {
    const harness = { setTriage: vi.fn() }
    const cmd = makeHarnessCommand(harness as any, { runFork: vi.fn() })
    const result = await cmd.run('retriage', {} as any)
    expect(result.type).toBe('text')
    expect((result as any).text).toMatch(/usage/i)
    expect(harness.setTriage).not.toHaveBeenCalled()
  })

  it('retriage with deps re-runs classifier and writes result back', async () => {
    const harness = { setTriage: vi.fn() }
    const reply = JSON.stringify({
      profile: 'refactor',
      difficulty: 'hard',
      testStrategy: 'cross-module',
      reasoning: 're-classified per hint',
    })
    const runFork = vi.fn().mockResolvedValue({ text: reply })
    const cmd = makeHarnessCommand(harness as any, { runFork })
    const result = await cmd.run('retriage rework the auth boundary', {} as any)
    expect(runFork).toHaveBeenCalled()
    expect(harness.setTriage).toHaveBeenCalledTimes(1)
    const stored = harness.setTriage.mock.calls[0]![0]
    expect(stored.profile).toBe('refactor')
    expect(stored.difficulty).toBe('hard')
    expect((result as any).text).toContain('refactor')
    expect((result as any).text).toContain('hard')
  })
})
