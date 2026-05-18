import { describe, it, expect } from 'vitest'
import { DEFAULT_BINDINGS } from '../../../src/core/keybindings/defaultBindings'

describe('DEFAULT_BINDINGS', () => {
  it('binds enter to chat:submit in Chat context', () => {
    const chat = DEFAULT_BINDINGS.find(b => b.context === 'Chat')
    expect(chat).toBeDefined()
    expect(chat?.bindings.enter).toBe('chat:submit')
  })

  it('binds up/down to history navigation in Chat context', () => {
    const chat = DEFAULT_BINDINGS.find(b => b.context === 'Chat')
    expect(chat?.bindings.up).toBe('history:previous')
    expect(chat?.bindings.down).toBe('history:next')
  })

  it('binds escape to vim:escape in Vim context', () => {
    const vim = DEFAULT_BINDINGS.find(b => b.context === 'Vim')
    expect(vim?.bindings.escape).toBe('vim:escape')
  })

  it('binds tab to mention:accept and escape to mention:dismiss in Mention context', () => {
    const mention = DEFAULT_BINDINGS.find(b => b.context === 'Mention')
    expect(mention?.bindings.tab).toBe('mention:accept')
    expect(mention?.bindings.escape).toBe('mention:dismiss')
  })

  it('all actions referenced are in the KEYBINDING_ACTIONS surface', async () => {
    const { KEYBINDING_ACTIONS } = await import('../../../src/core/keybindings/types')
    const acts = new Set<string>(KEYBINDING_ACTIONS)
    for (const block of DEFAULT_BINDINGS) {
      for (const action of Object.values(block.bindings)) {
        if (action !== null) expect(acts.has(action)).toBe(true)
      }
    }
  })
})
