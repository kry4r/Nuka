import { MIGRATIONS } from './registry'
import { CURRENT_CONFIG_VERSION, MigrationError } from './types'
import type { Migration } from './types'

export type RunOptions = {
  /** Override the default registry — used in tests. */
  registry?: ReadonlyArray<Migration>
}

export type RunResult = {
  /** Final migrated object. New reference; input is not mutated. */
  obj: Record<string, unknown>
  /** Detected source version (1 when absent). */
  ranFrom: number
  /** Final version after the chain ran. */
  ranTo: number
  /** True iff `ranTo !== ranFrom` (caller should write back). */
  changed: boolean
}

function detectVersion(obj: Record<string, unknown>): number {
  const v = obj.version
  if (v === undefined) return 1
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    throw new MigrationError(
      `invalid version field: ${JSON.stringify(v)}`,
      0,
      0,
    )
  }
  return v
}

/**
 * Apply the migration chain to a raw parsed-YAML object.
 *
 * Behavior:
 *   - Input with no `version` field is treated as version 1.
 *   - Migrations apply sequentially from the detected version up to
 *     `CURRENT_CONFIG_VERSION` (or the last entry in the override registry).
 *   - A migrator that throws is wrapped in `MigrationError` carrying its
 *     from/to pair. The original input is untouched.
 *   - A config from a *future* version (higher than what we know how to
 *     migrate to) throws — the user is on a newer build than this binary.
 */
export function runMigrations(
  input: Record<string, unknown>,
  opts: RunOptions = {},
): RunResult {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new MigrationError('input must be a plain object', 0, 0)
  }
  const registry = opts.registry ?? MIGRATIONS
  const target = registry.length > 0
    ? (registry[registry.length - 1]?.to ?? CURRENT_CONFIG_VERSION)
    : CURRENT_CONFIG_VERSION

  const ranFrom = detectVersion(input)
  if (ranFrom > target) {
    throw new MigrationError(
      `config version ${ranFrom} is from the future (we know up to ${target})`,
      ranFrom,
      target,
    )
  }

  // Work on a shallow copy so a throwing migrator leaves the caller's input
  // intact. Each migration step is expected to return a fresh object too.
  let current: Record<string, unknown> = { ...input, version: ranFrom }
  let version = ranFrom

  while (version < target) {
    const step = registry.find(m => m.from === version)
    if (!step) {
      throw new MigrationError(
        `no migration registered for version ${version}`,
        version,
        version + 1,
      )
    }
    try {
      const next = step.migrate(current)
      if (next === null || typeof next !== 'object' || Array.isArray(next)) {
        throw new MigrationError(
          'migrator returned a non-object value',
          step.from,
          step.to,
        )
      }
      current = next
      version = step.to
    } catch (err) {
      if (err instanceof MigrationError) throw err
      const msg = err instanceof Error ? err.message : String(err)
      throw new MigrationError(msg, step.from, step.to)
    }
  }

  return {
    obj: current,
    ranFrom,
    ranTo: version,
    changed: version !== ranFrom,
  }
}
