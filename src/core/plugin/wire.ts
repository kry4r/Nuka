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
import { loadHooks } from '../hooks/loader'
import type { HookEntry } from '../hooks/types'
import type { AgentRegistry } from '../agents/registry'
import { resolveAgentDef } from '../agents/loader'
import { registerOutputStyle } from './outputStyles'
import { registerChannel } from '../notifications/channelRegistry'
import type { LspManager } from '../lsp/manager'

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
    hooks?: HookEntry[]
    agents?: AgentRegistry
    /**
     * Persisted user config values for this plugin.
     * Injected into ctx.pluginConfig when a tool is run.
     */
    pluginConfig?: Record<string, unknown>
    /** LspManager instance for registering plugin-declared LSP servers. */
    lsp?: LspManager
  },
): Promise<{
  toolsAdded: number
  slashAdded: number
  skillsAdded: number
  hooksAdded: number
  agentsAdded: number
  lspAdded: number
  errors: string[]
}> {
  let toolsAdded = 0
  let slashAdded = 0
  let skillsAdded = 0
  let hooksAdded = 0
  let agentsAdded = 0
  let lspAdded = 0
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
    const pluginConfig = deps.pluginConfig
    const namespaced: Tool = {
      ...raw,
      name: `plugin__${plugin.manifest.name}__${raw.name}`,
      source: 'plugin',
      tags: raw.tags ?? [],
      ...(pluginConfig !== undefined
        ? {
            run: async (input: unknown, ctx: import('../tools/types').ToolContext) =>
              raw.run(input, { ...ctx, pluginConfig }),
          }
        : {}),
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

  // Hooks
  if (plugin.manifest.hooks !== undefined && deps.hooks !== undefined) {
    const hooksPath = resolve(plugin.rootDir, plugin.manifest.hooks)
    const entries = await loadHooks(hooksPath)
    deps.hooks.push(...entries)
    hooksAdded = entries.length
  }

  // Agents
  if (plugin.manifest.agents !== undefined && deps.agents !== undefined) {
    for (const agentDef of plugin.manifest.agents) {
      try {
        const resolved = await resolveAgentDef(agentDef, plugin.rootDir, plugin.manifest.name)
        deps.agents.register(resolved)
        agentsAdded++
      } catch (err) {
        errors.push(`agent '${agentDef.name}': ${(err as Error).message}`)
      }
    }
  }

  // Output styles — resolve componentPath relative to plugin root and register globally
  for (const styleDef of plugin.manifest.outputStyles ?? []) {
    const absComponentPath = resolve(plugin.rootDir, styleDef.componentPath)
    registerOutputStyle({ ...styleDef, componentPath: absComponentPath })
  }

  // Channels — register globally for agent-loop dispatch
  for (const channelDef of plugin.manifest.channels ?? []) {
    registerChannel(channelDef)
  }

  // LSP servers — register each declared server with LspManager
  if (plugin.manifest.lspServers !== undefined && deps.lsp !== undefined) {
    for (const serverDef of plugin.manifest.lspServers) {
      // Namespace the server name as <plugin>:<server-name>
      const namespacedDef = {
        ...serverDef,
        name: `${plugin.manifest.name}:${serverDef.name}`,
      }
      const result = deps.lsp.register(namespacedDef)
      if (result.ok) {
        lspAdded++
      } else {
        errors.push(`lsp server '${serverDef.name}': ${result.reason}`)
      }
    }
  }

  return { toolsAdded, slashAdded, skillsAdded, hooksAdded, agentsAdded, lspAdded, errors }
}
