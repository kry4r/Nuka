import type { Config, ProviderConfig } from './schema'

export function providerIdFromName(name: string): string {
  const id = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return id || 'custom'
}

export function isPlaceholderCustomProviderId(id: string): boolean {
  return /^custom(?:-\d+)?$/.test(id)
}

export function normalizeProviderIdentity(provider: ProviderConfig): ProviderConfig {
  if (!isPlaceholderCustomProviderId(provider.id)) return provider
  return { ...provider, id: providerIdFromName(provider.name) }
}

export function normalizeConfigProviderIdentities<C extends Config>(cfg: C): C {
  const idMap = new Map<string, string>()
  const usedIds = new Set<string>()
  cfg.providers = cfg.providers.map(provider => {
    const base = normalizeProviderIdentity(provider)
    let id = base.id
    if (usedIds.has(id)) {
      let suffix = 2
      while (usedIds.has(`${id}-${suffix}`)) suffix++
      id = `${id}-${suffix}`
    }
    usedIds.add(id)
    const normalized = id === base.id ? base : { ...base, id }
    if (normalized.id !== provider.id) idMap.set(provider.id, normalized.id)
    return normalized
  })

  const activeProviderId = cfg.active.providerId
  const normalizedActive = idMap.get(activeProviderId)
  if (normalizedActive) {
    cfg.active = { providerId: normalizedActive }
  }

  return cfg
}
