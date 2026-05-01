// test/slash/triage.test.ts
//
// T8.1 — /triage command unit tests.
import { describe, it, expect, vi } from 'vitest'
import { makeTriageCommand, performTriage } from '../../src/slash/triage'

const goodReply = JSON.stringify({
  profile: 'feature',
  difficulty: 'hard',
  testStrategy: 'cross-module',
  reasoning: 'big surface change touching auth + db',
})

function mockHarness(): { setTriage: ReturnType<typeof vi.fn> } {
  return { setTriage: vi.fn() }
}

describe('/triage', () => {
  it('returns usage hint when called without an argument', async () => {
    const harness = mockHarness()
    const cmd = makeTriageCommand({
      harness: harness as any,
      runFork: vi.fn(),
    })
    const result = await cmd.run('', {} as any)
    expect(result.type).toBe('text')
    expect((result as any).text).toMatch(/usage/i)
    expect(harness.setTriage).not.toHaveBeenCalled()
  })

  it('classifies the message and writes back to the harness', async () => {
    const harness = mockHarness()
    const runFork = vi.fn().mockResolvedValue({ text: goodReply })
    const cmd = makeTriageCommand({
      harness: harness as any,
      runFork,
    })
    const result = await cmd.run('Add SSO login flow with provider X', {} as any)
    expect(result.type).toBe('text')
    expect(runFork).toHaveBeenCalled()
    expect(harness.setTriage).toHaveBeenCalledTimes(1)
    const stored = harness.setTriage.mock.calls[0]![0]
    expect(stored.profile).toBe('feature')
    expect(stored.difficulty).toBe('hard')
    expect(stored.testStrategy).toBe('cross-module')
    expect(stored.userConfirmed).toBe(false)
    const text = (result as any).text as string
    expect(text).toContain('feature')
    expect(text).toContain('hard')
    expect(text).toContain('cross-module')
  })

  it('runs the confirm flow when askUser is provided', async () => {
    const harness = mockHarness()
    const runFork = vi.fn().mockResolvedValue({ text: goodReply })
    const askUser = vi.fn().mockResolvedValue('ok')
    const cmd = makeTriageCommand({
      harness: harness as any,
      runFork,
      askUser,
    })
    await cmd.run('Add SSO login', {} as any)
    expect(askUser).toHaveBeenCalledTimes(1)
    const stored = harness.setTriage.mock.calls[0]![0]
    expect(stored.userConfirmed).toBe(true)
  })

  it('falls back gracefully when the LLM emits invalid JSON twice', async () => {
    const harness = mockHarness()
    const runFork = vi.fn().mockResolvedValue({ text: 'not json at all' })
    const cmd = makeTriageCommand({
      harness: harness as any,
      runFork,
    })
    const result = await cmd.run('Some task', {} as any)
    expect(result.type).toBe('text')
    expect(harness.setTriage).toHaveBeenCalled()
    const stored = harness.setTriage.mock.calls[0]![0]
    // Fallback values from triage.ts
    expect(stored.profile).toBe('feature')
    expect(stored.difficulty).toBe('medium')
    expect(stored.testStrategy).toBe('tdd')
    expect(stored.reasoning).toMatch(/fallback/i)
  })
})

describe('performTriage helper', () => {
  it('shares behaviour with the slash command', async () => {
    const harness = mockHarness()
    const runFork = vi.fn().mockResolvedValue({ text: goodReply })
    const result = await performTriage('Refactor auth code', {
      harness: harness as any,
      runFork,
    })
    expect(result.type).toBe('text')
    expect(harness.setTriage).toHaveBeenCalledTimes(1)
  })

  it('rejects empty messages', async () => {
    const harness = mockHarness()
    const result = await performTriage('   ', {
      harness: harness as any,
      runFork: vi.fn(),
    })
    expect(result.type).toBe('text')
    expect((result as any).text).toMatch(/usage/i)
    expect(harness.setTriage).not.toHaveBeenCalled()
  })
})
