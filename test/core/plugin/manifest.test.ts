import { describe, it, expect } from 'vitest'
import { PluginManifestSchema } from '../../../src/core/plugin/manifest'

describe('PluginManifestSchema', () => {
  it('parses a minimal manifest and applies defaults', () => {
    const result = PluginManifestSchema.parse({ name: 'foo' })
    expect(result.name).toBe('foo')
    expect(result.tools).toEqual([])
    expect(result.slashCommands).toEqual([])
    expect(result.skills).toEqual([])
    expect(result.mcpServers).toEqual({})
  })

  it('rejects a name with spaces', () => {
    expect(() => PluginManifestSchema.parse({ name: 'Has Space' })).toThrow()
  })

  it('rejects a name with uppercase letters', () => {
    expect(() => PluginManifestSchema.parse({ name: 'up-PER' })).toThrow()
  })

  it('accepts mcpServers with a stdio entry', () => {
    const result = PluginManifestSchema.parse({
      name: 'a',
      mcpServers: { s: { type: 'stdio', command: 'node' } },
    })
    expect(result.mcpServers.s).toMatchObject({ type: 'stdio', command: 'node' })
  })
})
