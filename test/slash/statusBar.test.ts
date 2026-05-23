import { describe, expect, it } from 'vitest'
import { StatusBarCommand } from '../../src/slash/statusBar'
import type { SlashContext } from '../../src/slash/types'

function ctx(): SlashContext {
  return {
    sessions: {} as any,
    providers: { getProviderConfig: () => undefined, listProviders: () => [] } as any,
    config: { providers: [], active: { providerId: '' }, statusBar: { hidden: [], layout: 'dense', iconMode: 'icon' } } as any,
  }
}

describe('/status-bar', () => {
  it('lists the goal segment so it can be discovered and toggled', async () => {
    const result = await StatusBarCommand.run('', ctx())

    expect(result.type).toBe('text')
    if (result.type === 'text') {
      expect(result.text).toContain('✓ goal')
    }
    expect(StatusBarCommand.args?.find(arg => arg.name === 'segment')?.choices).toContain('goal')
  })

  it('includes goal in the known segment error text', async () => {
    const result = await StatusBarCommand.run('hide missing', ctx())

    expect(result.type).toBe('text')
    if (result.type === 'text') {
      expect(result.text).toContain('unknown segment: missing')
      expect(result.text).toContain('goal')
    }
  })
})
