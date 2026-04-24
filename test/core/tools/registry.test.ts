// test/core/tools/registry.test.ts
import { describe, it, expect, vi } from 'vitest'
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

const fakeMcp: Tool = {
  name: 'McpSearch',
  description: 'mcp search tool',
  parameters: { type: 'object', properties: {} },
  source: 'mcp',
  needsPermission: () => 'network',
  run: async () => ({ output: '', isError: false }),
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

  it('logs and skips on duplicate name, returns { registered: false, reason: "duplicate" }', () => {
    const r = new ToolRegistry()
    const second: Tool = { ...fake, source: 'mcp' }
    r.register(fake)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = r.register(second)
    expect(result).toEqual({ registered: false, reason: 'duplicate' })
    expect(warnSpy).toHaveBeenCalledOnce()
    expect(r.find('Echo')!.source).toBe('builtin')
    warnSpy.mockRestore()
  })

  it('bySource returns only tools matching the given source', () => {
    const r = new ToolRegistry()
    r.register(fake)
    r.register(fakeMcp)
    expect(r.bySource('builtin')).toEqual([fake])
    expect(r.bySource('mcp')).toEqual([fakeMcp])
    expect(r.bySource('skill')).toEqual([])
    expect(r.bySource('plugin')).toEqual([])
  })
})
