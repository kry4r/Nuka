import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { atomicWriteYaml } from './atomicWrite'
import { runMigrations } from './run'
import type { Migration } from './types'

export type LoadAndMigrateOptions = {
  /** Override the default registry — primarily for tests. */
  registry?: ReadonlyArray<Migration>
}

export type LoadAndMigrateResult = {
  /** Final migrated config object (raw — not zod-parsed). */
  raw: Record<string, unknown>
  /** Source version detected on disk (1 when absent or when file missing). */
  ranFrom: number
  /** Final version after the chain ran. */
  ranTo: number
  /** True iff we wrote back (i.e. the version was bumped). */
  wroteBack: boolean
  /** Resolved absolute path to `~/.nuka/config.yaml`. */
  filePath: string
}

function globalConfigPath(home: string): string {
  return path.join(home, '.nuka', 'config.yaml')
}

/**
 * Read `<home>/.nuka/config.yaml`, apply the migration chain, and on a
 * version bump write the result back atomically.
 *
 * Behavior matrix:
 *   - File missing (ENOENT)      → returns {} as raw, wroteBack=false
 *   - File present, no version   → treated as v1, runs chain, writes back
 *   - File present, version=N    → runs chain from N to CURRENT, writes if N<CURRENT
 *   - File present, version=CUR  → no write, byte-identical on disk
 *   - Migrator throws            → original file untouched, error propagates
 *   - Non-object YAML root       → error propagates, file untouched
 *
 * This is additive — `loadConfig` and `loadScopedConfig` in `load.ts` are
 * NOT modified. Callers that want the migration behavior call
 * `loadAndMigrate` instead. The cutover lands in a follow-up PR.
 */
export async function loadAndMigrate(
  home: string,
  opts: LoadAndMigrateOptions = {},
): Promise<LoadAndMigrateResult> {
  const filePath = globalConfigPath(home)

  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        raw: {},
        ranFrom: 1,
        ranTo: 1,
        wroteBack: false,
        filePath,
      }
    }
    throw err
  }

  const parsed: unknown = parseYaml(raw) ?? {}
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      `config.yaml root must be a mapping; got ${Array.isArray(parsed) ? 'array' : typeof parsed}`,
    )
  }

  const result = runMigrations(parsed as Record<string, unknown>, {
    registry: opts.registry,
  })

  if (result.changed) {
    await atomicWriteYaml(filePath, result.obj)
  }

  return {
    raw: result.obj,
    ranFrom: result.ranFrom,
    ranTo: result.ranTo,
    wroteBack: result.changed,
    filePath,
  }
}
