import type { Migration } from './types'
import { v1ToV2 } from './v1-to-v2'

/**
 * Ordered, contiguous, gap-free list of config migrations.
 *
 * Invariants (enforced by `registry.test.ts`):
 *   - non-empty
 *   - MIGRATIONS[0].from === 1
 *   - every step has `to === from + 1`
 *   - chain is gap-free
 *   - last step's `to` equals `CURRENT_CONFIG_VERSION` in `types.ts`
 *
 * To add a migration:
 *   1. Create `vN-to-v(N+1).ts` exporting a `Migration`.
 *   2. Append it here.
 *   3. Bump `CURRENT_CONFIG_VERSION` in `types.ts` by one.
 *   4. Add a `vN-to-v(N+1).test.ts`.
 */
export const MIGRATIONS: ReadonlyArray<Migration> = [v1ToV2]
