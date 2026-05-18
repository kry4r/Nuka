import type { Migration } from './types'

/**
 * v1 → v2 identity bump.
 *
 * This migration intentionally performs no field rename. Its only purpose
 * is to exercise the migration runner end-to-end (so the registry has at
 * least one real entry and the load → run → write-back path is testable).
 *
 * Real schema changes (field renames, key moves) land in subsequent
 * `v2-to-v3.ts`, `v3-to-v4.ts`, etc. — appended to the registry and
 * bumping `CURRENT_CONFIG_VERSION` by one each time.
 */
export const v1ToV2: Migration = {
  from: 1,
  to: 2,
  migrate: (obj: Record<string, unknown>): Record<string, unknown> => {
    return { ...obj, version: 2 }
  },
}
