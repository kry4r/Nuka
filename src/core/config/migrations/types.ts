/**
 * Latest known schema version. Bumped each time a new migration is appended
 * to `MIGRATIONS` in `registry.ts`. Stays in sync with the highest `to` in
 * the registry; the `registry.test.ts` invariant test asserts equality.
 */
export const CURRENT_CONFIG_VERSION = 2

/**
 * A single migration step. `from` and `to` must be contiguous integers
 * (`to === from + 1`). `migrate` must return a *new* object — the runner
 * relies on this so a thrown migrator never leaves the caller's input
 * partially mutated.
 */
export type Migration = {
  from: number
  to: number
  migrate: (obj: Record<string, unknown>) => Record<string, unknown>
}

/**
 * Thrown by `runMigrations` when a migrator throws or returns an invalid
 * value. Carries the from/to pair so the caller can pinpoint which step
 * failed; the on-disk file is left untouched (atomic write happens only
 * after the full chain succeeds).
 */
export class MigrationError extends Error {
  readonly from: number
  readonly to: number

  constructor(message: string, from: number, to: number) {
    super(`config migration ${from} -> ${to} failed: ${message}`)
    this.name = 'MigrationError'
    this.from = from
    this.to = to
  }
}
