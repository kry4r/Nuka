import { describe, it, expect } from 'vitest'
import type {
  ParsedKeystroke,
  KeybindingAction,
  KeybindingContext,
  KeybindingBlock,
  ParsedBinding,
} from '../../../src/core/keybindings/types'
import { KEYBINDING_CONTEXTS, KEYBINDING_ACTIONS } from '../../../src/core/keybindings/types'
import {
  buildResolver,
  readUserBindings,
  DEFAULT_BINDINGS,
  KEYBINDING_ACTIONS as KEYBINDING_ACTIONS_BARREL,
} from '../../../src/core/keybindings'

describe('keybinding types', () => {
  it('KEYBINDING_CONTEXTS includes Chat and Global', () => {
    expect(KEYBINDING_CONTEXTS).toContain('Chat')
    expect(KEYBINDING_CONTEXTS).toContain('Global')
  })

  it('KEYBINDING_ACTIONS covers the Nuka PromptInput surface', () => {
    expect(KEYBINDING_ACTIONS).toContain('chat:submit')
    expect(KEYBINDING_ACTIONS).toContain('chat:cancel')
    expect(KEYBINDING_ACTIONS).toContain('history:previous')
    expect(KEYBINDING_ACTIONS).toContain('history:next')
    expect(KEYBINDING_ACTIONS).toContain('mention:dismiss')
    expect(KEYBINDING_ACTIONS).toContain('slash:dismiss')
  })

  it('ParsedKeystroke has all five modifier flags', () => {
    const ks: ParsedKeystroke = {
      key: 'a',
      ctrl: false, alt: false, shift: false, meta: false, super: false,
    }
    expect(ks.key).toBe('a')
  })

  it('ParsedBinding pairs a chord with an action and context', () => {
    const b: ParsedBinding = {
      chord: [{ key: 'enter', ctrl: false, alt: false, shift: false, meta: false, super: false }],
      action: 'chat:submit',
      context: 'Chat',
    }
    const _block: KeybindingBlock = { context: 'Chat', bindings: { enter: 'chat:submit' } }
    const _ctx: KeybindingContext = 'Chat'
    const _act: KeybindingAction = 'chat:submit'
    expect(b.action).toBe('chat:submit')
  })
})

describe('keybindings index barrel', () => {
  it('re-exports the public surface', () => {
    expect(typeof buildResolver).toBe('function')
    expect(typeof readUserBindings).toBe('function')
    expect(Array.isArray(DEFAULT_BINDINGS)).toBe(true)
    expect(Array.isArray(KEYBINDING_ACTIONS_BARREL)).toBe(true)
  })
})
