import { describe, it, expect, vi } from 'vitest'
import { RecapCommand } from '../../src/slash/recap'

describe('/recap', () => {
  it('invokes buildRecap and prints + persists', async () => {
    const mockBuild = vi.fn().mockResolvedValue({
      session: 's1', generatedAt: 0, scope: { kind: 'full' as const },
      fields: {
        completed: [], inFlight: [], fileDiffs: [], toolTimeline: [],
        messages: [], pipelines: [], tokens: { perAgent: {} },
        nextStep: 'x', keyDecisions: [],
      },
    })
    const mockPersist = vi.fn().mockResolvedValue('/tmp/recap.md')

    const ctx = {
      sessions: { active: () => ({ id: 's1', messages: [], providerId: 'p1', model: 'm1' }) },
      providers: { resolveFor: () => ({ provider: {}, model: 'm1' }) },
      config: { providers: [], active: { providerId: 'p1' } },
      taskManager: {},
    } as any

    // Inject test overrides via module-level override pattern
    const result = await RecapCommand.run('', { ...ctx, _buildRecap: mockBuild, _persistRecap: mockPersist } as any)
    expect(result.type).toBe('text')
    expect((result as any).text).toContain('## ✅ Completed')
    expect(mockBuild).toHaveBeenCalled()
    expect(mockPersist).toHaveBeenCalled()
  })

  it('accepts --since flag', async () => {
    const mockBuild = vi.fn().mockResolvedValue({
      session: 's1', generatedAt: 0, scope: { kind: 'since', ms: 3600_000 },
      fields: {
        completed: [], inFlight: [], fileDiffs: [], toolTimeline: [],
        messages: [], pipelines: [], tokens: { perAgent: {} },
        nextStep: 'y', keyDecisions: [],
      },
    })
    const mockPersist = vi.fn().mockResolvedValue('/tmp/recap2.md')
    const ctx = {
      sessions: { active: () => ({ id: 's2', messages: [], providerId: 'p1', model: 'm1' }) },
      providers: { resolveFor: () => ({ provider: {}, model: 'm1' }) },
      config: { providers: [], active: { providerId: 'p1' } },
    } as any
    const result = await RecapCommand.run('--since 1h', { ...ctx, _buildRecap: mockBuild, _persistRecap: mockPersist } as any)
    expect(result.type).toBe('text')
    const buildCall = mockBuild.mock.calls[0]?.[0]
    expect(buildCall?.scope).toEqual({ kind: 'since', ms: 3600_000 })
  })
})
