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

  describe('metadata fields', () => {
    it('parses all optional metadata fields', () => {
      const result = PluginManifestSchema.parse({
        name: 'my-plugin',
        version: '1.2.3',
        description: 'A great plugin',
        author: 'Jane Doe <jane@example.com>',
        homepage: 'https://example.com',
        repository: 'https://github.com/example/my-plugin',
        license: 'MIT',
        keywords: ['productivity', 'ai'],
      })
      expect(result.author).toBe('Jane Doe <jane@example.com>')
      expect(result.homepage).toBe('https://example.com')
      expect(result.repository).toBe('https://github.com/example/my-plugin')
      expect(result.license).toBe('MIT')
      expect(result.keywords).toEqual(['productivity', 'ai'])
    })

    it('metadata fields are all optional — minimal manifest still parses', () => {
      const result = PluginManifestSchema.parse({ name: 'bare' })
      expect(result.author).toBeUndefined()
      expect(result.homepage).toBeUndefined()
      expect(result.repository).toBeUndefined()
      expect(result.license).toBeUndefined()
      expect(result.keywords).toBeUndefined()
    })

    it('accepts empty keywords array', () => {
      const result = PluginManifestSchema.parse({ name: 'kw', keywords: [] })
      expect(result.keywords).toEqual([])
    })
  })
})
