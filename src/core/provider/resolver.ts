// src/core/provider/resolver.ts
import type { Config, ProviderConfig } from '../config/schema'
import type { LLMProvider } from './types'
import { AnthropicProvider } from './anthropic'
import { OpenAIProvider } from './openai'

type SessionLike = { providerId: string; model: string }

export class ProviderResolver {
  private byId = new Map<string, LLMProvider>()
  private configs = new Map<string, ProviderConfig>()

  constructor(cfg: Config) {
    for (const pc of cfg.providers) {
      this.configs.set(pc.id, pc)
      this.byId.set(pc.id, this.buildInstance(pc))
    }
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
