import { describe, it, expect } from 'vitest'
import { buildResolver } from '../../../src/core/keybindings/resolver'
import type { InkLikeKey } from '../../../src/core/keybindings/match'
import type { KeybindingBlock } from '../../../src/core/keybindings/types'

function key(p: Partial<InkLikeKey> = {}): InkLikeKey {
  return {
    ctrl: false, shift: false, meta: false, super: false,
    escape: false, return: false, tab: false, backspace: false, delete: false,
    upArrow: false, downArrow: false, leftArrow: false, rightArrow: false,
    pageUp: false, pageDown: false, home: false, end: false,
    ...p,
  }
}

describe('buildResolver', () => {
  it('resolves enter → chat:submit from defaults in Chat context', () => {
    const resolve = buildResolver(null)
    expect(resolve('', key({ return: true }), 'Chat')).toBe('chat:submit')
  })

  it('returns null when no binding matches in the given context', () => {
    const resolve = buildResolver(null)
    expect(resolve('z', key(), 'Chat')).toBeNull()
  })

  it('global bindings fire from any context', () => {
    const user: KeybindingBlock[] = [
      { context: 'Global', bindings: { 'ctrl+l': 'chat:newline' } },
    ]
    const resolve = buildResolver(user)
    expect(resolve('l', key({ ctrl: true }), 'Chat')).toBe('chat:newline')
  })

  it('user override replaces default for same context+chord', () => {
    const user: KeybindingBlock[] = [
      { context: 'Chat', bindings: { enter: 'chat:newline' } },
    ]
    const resolve = buildResolver(user)
    expect(resolve('', key({ return: true }), 'Chat')).toBe('chat:newline')
  })

  it('null unbinds a default', () => {
    const user: KeybindingBlock[] = [
      { context: 'Chat', bindings: { enter: null } },
    ]
    const resolve = buildResolver(user)
    expect(resolve('', key({ return: true }), 'Chat')).toBeNull()
  })

  it('escape in Vim context resolves to vim:escape', () => {
    const resolve = buildResolver(null)
    expect(resolve('', key({ escape: true }), 'Vim')).toBe('vim:escape')
  })
})
