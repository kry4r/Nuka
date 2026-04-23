import { describe, it, expect } from 'vitest'
import { ConfigSchema } from '../../../src/core/config/schema'

describe('ConfigSchema', () => {
  it('accepts a minimal providers-only config', () => {
    const parsed = ConfigSchema.parse({
      providers: [
        {
          id: 'p1',
          name: 'Anthropic',
          format: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          apiKey: 'sk-x',
          models: ['claude-sonnet-4-6'],
          selectedModel: 'claude-sonnet-4-6',
        },
      ],
      active: { providerId: 'p1' },
    })
    expect(parsed.providers).toHaveLength(1)
    expect(parsed.active.providerId).toBe('p1')
  })

  it('rejects unknown provider format', () => {
    expect(() =>
      ConfigSchema.parse({
        providers: [
          { id: 'p1', name: 'x', format: 'gemini', baseUrl: 'https://x', models: [] },
        ],
        active: { providerId: 'p1' },
      }),
    ).toThrow()
  })

  it('supports optional pricing per model', () => {
    const parsed = ConfigSchema.parse({
      providers: [
        {
          id: 'p1',
          name: 'x',
          format: 'openai',
          baseUrl: 'https://x',
          models: ['gpt-5'],
          pricing: { 'gpt-5': { input: 2.5, output: 10 } },
        },
      ],
      active: { providerId: 'p1' },
    })
    expect(parsed.providers[0].pricing?.['gpt-5'].input).toBe(2.5)
  })
})
