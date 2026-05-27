import type { RetryOptions } from '../retry'
import type { Config } from './schema'

export function providerRetryOptionsFromConfig(
  config: Config,
): Omit<RetryOptions, 'signal' | 'onAttempt'> | undefined {
  const retry = config.provider?.retry
  if (!retry) return undefined
  return {
    maxAttempts: retry.maxAttempts,
    initialDelayMs: retry.initialDelayMs,
    maxDelayMs: retry.maxDelayMs,
    backoffFactor: retry.backoffFactor,
    jitter: retry.jitter,
    attemptTimeoutMs: retry.idleTimeoutMs,
  }
}
