import type { Effort, ProviderConfig } from './schema'

export function resolveEffortForModel(
  configured: Effort,
  provider: ProviderConfig | undefined,
  model: string,
): Effort {
  if (!configured || !model) return configured
  const capability = provider?.effort?.[model]
  if (capability === undefined || capability === true) return configured
  if (capability === false) return undefined
  return capability.includes(configured) ? configured : undefined
}

export function effortCapabilityMessage(
  configured: Effort,
  provider: ProviderConfig | undefined,
  model: string,
): string | undefined {
  if (!configured || !model) return undefined
  const capability = provider?.effort?.[model]
  if (capability === false) {
    return `${model} does not support reasoning/thinking`
  }
  if (Array.isArray(capability) && !capability.includes(configured)) {
    return `${model} does not support ${configured} effort; supported: ${capability.join(', ')}`
  }
  return undefined
}
