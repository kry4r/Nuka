import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { LoadedPlugin } from './manifest'
import type { Tool } from '../tools/types'
import type { ToolRegistry } from '../tools/registry'
import type { SlashCommand } from '../../slash/types'
import type { SlashRegistry } from '../../slash/registry'
import type { Skill } from '../skill/types'
import { parseSkill } from '../skill/loader'
import type { McpServerConfig } from '../mcp/types'

function isToolLike(v: unknown): v is Tool {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o['name'] === 'string' &&
    typeof o['description'] === 'string' &&
    o['parameters'] !== undefined &&
    typeof o['run'] === 'function' &&
    typeof o['needsPermission'] === 'function'
  )
}

function isSlashLike(v: unknown): v is SlashCommand {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o['name'] === 'string' && typeof o['run'] === 'function'
}

async function importModule(absPath: string): Promise<unknown> {
  const url = pathToFileURL(absPath).href
  return import(url)
}

function resolveDefault(mod: unknown): unknown {
  if (!mod || typeof mod !== 'object') return undefined
  const m = mod as Record<string, unknown>
  if (m['default'] !== undefined) return m['default']
  if (m['Tool'] !== undefined) return m['Tool']
  const keys = Object.keys(m)
  if (keys.length === 1) return m[keys[0]!]
  return undefined
}

export async function wirePlugin(
  plugin: LoadedPlugin,
  deps: {
    tools: ToolRegistry
    slash: SlashRegistry
    skills: Skill[]
    mcpServers: Record<string, McpServerConfig>
  },
): Promise<{
  toolsAdded: number
  slashAdded: number
  skillsAdded: number
  mcpAdded: number
  errors: string[]
}> {
  let toolsAdded = 0
  let slashAdded = 0
  let skillsAdded = 0
  let mcpAdded = 0
  const errors: string[] = []

  // Tools
  for (const entry of plugin.manifest.tools) {
    const abs = resolve(plugin.rootDir, entry)
    let mod: unknown
    try {
      mod = await importModule(abs)
    } catch (err) {
      errors.push(`tool '${entry}': import failed — ${(err as Error).message}`)
      continue
    }
    const raw = resolveDefault(mod)
    if (!isToolLike(raw)) {
      errors.push(`tool '${entry}': default export is not a valid Tool`)
      continue
    }
    const namespaced: Tool = {
      ...raw,
      name: `plugin__${plugin.manifest.name}__${raw.name}`,
      source: 'plugin',
    }
    const result = deps.tools.register(namespaced)
    if (result.registered) toolsAdded++
  }

  // Slash commands
  for (const entry of plugin.manifest.slashCommands) {
    const abs = resolve(plugin.rootDir, entry)
    let mod: unknown
    try {
      mod = await importModule(abs)
    } catch (err) {
      errors.push(`slash '${entry}': import failed — ${(err as Error).message}`)
      continue
    }
    const raw = resolveDefault(mod)
    if (!isSlashLike(raw)) {
      errors.push(`slash '${entry}': default export is not a valid SlashCommand`)
      continue
    }
    const renamed: SlashCommand = {
      ...raw,
      name: `${plugin.manifest.name}:${raw.name}`,
    }
    try {
      deps.slash.register(renamed)
      slashAdded++
    } catch (err) {
      errors.push(`slash '${entry}': ${(err as Error).message}`)
    }
  }

  // Skills
  for (const entry of plugin.manifest.skills) {
    const abs = resolve(plugin.rootDir, entry)
    let content: string
    try {
      content = await readFile(abs, 'utf8')
    } catch (err) {
      errors.push(`skill '${entry}': read failed — ${(err as Error).message}`)
      continue
    }
    const skill = parseSkill(content, { path: abs, source: 'project' })
    if (!skill) {
      errors.push(`skill '${entry}': failed to parse skill frontmatter`)
      continue
    }
    deps.skills.push(skill)
    skillsAdded++
  }

  // MCP servers
  for (const [key, config] of Object.entries(plugin.manifest.mcpServers)) {
    if (deps.mcpServers[key] !== undefined) {
      errors.push(`mcp server '${key}' already configured; plugin entry skipped`)
      continue
    }
    deps.mcpServers[key] = config
    mcpAdded++
  }

  return { toolsAdded, slashAdded, skillsAdded, mcpAdded, errors }
}
