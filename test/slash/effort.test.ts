// test/slash/effort.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EffortCommand } from '../../src/slash/effort'
import { SlashRegistry } from '../../src/slash/registry'
import type { SlashContext } from '../../src/slash/types'

vi.mock('../../src/core/config/save', () => ({
  saveConfigPatch: vi.fn().mockResolvedValue(undefined),
  saveTheme: vi.fn(),
  saveActiveSelection: vi.fn(),
  saveProviderSelectedModel: vi.fn(),
  saveVimEnabled: vi.fn(),
  saveStatusBarHidden: vi.fn(),
  addProvider: vi.fn(),
}))

function makeCtx(model = 'claude-sonnet-4-6'): SlashContext {
  return {
    sessions: { active: () => ({ id: 's1', model, providerId: 'anthropic' }) } as any,
    providers: {} as any,
    config: {} as any,
  }
}

describe('/effort command', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('registers in SlashRegistry without conflict', () => {
    const reg = new SlashRegistry()
    reg.register(EffortCommand)
    expect(reg.find('effort')?.name).toBe('effort')
  })

  it('no args opens the effort-picker dialog', async () => {
    const result = await EffortCommand.run('', makeCtx())
    expect(result.type).toBe('dialog')
    expect((result as any).dialog).toEqual({ kind: 'effort-picker' })
  })

  it('valid arg persists via saveConfigPatch', async () => {
    const { saveConfigPatch } = await import('../../src/core/config/save')
    const ctx = makeCtx()
    const result = await EffortCommand.run('high', ctx)
    expect(result.type).toBe('text')
    expect((result as any).text).toContain('high')
    expect(saveConfigPatch).toHaveBeenCalled()
    // Mutator sets obj.effort = 'high'
    const mutator = (saveConfigPatch as any).mock.calls[0][1]
    const obj: any = {}
    mutator(obj)
    expect(obj.effort).toBe('high')
    // Mirrors onto ctx.config
    expect((ctx.config as any).effort).toBe('high')
  })

  it('invalid arg returns error text', async () => {
    const result = await EffortCommand.run('extreme', makeCtx())
    expect(result.type).toBe('text')
    expect((result as any).text).toMatch(/Invalid effort/)
  })

  it('warns when active model does not support thinking', async () => {
    const result = await EffortCommand.run('high', makeCtx('gpt-4o-mini'))
    expect(result.type).toBe('text')
    expect((result as any).text).toMatch(/does not support reasoning/)
  })

  it('does not warn when active model supports thinking', async () => {
    const result = await EffortCommand.run('low', makeCtx('claude-opus-4-7'))
    expect(result.type).toBe('text')
    expect((result as any).text).not.toMatch(/does not support reasoning/)
  })
})
