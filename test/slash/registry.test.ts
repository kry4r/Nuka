import { describe, it, expect } from 'vitest'
import { SlashRegistry } from '../../src/slash/registry'
import type { SlashCommand } from '../../src/slash/types'

const exit: SlashCommand = {
  name: 'exit',
  description: 'quit',
  run: async () => ({ type: 'exit' }),
}

describe('SlashRegistry', () => {
  it('registers and looks up by name (with or without leading slash)', () => {
    const r = new SlashRegistry()
    r.register(exit)
    expect(r.find('/exit')).toBe(exit)
    expect(r.find('exit')).toBe(exit)
    expect(r.find('/nope')).toBeUndefined()
  })

  it('parses "/name args rest" into name + args', () => {
    expect(SlashRegistry.parse('/btw hello world')).toEqual({
      name: 'btw',
      args: 'hello world',
    })
    expect(SlashRegistry.parse('/exit')).toEqual({ name: 'exit', args: '' })
    expect(SlashRegistry.parse('no slash')).toBeNull()
  })

  it('suggests starting-with matches for a prefix', () => {
    const r = new SlashRegistry()
    r.register(exit)
    r.register({ name: 'export', description: 'x', run: async () => ({ type: 'text', text: '' }) })
    expect(r.suggest('/ex').map(c => c.name).sort()).toEqual(['exit', 'export'])
  })
})
