import { describe, it, expect } from 'vitest'
import { KeybindingsSchema } from '../../../src/core/keybindings/schema'

describe('KeybindingsSchema', () => {
  it('accepts a minimal valid file', () => {
    const parsed = KeybindingsSchema.parse({
      bindings: [
        { context: 'Chat', bindings: { enter: 'chat:submit' } },
      ],
    })
    expect(parsed.bindings).toHaveLength(1)
  })

  it('allows null values for explicit unbinding', () => {
    const parsed = KeybindingsSchema.parse({
      bindings: [{ context: 'Chat', bindings: { up: null } }],
    })
    expect(parsed.bindings[0]?.bindings.up).toBeNull()
  })

  it('rejects an unknown context', () => {
    expect(() =>
      KeybindingsSchema.parse({
        bindings: [{ context: 'Bogus', bindings: { enter: 'chat:submit' } }],
      }),
    ).toThrow()
  })

  it('rejects an unknown action', () => {
    expect(() =>
      KeybindingsSchema.parse({
        bindings: [{ context: 'Chat', bindings: { enter: 'chat:nope' } }],
      }),
    ).toThrow()
  })

  it('accepts an empty bindings array', () => {
    const parsed = KeybindingsSchema.parse({ bindings: [] })
    expect(parsed.bindings).toEqual([])
  })
})
