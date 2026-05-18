# Config Migrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a schema-versioned migration system for `~/.nuka/config.yaml` so future field renames/moves can apply automatically on load with atomic write-back, while preserving today's behavior for unversioned configs (treated as v1).

**Architecture:** A new `src/core/config/migrations/` module owns (a) a `Migration` shape `{ from: number, to: number, migrate(obj) }`, (b) an ordered `MIGRATIONS` registry, (c) a `runMigrations(raw)` function that sequentially applies the chain starting from the embedded `version` (defaulting to 1), and (d) a `loadAndMigrate(home)` wrapper that reads YAML, injects `version: 1` when absent, runs the chain, and on a version bump writes back atomically (write to `config.yaml.tmp`, then `rename`). `ConfigSchema` gains a `version: number` field defaulting to 1 so old files still parse. `loadConfig` and `loadScopedConfig` are NOT modified — `loadAndMigrate` is a sibling entry point; the cutover is left to a follow-up so this change is purely additive.

**Tech Stack:** TypeScript (strict), Vitest, zod, yaml

---

## File Structure

```
src/core/config/
  schema.ts                      # MODIFY: add `version: z.number().int().positive().default(1)`
  migrations/
    types.ts                     # Migration<From, To> type, MigrationError class
    registry.ts                  # MIGRATIONS array (ordered, contiguous)
    run.ts                       # runMigrations(raw, opts) → { obj, ranFrom, ranTo }
    atomicWrite.ts               # atomicWriteYaml(path, obj) — tmp + rename
    loadAndMigrate.ts            # loadAndMigrate(home) — read + migrate + write-back
    index.ts                     # public re-exports
    v1-to-v2.ts                  # placeholder identity migration (noop, kept for tests)

test/core/config/migrations/
  registry.test.ts
  run.test.ts
  atomicWrite.test.ts
  loadAndMigrate.test.ts
  v1-to-v2.test.ts
```

The `v1-to-v2.ts` migration is intentionally an identity transform (only bumps the version field) so the system has a real second entry to exercise sequential application without coupling this PR to any field rename. Real renames land in follow-up PRs that append `v2-to-v3.ts`, `v3-to-v4.ts`, etc.

---

## Task 1 — Migration types

- [ ] **Files:**
  - Create `/data/xtzhang/Nuka/src/core/config/migrations/types.ts`
  - Create `/data/xtzhang/Nuka/test/core/config/migrations/types.test.ts`

**Write failing test** — `test/core/config/migrations/types.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { MigrationError, CURRENT_CONFIG_VERSION } from '../../../../src/core/config/migrations/types'
import type { Migration } from '../../../../src/core/config/migrations/types'

describe('migration types', () => {
  it('CURRENT_CONFIG_VERSION is a positive integer >= 1', () => {
    expect(Number.isInteger(CURRENT_CONFIG_VERSION)).toBe(true)
    expect(CURRENT_CONFIG_VERSION).toBeGreaterThanOrEqual(1)
  })

  it('MigrationError carries from/to context', () => {
    const err = new MigrationError('boom', 1, 2)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('MigrationError')
    expect(err.from).toBe(1)
    expect(err.to).toBe(2)
    expect(err.message).toContain('boom')
  })

  it('Migration<1,2> shape compiles', () => {
    const m: Migration = {
      from: 1,
      to: 2,
      migrate: (obj: Record<string, unknown>): Record<string, unknown> => {
        return { ...obj, version: 2 }
      },
    }
    expect(m.from).toBe(1)
    expect(m.to).toBe(2)
    expect(m.migrate({ foo: 'bar' })).toEqual({ foo: 'bar', version: 2 })
  })
})
```

**Run failing:** `npx vitest run test/core/config/migrations/types.test.ts`

**Implement** — `src/core/config/migrations/types.ts`:
```ts
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
```

**Run passing:** `npx vitest run test/core/config/migrations/types.test.ts && npx tsc --noEmit`

**Commit:** `feat(config): migration types + MigrationError`

---

## Task 2 — Add `version` field to ConfigSchema

- [ ] **Files:**
  - Modify `/data/xtzhang/Nuka/src/core/config/schema.ts`
  - Create `/data/xtzhang/Nuka/test/core/config/migrations/schemaVersion.test.ts`

**Write failing test** — `test/core/config/migrations/schemaVersion.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { ConfigSchema } from '../../../../src/core/config/schema'

describe('ConfigSchema.version', () => {
  it('defaults to 1 when absent (backwards compatible)', () => {
    const parsed = ConfigSchema.parse({})
    expect(parsed.version).toBe(1)
  })

  it('preserves an explicit version: 2', () => {
    const parsed = ConfigSchema.parse({ version: 2 })
    expect(parsed.version).toBe(2)
  })

  it('rejects non-positive versions', () => {
    expect(() => ConfigSchema.parse({ version: 0 })).toThrow()
    expect(() => ConfigSchema.parse({ version: -1 })).toThrow()
  })

  it('rejects non-integer versions', () => {
    expect(() => ConfigSchema.parse({ version: 1.5 })).toThrow()
  })

  it('legacy fields still validate alongside version', () => {
    const parsed = ConfigSchema.parse({
      version: 1,
      providers: [],
      active: { providerId: '' },
    })
    expect(parsed.version).toBe(1)
    expect(parsed.active.providerId).toBe('')
  })
})
```

**Run failing:** `npx vitest run test/core/config/migrations/schemaVersion.test.ts`

**Implement** — edit `/data/xtzhang/Nuka/src/core/config/schema.ts`. Add the `version` field as the first key of `ConfigSchema`:
```ts
export const ConfigSchema = z.object({
  /**
   * Schema version. Defaults to 1 when absent so unversioned (pre-migrations)
   * configs continue to parse. Bumped by migrations under
   * `src/core/config/migrations/`.
   */
  version: z.number().int().positive().default(1),
  providers: z.array(ProviderConfigSchema).default([]),
  active: ActiveSelectionSchema.default({ providerId: '' }),
  theme: ThemeSchema,
  compact: CompactSchema,
  search: SearchSchema,
  plugins: PluginsConfigSchema,
  vim: VimConfigSchema,
  rewind: RewindConfigSchema,
  statusLine: StatusLineConfigSchema,
  statusBar: StatusBarConfigSchema,
  harness: HarnessConfigSchema,
  /** Phase 14c — /recap and autoDream settings. */
  recap: RecapConfigSchema,
  /** Phase D2 — notice slots (emergency tip etc.) driven by config. */
  notices: NoticesConfigSchema,
  /** Reasoning effort for thinking-capable models (low/medium/high). */
  effort: EffortSchema,
  /**
   * Enterprise-only: dot-paths that cannot be overridden by lower-priority scopes.
   * Declared in the enterprise config; ignored if declared in other scopes.
   * e.g. ["providers.openai.apiKey"]
   */
  locked: z.array(z.string()).optional(),
})
export type Config = z.infer<typeof ConfigSchema>
```

Also update the `EMPTY` constant in `src/core/config/load.ts` so the version is set after a fresh load:
```ts
const EMPTY: Config = {
  version: 1,
  providers: [],
  active: { providerId: '' },
}
```

**Run passing:** `npx vitest run test/core/config/migrations/schemaVersion.test.ts && npx vitest run test/core/config && npx tsc --noEmit`

**Commit:** `feat(config): add version field to ConfigSchema (default 1)`

---

## Task 3 — v1→v2 identity migration (registry seed)

- [ ] **Files:**
  - Create `/data/xtzhang/Nuka/src/core/config/migrations/v1-to-v2.ts`
  - Create `/data/xtzhang/Nuka/test/core/config/migrations/v1-to-v2.test.ts`

**Write failing test** — `test/core/config/migrations/v1-to-v2.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { v1ToV2 } from '../../../../src/core/config/migrations/v1-to-v2'

describe('v1-to-v2 identity migration', () => {
  it('declares from=1 / to=2', () => {
    expect(v1ToV2.from).toBe(1)
    expect(v1ToV2.to).toBe(2)
  })

  it('bumps version to 2 on an otherwise empty object', () => {
    expect(v1ToV2.migrate({})).toEqual({ version: 2 })
  })

  it('preserves all unrelated keys', () => {
    const input = {
      version: 1,
      providers: [{ id: 'a', name: 'A' }],
      active: { providerId: 'a' },
      theme: { name: 'default-dark' },
    }
    const out = v1ToV2.migrate(input)
    expect(out.version).toBe(2)
    expect(out.providers).toEqual(input.providers)
    expect(out.active).toEqual(input.active)
    expect(out.theme).toEqual(input.theme)
  })

  it('returns a new object (does not mutate input)', () => {
    const input = { version: 1, providers: [] }
    const out = v1ToV2.migrate(input)
    expect(out).not.toBe(input)
    expect(input.version).toBe(1)
  })
})
```

**Run failing:** `npx vitest run test/core/config/migrations/v1-to-v2.test.ts`

**Implement** — `src/core/config/migrations/v1-to-v2.ts`:
```ts
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
```

**Run passing:** `npx vitest run test/core/config/migrations/v1-to-v2.test.ts && npx tsc --noEmit`

**Commit:** `feat(config): seed v1-to-v2 identity migration`

---

## Task 4 — Migrations registry + invariants

- [ ] **Files:**
  - Create `/data/xtzhang/Nuka/src/core/config/migrations/registry.ts`
  - Create `/data/xtzhang/Nuka/test/core/config/migrations/registry.test.ts`

**Write failing test** — `test/core/config/migrations/registry.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { MIGRATIONS } from '../../../../src/core/config/migrations/registry'
import { CURRENT_CONFIG_VERSION } from '../../../../src/core/config/migrations/types'

describe('MIGRATIONS registry invariants', () => {
  it('is non-empty', () => {
    expect(MIGRATIONS.length).toBeGreaterThan(0)
  })

  it('first migration starts at version 1', () => {
    expect(MIGRATIONS[0]?.from).toBe(1)
  })

  it('every step is contiguous (to === from + 1)', () => {
    for (const m of MIGRATIONS) {
      expect(m.to).toBe(m.from + 1)
    }
  })

  it('chain is gap-free (each step.from matches previous step.to)', () => {
    for (let i = 1; i < MIGRATIONS.length; i++) {
      const prev = MIGRATIONS[i - 1]
      const cur = MIGRATIONS[i]
      expect(cur?.from).toBe(prev?.to)
    }
  })

  it('last migration ends at CURRENT_CONFIG_VERSION', () => {
    const last = MIGRATIONS[MIGRATIONS.length - 1]
    expect(last?.to).toBe(CURRENT_CONFIG_VERSION)
  })
})
```

**Run failing:** `npx vitest run test/core/config/migrations/registry.test.ts`

**Implement** — `src/core/config/migrations/registry.ts`:
```ts
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
```

**Run passing:** `npx vitest run test/core/config/migrations/registry.test.ts && npx tsc --noEmit`

**Commit:** `feat(config): migrations registry with chain invariants`

---

## Task 5 — Migration runner

- [ ] **Files:**
  - Create `/data/xtzhang/Nuka/src/core/config/migrations/run.ts`
  - Create `/data/xtzhang/Nuka/test/core/config/migrations/run.test.ts`

**Write failing test** — `test/core/config/migrations/run.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { runMigrations } from '../../../../src/core/config/migrations/run'
import { MigrationError } from '../../../../src/core/config/migrations/types'
import type { Migration } from '../../../../src/core/config/migrations/types'

describe('runMigrations', () => {
  it('treats a missing version as version 1', () => {
    const result = runMigrations({ providers: [] })
    expect(result.ranFrom).toBe(1)
    expect(result.changed).toBe(true)
    expect((result.obj as { version: number }).version).toBe(2)
  })

  it('treats version=1 the same as no version', () => {
    const result = runMigrations({ version: 1, providers: [] })
    expect(result.ranFrom).toBe(1)
    expect((result.obj as { version: number }).version).toBe(2)
  })

  it('returns unchanged=false when already at latest version', () => {
    const result = runMigrations({ version: 2, providers: [] })
    expect(result.changed).toBe(false)
    expect(result.ranFrom).toBe(2)
    expect(result.ranTo).toBe(2)
  })

  it('applies migrations sequentially with custom registry', () => {
    const m12: Migration = {
      from: 1, to: 2,
      migrate: (o) => ({ ...o, version: 2, stepA: true }),
    }
    const m23: Migration = {
      from: 2, to: 3,
      migrate: (o) => ({ ...o, version: 3, stepB: true }),
    }
    const result = runMigrations({}, { registry: [m12, m23] })
    expect(result.obj).toMatchObject({ version: 3, stepA: true, stepB: true })
    expect(result.ranFrom).toBe(1)
    expect(result.ranTo).toBe(3)
  })

  it('wraps a throwing migrator in MigrationError', () => {
    const bad: Migration = {
      from: 1, to: 2,
      migrate: () => { throw new Error('kaboom') },
    }
    expect(() => runMigrations({}, { registry: [bad] })).toThrow(MigrationError)
    try {
      runMigrations({}, { registry: [bad] })
    } catch (err) {
      expect(err).toBeInstanceOf(MigrationError)
      const me = err as MigrationError
      expect(me.from).toBe(1)
      expect(me.to).toBe(2)
      expect(me.message).toContain('kaboom')
    }
  })

  it('throws when the on-disk version is higher than CURRENT_CONFIG_VERSION', () => {
    expect(() => runMigrations({ version: 99 })).toThrow(/from the future/i)
  })

  it('rejects non-record inputs (arrays, primitives)', () => {
    expect(() => runMigrations([] as unknown as Record<string, unknown>)).toThrow()
    expect(() => runMigrations(null as unknown as Record<string, unknown>)).toThrow()
  })

  it('does not mutate the input object on success', () => {
    const input = { version: 1, providers: [] as unknown[] }
    runMigrations(input)
    expect(input.version).toBe(1)
  })
})
```

**Run failing:** `npx vitest run test/core/config/migrations/run.test.ts`

**Implement** — `src/core/config/migrations/run.ts`:
```ts
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
```

**Run passing:** `npx vitest run test/core/config/migrations/run.test.ts && npx tsc --noEmit`

**Commit:** `feat(config): runMigrations — sequential chain runner`

---

## Task 6 — Atomic YAML write

- [ ] **Files:**
  - Create `/data/xtzhang/Nuka/src/core/config/migrations/atomicWrite.ts`
  - Create `/data/xtzhang/Nuka/test/core/config/migrations/atomicWrite.test.ts`

**Write failing test** — `test/core/config/migrations/atomicWrite.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { parse as parseYaml } from 'yaml'
import { atomicWriteYaml } from '../../../../src/core/config/migrations/atomicWrite'

function tmpDir(): string {
  return mkdtempSync(join(os.tmpdir(), 'nuka-atomic-'))
}

describe('atomicWriteYaml', () => {
  it('writes YAML to the target path', async () => {
    const dir = tmpDir()
    const file = join(dir, 'config.yaml')
    await atomicWriteYaml(file, { version: 2, providers: [] })
    expect(existsSync(file)).toBe(true)
    const text = readFileSync(file, 'utf8')
    expect(parseYaml(text)).toEqual({ version: 2, providers: [] })
  })

  it('does not leave a .tmp sibling after success', async () => {
    const dir = tmpDir()
    const file = join(dir, 'config.yaml')
    await atomicWriteYaml(file, { version: 2 })
    expect(existsSync(file + '.tmp')).toBe(false)
  })

  it('preserves the file when an existing target is overwritten', async () => {
    const dir = tmpDir()
    const file = join(dir, 'config.yaml')
    writeFileSync(file, 'version: 1\n', { encoding: 'utf8' })
    await atomicWriteYaml(file, { version: 2 })
    const text = readFileSync(file, 'utf8')
    expect(parseYaml(text)).toEqual({ version: 2 })
  })

  it('writes with mode 0o600 (owner read/write only)', async () => {
    const dir = tmpDir()
    const file = join(dir, 'config.yaml')
    await atomicWriteYaml(file, { version: 2 })
    const mode = statSync(file).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('rejects with the underlying error if the parent directory is missing', async () => {
    const file = join(tmpDir(), 'no-such-subdir', 'config.yaml')
    await expect(atomicWriteYaml(file, { version: 2 })).rejects.toThrow()
  })
})
```

**Run failing:** `npx vitest run test/core/config/migrations/atomicWrite.test.ts`

**Implement** — `src/core/config/migrations/atomicWrite.ts`:
```ts
import { writeFile, rename, unlink } from 'node:fs/promises'
import { stringify as stringifyYaml } from 'yaml'

/**
 * Atomic YAML write: stringify → write to `<path>.tmp` (mode 0o600) →
 * rename(tmp, path). If `writeFile` or `rename` throws, we attempt to
 * clean up the tmp file (best-effort) and re-raise the original error so
 * the on-disk target is left untouched.
 *
 * Caveat: this is "atomic on the same filesystem" — `rename` across
 * filesystems is not POSIX-atomic. For Nuka's `~/.nuka/` use case both
 * paths share the parent dir, so this is sound.
 */
export async function atomicWriteYaml(
  filePath: string,
  obj: unknown,
): Promise<void> {
  const tmpPath = filePath + '.tmp'
  const text = stringifyYaml(obj)
  try {
    await writeFile(tmpPath, text, { encoding: 'utf8', mode: 0o600 })
    await rename(tmpPath, filePath)
  } catch (err) {
    try { await unlink(tmpPath) } catch { /* swallow: tmp may not exist */ }
    throw err
  }
}
```

**Run passing:** `npx vitest run test/core/config/migrations/atomicWrite.test.ts && npx tsc --noEmit`

**Commit:** `feat(config): atomicWriteYaml — tmp + rename for safe write-back`

---

## Task 7 — `loadAndMigrate` integration wrapper

- [ ] **Files:**
  - Create `/data/xtzhang/Nuka/src/core/config/migrations/loadAndMigrate.ts`
  - Create `/data/xtzhang/Nuka/test/core/config/migrations/loadAndMigrate.test.ts`

**Write failing test** — `test/core/config/migrations/loadAndMigrate.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { parse as parseYaml } from 'yaml'
import { loadAndMigrate } from '../../../../src/core/config/migrations/loadAndMigrate'
import type { Migration } from '../../../../src/core/config/migrations/types'

function tmpHome(): string {
  return mkdtempSync(join(os.tmpdir(), 'nuka-loadmig-'))
}

function seed(home: string, yamlText: string): string {
  mkdirSync(join(home, '.nuka'), { recursive: true })
  const p = join(home, '.nuka', 'config.yaml')
  writeFileSync(p, yamlText, { encoding: 'utf8' })
  return p
}

describe('loadAndMigrate', () => {
  it('ENOENT — returns empty config, no write, no migration ran', async () => {
    const home = tmpHome()
    const result = await loadAndMigrate(home)
    expect(result.raw).toEqual({})
    expect(result.wroteBack).toBe(false)
    expect(result.ranFrom).toBe(1)
    expect(result.ranTo).toBe(1)
    expect(existsSync(join(home, '.nuka', 'config.yaml'))).toBe(false)
  })

  it('absent version is treated as v1 and migrated to current', async () => {
    const home = tmpHome()
    const path = seed(home, 'providers: []\n')
    const result = await loadAndMigrate(home)
    expect(result.ranFrom).toBe(1)
    expect(result.ranTo).toBeGreaterThanOrEqual(2)
    expect(result.wroteBack).toBe(true)
    const onDisk = parseYaml(readFileSync(path, 'utf8'))
    expect(onDisk.version).toBe(result.ranTo)
    expect(onDisk.providers).toEqual([])
  })

  it('explicit version: 1 round-trips to v2 with on-disk bump', async () => {
    const home = tmpHome()
    const path = seed(home, 'version: 1\nproviders: []\n')
    const result = await loadAndMigrate(home)
    expect(result.ranFrom).toBe(1)
    expect(result.ranTo).toBe(2)
    expect(result.wroteBack).toBe(true)
    const onDisk = parseYaml(readFileSync(path, 'utf8'))
    expect(onDisk.version).toBe(2)
  })

  it('already-current version is a no-op (no write)', async () => {
    const home = tmpHome()
    const path = seed(home, 'version: 2\nproviders: []\n')
    const before = readFileSync(path, 'utf8')
    const result = await loadAndMigrate(home)
    expect(result.wroteBack).toBe(false)
    expect(result.ranFrom).toBe(2)
    expect(result.ranTo).toBe(2)
    const after = readFileSync(path, 'utf8')
    expect(after).toBe(before) // byte-identical
  })

  it('broken migration rolls back — on-disk file unchanged', async () => {
    const home = tmpHome()
    const path = seed(home, 'version: 1\nproviders: []\nmarker: keep-me\n')
    const before = readFileSync(path, 'utf8')
    const bad: Migration = {
      from: 1, to: 2,
      migrate: () => { throw new Error('intentional fail') },
    }
    await expect(loadAndMigrate(home, { registry: [bad] })).rejects.toThrow(/intentional fail/)
    const after = readFileSync(path, 'utf8')
    expect(after).toBe(before)
    expect(existsSync(path + '.tmp')).toBe(false)
  })

  it('an empty YAML document is treated as {}', async () => {
    const home = tmpHome()
    const path = seed(home, '')
    const result = await loadAndMigrate(home)
    expect(result.ranFrom).toBe(1)
    expect(result.wroteBack).toBe(true)
    const onDisk = parseYaml(readFileSync(path, 'utf8'))
    expect(onDisk.version).toBeGreaterThanOrEqual(2)
  })

  it('a non-object YAML root (a bare string/list) is rejected without writing', async () => {
    const home = tmpHome()
    const path = seed(home, '- not-an-object\n')
    const before = readFileSync(path, 'utf8')
    await expect(loadAndMigrate(home)).rejects.toThrow()
    expect(readFileSync(path, 'utf8')).toBe(before)
  })
})
```

**Run failing:** `npx vitest run test/core/config/migrations/loadAndMigrate.test.ts`

**Implement** — `src/core/config/migrations/loadAndMigrate.ts`:
```ts
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
```

**Run passing:** `npx vitest run test/core/config/migrations/loadAndMigrate.test.ts && npx tsc --noEmit`

**Commit:** `feat(config): loadAndMigrate — read, migrate, atomic write-back`

---

## Task 8 — Public index barrel

- [ ] **Files:**
  - Create `/data/xtzhang/Nuka/src/core/config/migrations/index.ts`
  - Create `/data/xtzhang/Nuka/test/core/config/migrations/index.test.ts`

**Write failing test** — `test/core/config/migrations/index.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  loadAndMigrate,
  runMigrations,
  atomicWriteYaml,
  MIGRATIONS,
  CURRENT_CONFIG_VERSION,
  MigrationError,
} from '../../../../src/core/config/migrations'

describe('migrations index barrel', () => {
  it('re-exports the public surface', () => {
    expect(typeof loadAndMigrate).toBe('function')
    expect(typeof runMigrations).toBe('function')
    expect(typeof atomicWriteYaml).toBe('function')
    expect(Array.isArray(MIGRATIONS)).toBe(true)
    expect(typeof CURRENT_CONFIG_VERSION).toBe('number')
    expect(typeof MigrationError).toBe('function')
  })

  it('MigrationError is throwable and instanceof-checkable', () => {
    try { throw new MigrationError('x', 1, 2) }
    catch (e) { expect(e).toBeInstanceOf(MigrationError) }
  })
})
```

**Run failing:** `npx vitest run test/core/config/migrations/index.test.ts`

**Implement** — `src/core/config/migrations/index.ts`:
```ts
export { loadAndMigrate, type LoadAndMigrateResult, type LoadAndMigrateOptions } from './loadAndMigrate'
export { runMigrations, type RunOptions, type RunResult } from './run'
export { atomicWriteYaml } from './atomicWrite'
export { MIGRATIONS } from './registry'
export { CURRENT_CONFIG_VERSION, MigrationError, type Migration } from './types'
export { v1ToV2 } from './v1-to-v2'
```

**Run passing:** `npx vitest run test/core/config/migrations/index.test.ts && npx tsc --noEmit`

**Commit:** `feat(config): migrations public index barrel`

---

## Task 9 — Regression sweep

- [ ] **Files:** none (verification only)

Run the existing config tests to confirm the `version` field addition didn't break any pre-existing parse path:

```bash
npx vitest run test/core/config
npx vitest run test/core/config/migrations
npx tsc --noEmit
```

Pay special attention to:
- `test/core/config/load.test.ts` — `loadConfig` should still return a `Config` whose new `version` field defaults to 1.
- `test/core/config/save.test.ts` — `saveActiveSelection` / `saveProviderSelectedModel` / `saveVimEnabled` / `saveTheme` should all continue to round-trip (the `ConfigSchema.parse` calls inside `save.ts` now also apply the version default of 1, but they never emit `version` if the on-disk file didn't have one — confirm this is acceptable; if a test asserts a byte-exact YAML output that omits `version`, the test will need a one-line update).

If any test fails, the fix is one of:
1. Add `version: 1` to expected fixtures.
2. Update the `EMPTY` constant in `load.ts` (already covered by Task 2).
3. Adjust `save.ts` write paths to preserve the version that was on disk (not in scope for this PR — note it as a follow-up).

**Commit (only if any fixture updates were required):** `test(config): update fixtures for new version field default`

---

## Self-review (do this before opening a PR)

- [ ] `CURRENT_CONFIG_VERSION` equals the highest `to` in `MIGRATIONS` (asserted by `registry.test.ts`).
- [ ] All four spec-required tests pass: ENOENT no-migration, v1-absent treated as v1, v1→v2 round-trip, broken-migration rollback.
- [ ] `atomicWriteYaml` produces no orphan `.tmp` after success and leaves the original file untouched on failure.
- [ ] `loadConfig` and `loadScopedConfig` are NOT modified (additive change).
- [ ] No new npm dependencies in `package.json` (uses existing `yaml` and `zod`).
- [ ] `npx tsc --noEmit` clean (no `any`, no `@ts-ignore` introduced).
- [ ] `npx vitest run test/core/config` all green (pre-existing tests still pass).
- [ ] `npx vitest run test/core/config/migrations` all green.
- [ ] No `Co-Authored-By:` lines in any commit message.
