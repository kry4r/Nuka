// test/slash/theme.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ThemeCommand } from '../../src/slash/theme'
import type { SlashContext } from '../../src/slash/types'

// ---------------------------------------------------------------------------
// Mock saveTheme so we don't touch the real filesystem
// ---------------------------------------------------------------------------
vi.mock('../../src/core/config/save', () => ({
  saveTheme: vi.fn().mockResolvedValue(undefined),
  saveActiveSelection: vi.fn(),
  saveProviderSelectedModel: vi.fn(),
  saveVimEnabled: vi.fn(),
  addProvider: vi.fn(),
}))

function makeCtx(themeName?: string): SlashContext {
  return {
    sessions: { active: () => ({ id: 's1', model: 'claude-sonnet-4-6', providerId: 'anthropic' }) } as any,
    providers: {} as any,
    config: themeName ? { theme: { name: themeName } } as any : {} as any,
  }
}

describe('/theme command', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('/theme list shows all five themes', async () => {
    const result = await ThemeCommand.run('list', makeCtx())
    expect(result.type).toBe('text')
    const text = (result as any).text as string
    expect(text).toContain('default-dark')
    expect(text).toContain('default-light')
    expect(text).toContain('solarized-dark')
    expect(text).toContain('solarized-light')
    expect(text).toContain('high-contrast')
  })

  it('/theme list marks the active theme with *', async () => {
    const result = await ThemeCommand.run('list', makeCtx('solarized-dark'))
    const text = (result as any).text as string
    expect(text).toContain('solarized-dark *')
    // Other themes should not have *
    expect(text).not.toMatch(/default-dark \*/)
  })

  it('/theme <name> switches to a valid theme', async () => {
    const { saveTheme } = await import('../../src/core/config/save')
    const result = await ThemeCommand.run('high-contrast', makeCtx())
    expect(result.type).toBe('text')
    expect((result as any).text).toContain('high-contrast')
    expect(saveTheme).toHaveBeenCalledWith(expect.any(String), 'high-contrast')
  })

  it('/theme <name> returns error for unknown theme', async () => {
    const result = await ThemeCommand.run('totally-unknown', makeCtx())
    expect(result.type).toBe('text')
    expect((result as any).text).toContain('not found')
  })

  it('/theme with no args shows current theme', async () => {
    const result = await ThemeCommand.run('', makeCtx('default-light'))
    expect(result.type).toBe('text')
    expect((result as any).text).toContain('default-light')
  })

  it('/theme with no args shows default-dark when no theme in config', async () => {
    const result = await ThemeCommand.run('', makeCtx())
    expect(result.type).toBe('text')
    expect((result as any).text).toContain('default-dark')
  })

  it('/theme <name> is case-insensitive (registry handles it)', async () => {
    const result = await ThemeCommand.run('HIGH-CONTRAST', makeCtx())
    expect(result.type).toBe('text')
    expect((result as any).text).toContain('high-contrast')
  })
})
