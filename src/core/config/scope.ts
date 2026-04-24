// src/core/config/scope.ts
/**
 * Per-scope config readers for the four-scope cascade:
 *   enterprise → user → project → local
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { ConfigScope } from './scopeMerge'

async function readYaml(p: string): Promise<unknown | null> {
  try {
    const text = await readFile(p, 'utf8')
    return parseYaml(text)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

/**
 * Walk cwd ancestor directories looking for .nuka/config.yaml.
 * Returns the path of the first (closest to cwd) match found, or null.
 */
export async function walkProjectConfig(startDir: string): Promise<string | null> {
  let dir = path.resolve(startDir)
  while (true) {
    const candidate = path.join(dir, '.nuka', 'config.yaml')
    const raw = await readYaml(candidate)
    if (raw !== null) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) break // reached filesystem root
    dir = parent
  }
  return null
}

export type ScopeDiscoveryResult = {
  enterprisePath: string | null
  userPath: string | null
  projectPath: string | null
  localPath: string | null
}

/**
 * Discover which config files exist for each scope.
 */
export async function discoverScopes(opts: {
  enterprisePath?: string
  userPath?: string
  projectCwd?: string
}): Promise<ScopeDiscoveryResult> {
  const cwd = opts.projectCwd ?? process.cwd()
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ''

  // Enterprise: only on Linux, default /etc/nuka/config.yaml
  let enterprisePath: string | null = null
  if (process.platform === 'linux') {
    const ep = opts.enterprisePath ?? '/etc/nuka/config.yaml'
    const raw = await readYaml(ep)
    if (raw !== null) enterprisePath = ep
  }

  // User: ~/.nuka/config.yaml
  const up = opts.userPath ?? path.join(home, '.nuka', 'config.yaml')
  const userRaw = await readYaml(up)
  const userPath = userRaw !== null ? up : null

  // Project: walk ancestors for .nuka/config.yaml
  const projectPath = await walkProjectConfig(cwd)

  // Local: .nuka/config.local.yaml in cwd only (no ancestor walk)
  const lp = path.join(cwd, '.nuka', 'config.local.yaml')
  const localRaw = await readYaml(lp)
  const localPath = localRaw !== null ? lp : null

  return { enterprisePath, userPath, projectPath, localPath }
}

/**
 * Read and parse a single YAML config file. Returns null if not found.
 */
export async function readScopeConfig(filePath: string): Promise<unknown | null> {
  return readYaml(filePath)
}

/**
 * Map each ConfigScope to its discovered path (or null).
 */
export function scopePathMap(
  discovery: ScopeDiscoveryResult,
): Record<ConfigScope, string | null> {
  return {
    enterprise: discovery.enterprisePath,
    user: discovery.userPath,
    project: discovery.projectPath,
    local: discovery.localPath,
  }
}
