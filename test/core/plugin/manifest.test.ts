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

  describe('agents field', () => {
    it('parses a well-formed agents array with inline systemPrompt', () => {
      const result = PluginManifestSchema.parse({
        name: 'multi',
        agents: [
          {
            name: 'reviewer',
            description: 'reviews code',
            systemPrompt: 'You are a reviewer.',
          },
          {
            name: 'tester',
            description: 'runs tests',
            systemPromptPath: 'prompts/tester.md',
          },
        ],
      })
      expect(result.agents).toHaveLength(2)
      expect(result.agents![0]!.name).toBe('reviewer')
      expect(result.agents![0]!.maxTurns).toBe(20) // default
      expect(result.agents![1]!.systemPromptPath).toBe('prompts/tester.md')
    })

    it('defaults maxTurns to 20 when omitted', () => {
      const result = PluginManifestSchema.parse({
        name: 'd',
        agents: [{ name: 'a', description: 'd', systemPrompt: 'p' }],
      })
      expect(result.agents![0]!.maxTurns).toBe(20)
    })

    it('rejects an agent with both systemPrompt and systemPromptPath', () => {
      expect(() =>
        PluginManifestSchema.parse({
          name: 'x',
          agents: [
            {
              name: 'a',
              description: 'd',
              systemPrompt: 'inline',
              systemPromptPath: 'file.md',
            },
          ],
        }),
      ).toThrow(/exactly one of systemPrompt/)
    })

    it('rejects an agent with neither systemPrompt nor systemPromptPath', () => {
      expect(() =>
        PluginManifestSchema.parse({
          name: 'x',
          agents: [{ name: 'a', description: 'd' }],
        }),
      ).toThrow(/exactly one of systemPrompt/)
    })

    it('rejects an agent name that starts with a digit or has uppercase', () => {
      expect(() =>
        PluginManifestSchema.parse({
          name: 'x',
          agents: [{ name: '1bad', description: 'd', systemPrompt: 'p' }],
        }),
      ).toThrow()
      expect(() =>
        PluginManifestSchema.parse({
          name: 'x',
          agents: [{ name: 'Bad', description: 'd', systemPrompt: 'p' }],
        }),
      ).toThrow()
    })

    it('rejects temperature outside 0..1', () => {
      expect(() =>
        PluginManifestSchema.parse({
          name: 'x',
          agents: [
            { name: 'a', description: 'd', systemPrompt: 'p', temperature: 1.5 },
          ],
        }),
      ).toThrow()
    })

    it('requires both name and description on each agent', () => {
      expect(() =>
        PluginManifestSchema.parse({
          name: 'x',
          agents: [{ name: 'a', systemPrompt: 'p' } as unknown],
        }),
      ).toThrow()
      expect(() =>
        PluginManifestSchema.parse({
          name: 'x',
          agents: [{ description: 'd', systemPrompt: 'p' } as unknown],
        }),
      ).toThrow()
    })
  })
})
