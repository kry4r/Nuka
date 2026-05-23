import type { MicrocompactToolResultsOptions } from '../compact/microCompact'
import type { Config } from './schema'

const DEFAULT_KEEP_RECENT = 4

export function microCompactOptionsFromConfig(
  config: Config,
): MicrocompactToolResultsOptions | undefined {
  const microCompact = config.compact?.microCompact
  if (microCompact?.enabled === false) return undefined
  return {
    keepRecent: microCompact?.keepRecent ?? DEFAULT_KEEP_RECENT,
  }
}
