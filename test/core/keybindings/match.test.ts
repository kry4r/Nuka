import { describe, it, expect } from 'vitest'
import { matchesKeystroke, getKeyName } from '../../../src/core/keybindings/match'
import { parseKeystroke } from '../../../src/core/keybindings/parser'
import type { InkLikeKey } from '../../../src/core/keybindings/match'

function key(partial: Partial<InkLikeKey> = {}): InkLikeKey {
  return {
    ctrl: false, shift: false, meta: false, super: false,
    escape: false, return: false, tab: false, backspace: false, delete: false,
    upArrow: false, downArrow: false, leftArrow: false, rightArrow: false,
    pageUp: false, pageDown: false, home: false, end: false,
    ...partial,
  }
}

describe('getKeyName', () => {
  it('maps key.return to "enter"', () => {
    expect(getKeyName('', key({ return: true }))).toBe('enter')
  })
  it('maps key.escape to "escape"', () => {
    expect(getKeyName('', key({ escape: true }))).toBe('escape')
  })
  it('lowercases single-character input', () => {
    expect(getKeyName('K', key())).toBe('k')
  })
  it('returns null for empty input with no special key', () => {
    expect(getKeyName('', key())).toBeNull()
  })
})

describe('matchesKeystroke', () => {
  it('matches plain enter', () => {
    const target = parseKeystroke('enter')
    expect(matchesKeystroke('', key({ return: true }), target)).toBe(true)
  })

  it('matches ctrl+c', () => {
    const target = parseKeystroke('ctrl+c')
    expect(matchesKeystroke('c', key({ ctrl: true }), target)).toBe(true)
  })

  it('rejects ctrl+c when ctrl missing', () => {
    const target = parseKeystroke('ctrl+c')
    expect(matchesKeystroke('c', key(), target)).toBe(false)
  })

  it('alt and meta are equivalent at the matcher level', () => {
    const target = parseKeystroke('alt+v')
    // ink reports alt-key as meta=true
    expect(matchesKeystroke('v', key({ meta: true }), target)).toBe(true)
  })

  it('escape ignores ink quirk where key.meta is true on escape', () => {
    const target = parseKeystroke('escape')
    expect(matchesKeystroke('', key({ escape: true, meta: true }), target)).toBe(true)
  })
})
