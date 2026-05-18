import { describe, it, expect } from 'vitest'
import { parseKeystroke, parseChord, parseBindings } from '../../../src/core/keybindings/parser'
import type { KeybindingBlock } from '../../../src/core/keybindings/types'

describe('parseKeystroke', () => {
  it('parses a plain letter', () => {
    expect(parseKeystroke('a')).toEqual({
      key: 'a', ctrl: false, alt: false, shift: false, meta: false, super: false,
    })
  })

  it('parses ctrl+shift+k', () => {
    expect(parseKeystroke('ctrl+shift+k')).toEqual({
      key: 'k', ctrl: true, alt: false, shift: true, meta: false, super: false,
    })
  })

  it('treats cmd as super', () => {
    expect(parseKeystroke('cmd+c').super).toBe(true)
  })

  it('treats opt as alt', () => {
    expect(parseKeystroke('opt+v').alt).toBe(true)
  })

  it('normalizes esc to escape', () => {
    expect(parseKeystroke('esc').key).toBe('escape')
  })

  it('normalizes return to enter', () => {
    expect(parseKeystroke('return').key).toBe('enter')
  })
})

describe('parseChord', () => {
  it('parses a single keystroke chord', () => {
    expect(parseChord('enter')).toHaveLength(1)
  })

  it('parses a multi-keystroke chord with whitespace separator', () => {
    const chord = parseChord('ctrl+x ctrl+e')
    expect(chord).toHaveLength(2)
    expect(chord[0]?.key).toBe('x')
    expect(chord[1]?.key).toBe('e')
  })

  it('treats a literal single space as the space key', () => {
    const chord = parseChord(' ')
    expect(chord).toHaveLength(1)
    expect(chord[0]?.key).toBe(' ')
  })
})

describe('parseBindings', () => {
  it('flattens KeybindingBlocks into ParsedBindings, dropping nulls', () => {
    const blocks: KeybindingBlock[] = [
      { context: 'Chat', bindings: { enter: 'chat:submit', escape: null } },
    ]
    const parsed = parseBindings(blocks)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.action).toBe('chat:submit')
    expect(parsed[0]?.context).toBe('Chat')
  })
})
