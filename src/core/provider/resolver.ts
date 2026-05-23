// src/core/provider/resolver.ts
import type { Config, ProviderConfig } from '../config/schema'
import type { LLMProvider } from './types'
import { AnthropicProvider } from './anthropic'
import { OpenAIProvider } from './openai'

type SessionLike = { providerId: string; model: string }

export type ProviderResolverOpts = {
  /**
   * Optional pre-built provider instances keyed by id. Entries here override
   * (or supplement) instances built from `cfg.providers`. Used by the Phase 9
   * test harness to swap in MockProvider without monkey-patching.
   */
  providers?: Map<string, LLMProvider> | Record<string, LLMProvider>
}

export class ProviderResolver {
  private byId = new Map<string, LLMProvider>()
  private configs = new Map<string, ProviderConfig>()
  private overrides = new Map<string, LLMProvider>()

  constructor(cfg: Config, opts: ProviderResolverOpts = {}) {
    if (opts.providers) {
      const entries = opts.providers instanceof Map
        ? [...opts.providers.entries()]
        : Object.entries(opts.providers)
      for (const [id, p] of entries) {
        this.overrides.set(id, p)
      }
    }
    this.refreshConfig(cfg)
  }

  private buildInstance(pc: ProviderConfig): LLMProvider {
    if (pc.format === 'anthropic') {
      return new AnthropicProvider({
        id: pc.id,
        apiKey: pc.apiKey ?? '',
        baseUrl: pc.baseUrl,
        extraHeaders: pc.extraHeaders,
      })
    }
    return new OpenAIProvider({
      id: pc.id,
      apiKey: pc.apiKey ?? '',
      baseUrl: pc.baseUrl,
      extraHeaders: pc.extraHeaders,
    })
  }

  listProviders(): ProviderConfig[] {
    return [...this.configs.values()]
  }

  refreshConfig(cfg: Config): void {
    this.configs = new Map()
    const nextById = new Map<string, LLMProvider>()
    for (const pc of cfg.providers) {
      this.configs.set(pc.id, pc)
      nextById.set(pc.id, this.overrides.get(pc.id) ?? this.buildInstance(pc))
    }
    for (const [id, provider] of this.overrides) {
      if (!nextById.has(id)) nextById.set(id, provider)
    }
    this.byId = nextById
  }

  listModels(providerId: string): string[] {
    return this.configs.get(providerId)?.models ?? []
  }

  resolveFor(session: SessionLike): { provider: LLMProvider; model: string } {
    const p = this.byId.get(session.providerId)
    if (!p) throw new Error(`Unknown provider: ${session.providerId}`)
    return { provider: p, model: session.model }
  }

  async fetchRemoteModels(providerId: string): Promise<string[]> {
    const p = this.byId.get(providerId)
    if (!p) throw new Error(`Unknown provider: ${providerId}`)
    return p.listRemoteModels()
  }

  getProviderConfig(providerId: string): ProviderConfig | undefined {
    return this.configs.get(providerId)
  }
}
