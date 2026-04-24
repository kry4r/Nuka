import { readFile } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'
import path from 'node:path'
import type { Config, ProviderConfig } from './schema'
import { ConfigSchema } from './schema'

const EMPTY: Config = {
  providers: [],
  active: { providerId: '' },
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

function walk(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(walk)
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node)) out[k] = walk(v)
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

export async function loadConfig(opts: {
  home: string
  cwd: string
}): Promise<Config> {
  const globalRaw = await readYaml(path.join(opts.home, '.nuka', 'config.yaml'))
  const projectRaw = await readYaml(path.join(opts.cwd, '.nuka', 'config.yaml'))

  const globalCfg = globalRaw ? ConfigSchema.parse(walk(globalRaw)) : EMPTY
  const projectCfg = projectRaw ? ConfigSchema.parse(walk(projectRaw)) : EMPTY

  const merged: Config = {
    providers: mergeProviders(globalCfg.providers, projectCfg.providers),
    active: projectCfg.active.providerId
      ? projectCfg.active
      : globalCfg.active,
    theme: projectCfg.theme ?? globalCfg.theme,
    welcome: projectCfg.welcome ?? globalCfg.welcome,
    compact: projectCfg.compact ?? globalCfg.compact,
    mcp: projectCfg.mcp ?? globalCfg.mcp,
  }

  const envActive = process.env.NUKA_ACTIVE_PROVIDER_ID
  if (envActive) merged.active = { providerId: envActive }

  return merged
}
