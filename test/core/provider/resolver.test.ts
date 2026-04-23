// test/core/provider/resolver.test.ts
import { describe, it, expect } from 'vitest'
import { ProviderResolver } from '../../../src/core/provider/resolver'
import type { Config } from '../../../src/core/config/schema'

const cfg: Config = {
  providers: [
    {
      id: 'p1',
      name: 'Anthropic',
      format: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'sk-a',
      models: ['claude-sonnet-4-6'],
      selectedModel: 'claude-sonnet-4-6',
    },
    {
      id: 'p2',
      name: 'OpenAI',
      format: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-o',
      models: ['gpt-5'],
      selectedModel: 'gpt-5',
    },
  ],
  active: { providerId: 'p1' },
}

describe('ProviderResolver', () => {
  it('constructs one provider instance per config entry', () => {
    const r = new ProviderResolver(cfg)
    expect(r.listProviders()).toHaveLength(2)
  })

  it('resolveFor uses session.providerId + session.model', () => {
    const r = new ProviderResolver(cfg)
    const { provider, model } = r.resolveFor({ providerId: 'p2', model: 'gpt-5' } as any)
    expect(provider.id).toBe('p2')
    expect(model).toBe('gpt-5')
  })

  it('listModels returns the provider-specific list', () => {
    const r = new ProviderResolver(cfg)
    expect(r.listModels('p1')).toEqual(['claude-sonnet-4-6'])
    expect(r.listModels('p2')).toEqual(['gpt-5'])
  })
})
