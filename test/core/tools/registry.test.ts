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

  describe('aliases', () => {
    it('tool is findable by primary name and alias', () => {
      const r = new ToolRegistry()
      const toolWithAlias: Tool = { ...fake, name: 'newName', aliases: ['oldName'] }
      r.register(toolWithAlias)
      expect(r.find('newName')).toBe(toolWithAlias)
      expect(r.find('oldName')).toBe(toolWithAlias)
    })

    it('find returns undefined for unknown names/aliases', () => {
      const r = new ToolRegistry()
      r.register({ ...fake, name: 'Tool', aliases: ['t1'] })
      expect(r.find('unknown')).toBeUndefined()
    })

    it('alias collision with existing primary name: alias skipped, primary still registered', () => {
      const r = new ToolRegistry()
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      r.register(fake) // name: Echo
      const tool2: Tool = { ...fake, name: 'NewTool', aliases: ['Echo'] }
      r.register(tool2)
      // NewTool primary should register fine
      expect(r.find('NewTool')).toBe(tool2)
      // Echo alias was skipped — still maps to original Echo
      expect(r.find('Echo')).toBe(fake)
      expect(warnSpy).toHaveBeenCalledOnce()
      warnSpy.mockRestore()
    })

    it('alias collision between two tools: second alias dropped with warning', () => {
      const r = new ToolRegistry()
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const t1: Tool = { ...fake, name: 'Tool1', aliases: ['shared'] }
      const t2: Tool = { ...fake, name: 'Tool2', aliases: ['shared'] }
      r.register(t1)
      r.register(t2)
      // t2 primary should still register
      expect(r.find('Tool2')).toBe(t2)
      // alias goes to first claimant
      expect(r.find('shared')).toBe(t1)
      expect(warnSpy).toHaveBeenCalledOnce()
      warnSpy.mockRestore()
    })

    it('aliases are not included in listSpecs (only primary names)', () => {
      const r = new ToolRegistry()
      r.register({ ...fake, name: 'MyTool', aliases: ['mt', 'myTool'] })
      const specs = r.listSpecs()
      expect(specs).toHaveLength(1)
      expect(specs[0]!.name).toBe('MyTool')
    })

    it('multiple aliases on same tool all resolve correctly', () => {
      const r = new ToolRegistry()
      const t: Tool = { ...fake, name: 'Tool', aliases: ['a1', 'a2', 'a3'] }
      r.register(t)
      expect(r.find('a1')).toBe(t)
      expect(r.find('a2')).toBe(t)
      expect(r.find('a3')).toBe(t)
    })
  })
})
