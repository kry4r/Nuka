// test/slash/statusHub.test.ts
//
// Phase 13 M3 — /status-hub slash command tests.
// Toggle icon/text mode, persist via saveConfigPatch, live-mirror to config.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StatusHubCommand } from '../../src/slash/statusHub'
import type { SlashContext } from '../../src/slash/types'
import type { Config } from '../../src/core/config/schema'

// ---- Stub saveConfigPatch ----
const mockSaveConfigPatch = vi.fn(async (_home: string, mutate: (obj: any) => void) => {
  mutate({})
})

vi.mock('../../src/core/config/save', () => ({
  saveConfigPatch: (...args: any[]) => mockSaveConfigPatch(...args),
}))

// ---- Helpers ----

function makeConfig(iconMode?: 'icon' | 'text'): Config {
  return {
    providers: [],
    active: { providerId: '' },
    statusBar: {
      hidden: [],
      layout: 'dense',
      iconMode: iconMode ?? 'icon',
    },
  } as any
}

function makeCtx(iconMode?: 'icon' | 'text'): SlashContext {
  return {
    config: makeConfig(iconMode),
    sessions: {} as any,
    providers: {} as any,
  }
}

describe('/status-hub', () => {
  beforeEach(() => {
    mockSaveConfigPatch.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('no-arg toggles from icon to text', async () => {
    const ctx = makeCtx('icon')
    const result = await StatusHubCommand.run('', ctx)
    expect(result.type).toBe('text')
    expect((result as any).text).toMatch(/text/)
    // Live-mirrors into config
    expect((ctx.config.statusBar as any).iconMode).toBe('text')
    // Persists
    expect(mockSaveConfigPatch).toHaveBeenCalledOnce()
  })

  it('no-arg toggles from text to icon', async () => {
    const ctx = makeCtx('text')
    const result = await StatusHubCommand.run('', ctx)
    expect(result.type).toBe('text')
    expect((result as any).text).toMatch(/icon/)
    expect((ctx.config.statusBar as any).iconMode).toBe('icon')
    expect(mockSaveConfigPatch).toHaveBeenCalledOnce()
  })

  it('explicit icon arg sets icon mode', async () => {
    const ctx = makeCtx('text')
    const result = await StatusHubCommand.run('icon', ctx)
    expect(result.type).toBe('text')
    expect((result as any).text).toMatch(/icon/)
    expect((ctx.config.statusBar as any).iconMode).toBe('icon')
  })

  it('explicit text arg sets text mode', async () => {
    const ctx = makeCtx('icon')
    const result = await StatusHubCommand.run('text', ctx)
    expect(result.type).toBe('text')
    expect((result as any).text).toMatch(/text/)
    expect((ctx.config.statusBar as any).iconMode).toBe('text')
  })

  it('unknown arg returns error text', async () => {
    const ctx = makeCtx('icon')
    const result = await StatusHubCommand.run('unknown', ctx)
    expect(result.type).toBe('text')
    expect((result as any).text).toContain('Unknown mode')
    // Should NOT have persisted anything
    expect(mockSaveConfigPatch).not.toHaveBeenCalled()
  })

  it('has correct metadata', () => {
    expect(StatusHubCommand.name).toBe('status-hub')
    expect(StatusHubCommand.source).toBe('builtin')
    expect(StatusHubCommand.usage).toMatch(/icon|text/)
    expect(StatusHubCommand.args).toBeDefined()
    expect(StatusHubCommand.examples).toBeDefined()
    expect(StatusHubCommand.examples!.length).toBeGreaterThanOrEqual(3)
  })

  it('result text format is "Status hub: <mode>"', async () => {
    const ctx = makeCtx('icon')
    const result = await StatusHubCommand.run('text', ctx)
    expect((result as any).text).toBe('Status hub: text')
  })
})
