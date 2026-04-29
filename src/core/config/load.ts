import { readFile } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'
import path from 'node:path'
import type { Config, ProviderConfig } from './schema'
import { ConfigSchema } from './schema'
import type { ConfigScope } from './scopeMerge'
import { SCOPE_ORDER, deepMergeWithLock, extractLocked } from './scopeMerge'
import { discoverScopes, readScopeConfig, scopePathMap } from './scope'

const EMPTY: Config = {
  providers: [],
  active: { providerId: '' },
}

/**
 * Phase 13 §5.1 — map old StatusBar segment ids to the current six-segment
 * id space. Called once at config load. Always-then-dedupe: every old
 * id resolves to a new id (no drops); the post-mapping list is passed
 * through `Array.from(new Set(...))` so collisions (e.g. both `git` and
 * `cwd` already present) collapse cleanly.
 *
 * Mapping (spec §5.1):
 *   model → model
 *   cwd → cwd
 *   git → cwd
 *   ctx → context
 *   cost → cost          (Phase 12 old-id passthrough)
 *   cost-time → cost     (Phase 12 id retired in Phase 13)
 *   auto → counts
 *   queue → counts
 *   tasks → counts
 *   plugins → counts
 *   hint → counts
 *   (any current-id pass-through is a no-op)
 */
const STATUSBAR_SEGMENT_MIGRATION: Record<string, string> = {
  model: 'model',
  cwd: 'cwd',
  git: 'cwd',
  ctx: 'context',
  cost: 'cost',
  'cost-time': 'cost',
  auto: 'counts',
  queue: 'counts',
  tasks: 'counts',
  plugins: 'counts',
  hint: 'counts',
}

export function migrateStatusBarHidden(input: readonly string[] | undefined): string[] {
  if (!input || input.length === 0) return []
  const mapped = input.map(id => STATUSBAR_SEGMENT_MIGRATION[id] ?? id)
  return Array.from(new Set(mapped))
}

/**
 * Apply the StatusBar segment-id migration to a (parsed) Config in-place
 * (returns the same reference for chaining). Idempotent: applying twice
 * is a no-op once all ids are in the new space.
 */
function applyStatusBarMigration<C extends Config>(cfg: C): C {
  if (cfg.statusBar?.hidden) {
    cfg.statusBar.hidden = migrateStatusBarHidden(cfg.statusBar.hidden)
  }
  return cfg
}

async function readYaml(p: string): Promise<unknown | null> {
  try {
    const text = await readFile(p, 'utf8')
    return parseYaml(text)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

function expandEnv(value: unknown): unknown {
  if (typeof value !== 'string') return value
  return value.replace(/\$\{env:([A-Z0-9_]+)\}/g, (_, k) => process.env[k] ?? '')
}

function walkEnv(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(walkEnv)
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node)) out[k] = walkEnv(v)
    return out
  }
  return expandEnv(node)
}

function mergeProviders(a: ProviderConfig[], b: ProviderConfig[]): ProviderConfig[] {
  const byId = new Map<string, ProviderConfig>()
  for (const p of a) byId.set(p.id, p)
  for (const p of b) byId.set(p.id, p)
  return [...byId.values()]
}

/**
 * Load config with full four-scope cascade and lock semantics.
 *
 * Scope order: enterprise → user → project → local
 * Enterprise-locked dot-paths cannot be overridden by lower scopes.
 *
 * Returns the effective merged Config plus per-scope breakdown,
 * locked dot-paths, and source annotations.
 */
export async function loadScopedConfig(opts?: {
  enterprisePath?: string
  userPath?: string
  projectCwd?: string
}): Promise<{
  effective: Config
  perScope: Record<ConfigScope, Partial<Config> | null>
  locked: string[]
  sources: Record<string, ConfigScope>
}> {
  const discovery = await discoverScopes(opts ?? {})
  const pathMap = scopePathMap(discovery)

  // Read raw YAML for each scope
  const rawByScope: Record<ConfigScope, unknown> = {
    enterprise: null,
    user: null,
    project: null,
    local: null,
  }
  for (const scope of SCOPE_ORDER) {
    const p = pathMap[scope]
    if (p !== null) {
      rawByScope[scope] = await readScopeConfig(p)
    }
  }

  // Extract locked paths from enterprise scope only
  const locked = extractLocked(rawByScope.enterprise)

  // Parse per-scope configs (lenient: use safeParse, fall back to null on error)
  const perScope: Record<ConfigScope, Partial<Config> | null> = {
    enterprise: null,
    user: null,
    project: null,
    local: null,
  }
  for (const scope of SCOPE_ORDER) {
    const raw = rawByScope[scope]
    if (raw !== null) {
      const walked = walkEnv(raw)
      const result = ConfigSchema.safeParse(walked)
      if (result.success) {
        perScope[scope] = result.data
      } else {
        // Partial parse: use raw object for merge but skip validation errors
        perScope[scope] = (typeof walked === 'object' && walked !== null)
          ? (walked as Partial<Config>)
          : null
      }
    }
  }

  // Deep-merge all scopes in order
  const merged: Record<string, unknown> = {}
  const sources: Record<string, ConfigScope> = {}

  for (const scope of SCOPE_ORDER) {
    const raw = rawByScope[scope]
    if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
      const walked = walkEnv(raw) as Record<string, unknown>
      deepMergeWithLock(merged, walked, scope, locked, sources)
    }
  }

  // Parse merged object through ConfigSchema with defaults applied
  let effective: Config
  try {
    effective = ConfigSchema.parse(merged)
  } catch {
    effective = EMPTY
  }

  // Apply env override
  const envActive = process.env.NUKA_ACTIVE_PROVIDER_ID
  if (envActive) effective.active = { providerId: envActive }

  // Phase 12 §5.1 — migrate legacy statusBar.hidden segment ids on read.
  applyStatusBarMigration(effective)

  return { effective, perScope, locked, sources }
}

/**
 * Backward-compatible loadConfig.
 * Keeps original merge semantics (mergeProviders deduplication by id,
 * project simple-wins for scalars) for existing callers.
 */
export async function loadConfig(opts: {
  home: string
  cwd: string
}): Promise<Config> {
  const globalRaw = await readYaml(path.join(opts.home, '.nuka', 'config.yaml'))
  const projectRaw = await readYaml(path.join(opts.cwd, '.nuka', 'config.yaml'))

  const globalCfg = globalRaw ? ConfigSchema.parse(walkEnv(globalRaw)) : EMPTY
  const projectCfg = projectRaw ? ConfigSchema.parse(walkEnv(projectRaw)) : EMPTY

  const merged: Config = {
    providers: mergeProviders(globalCfg.providers, projectCfg.providers),
    active: projectCfg.active.providerId
      ? projectCfg.active
      : globalCfg.active,
    theme: projectCfg.theme ?? globalCfg.theme,
    welcome: projectCfg.welcome ?? globalCfg.welcome,
    compact: projectCfg.compact ?? globalCfg.compact,
    statusBar: projectCfg.statusBar ?? globalCfg.statusBar,
    statusLine: projectCfg.statusLine ?? globalCfg.statusLine,
  }

  const envActive = process.env.NUKA_ACTIVE_PROVIDER_ID
  if (envActive) merged.active = { providerId: envActive }

  // Phase 12 §5.1 — migrate legacy statusBar.hidden segment ids on read.
  applyStatusBarMigration(merged)

  return merged
}
