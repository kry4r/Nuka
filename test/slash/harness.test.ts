import { describe, it, expect, vi } from 'vitest'
import { makeHarnessCommand } from '../../src/slash/harness'

describe('/harness', () => {
  it('deep sets mode', async () => {
    const harness = { setMode: vi.fn(), snapshot: () => ({ mode: 'deep', sessionId: 's', taskProfile: null, currentStage: null, history: [], scratchpadPath: '/x', startedAt: 0 }) }
    const cmd = makeHarnessCommand(harness as any)
    const result = await cmd.run('deep', {} as any)
    expect(harness.setMode).toHaveBeenCalledWith('deep')
    expect(result.type).toBe('text')
    expect((result as any).text).toContain('deep')
  })
  it('status prints snapshot', async () => {
    const harness = { snapshot: () => ({ sessionId: 's', mode: 'deep', taskProfile: 'feature', currentStage: 'plan', history: [], scratchpadPath: '/x', startedAt: 0 }) }
    const cmd = makeHarnessCommand(harness as any)
    const result = await cmd.run('status', {} as any)
    expect(result.type).toBe('text')
    expect((result as any).text).toContain('feature')
  })
  it('transition refuses invalid', async () => {
    const harness = { transition: vi.fn(async () => { throw new Error('refused: forbidden') }) }
    const cmd = makeHarnessCommand(harness as any)
    const result = await cmd.run('transition implement', {} as any)
    expect(result.type).toBe('text')
    expect((result as any).text).toMatch(/refused/)
  })
})
