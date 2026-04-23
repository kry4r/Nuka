// test/core/tools/registry.test.ts
import { describe, it, expect } from 'vitest'
import { ToolRegistry } from '../../../src/core/tools/registry'
import type { Tool } from '../../../src/core/tools/types'

const fake: Tool = {
  name: 'Echo',
  description: 'returns input.text',
  parameters: { type: 'object', properties: { text: { type: 'string' } } },
  source: 'builtin',
  needsPermission: () => 'none',
  run: async (input: any) => ({ output: String(input.text ?? ''), isError: false }),
}

describe('ToolRegistry', () => {
  it('registers and looks up by name', () => {
    const r = new ToolRegistry()
    r.register(fake)
    expect(r.find('Echo')).toBe(fake)
    expect(r.find('Nope')).toBeUndefined()
  })

  it('listSpecs returns ToolSpec for each registered tool', () => {
    const r = new ToolRegistry()
    r.register(fake)
    const specs = r.listSpecs()
    expect(specs).toHaveLength(1)
    expect(specs[0].name).toBe('Echo')
  })

  it('throws on duplicate name by default', () => {
    const r = new ToolRegistry()
    r.register(fake)
    expect(() => r.register(fake)).toThrow(/duplicate/)
  })
})
