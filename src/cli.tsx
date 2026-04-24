// src/cli.tsx
import React from 'react'
import { render } from 'ink'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { spawn } from 'node:child_process'
import { App } from './tui/App'
import { loadConfig } from './core/config/load'
import { ProviderResolver } from './core/provider/resolver'
import { SessionManager } from './core/session/manager'
import { ToolRegistry } from './core/tools/registry'
import { PermissionChecker } from './core/permission/checker'
import { PermissionBridge } from './core/permission/bridge'
import { suggestPattern } from './core/permission/suggest'
import { SlashRegistry } from './slash/registry'
import { ExitCommand } from './slash/exit'
import { HelpCommand } from './slash/help'
import { ClearCommand } from './slash/clear'
import { NewCommand } from './slash/new'
import { BranchCommand } from './slash/branch'
import { BtwCommand } from './slash/btw'
import { CostCommand } from './slash/cost'
import { ModelCommand } from './slash/model'
import { ConfigCommand } from './slash/config'
import { CompactCommand } from './slash/compact'
import { ResumeCommand } from './slash/resume'
import { HistoryCommand } from './slash/history'
import { DeleteSessionCommand } from './slash/delete-session'
import { ReadTool } from './core/tools/read'
import { WriteTool } from './core/tools/write'
import { EditTool } from './core/tools/edit'
import { BashTool } from './core/tools/bash'
import { GlobTool } from './core/tools/glob'
import { GrepTool } from './core/tools/grep'
import { WebFetchTool } from './core/tools/webFetch'
import { createTodoStore, makeTodoWriteTool } from './core/tools/todoWrite'
import { makeWebSearchTool } from './core/tools/webSearch'
import { currentGitBranch } from './core/session/telemetry'
import { runAgent as runAgentLoop } from './core/agent/loop'
import { compactSession } from './core/compact/compact'
import type { AutoCompactOpts } from './core/compact/auto'
import { globalConfigPath } from './core/config/paths'
import { MACRO_VERSION } from './version'
import type { Session } from './core/session/types'
import { loadSkills } from './core/skill/loader'
import { makeSkillTool } from './core/skill/skillTool'
import { SessionStore, DebouncedMetaWriter } from './core/session/store'
import { sessionsDir } from './core/session/paths'
import { McpManager } from './core/mcp/manager'
import { mcpToolsFor } from './core/mcp/toolAdapter'
import { makeListMcpResourcesTool, makeReadMcpResourceTool } from './core/mcp/resourceTools'
import { loadPlugins } from './core/plugin/loader'
import { wirePlugin } from './core/plugin/wire'
import { readManifestFrom, installPluginFromPath } from './core/plugin/install'
import type { McpServerConfig } from './core/mcp/types'

const argv = process.argv.slice(2)
if (argv[0] === 'plugin' && argv[1] === 'list') {
  ;(async () => {
    try {
      const plugins = await loadPlugins({ home: os.homedir() })
      if (plugins.length === 0) {
        process.stdout.write('No plugins installed.\n')
        process.exit(0)
      }
      for (const p of plugins) {
        const m = p.manifest
        process.stdout.write(`${m.name}@${m.version ?? 'unversioned'}\n`)
        if (m.description) process.stdout.write(`  description: ${m.description}\n`)
        if (m.author)      process.stdout.write(`  author:      ${m.author}\n`)
        if (m.homepage)    process.stdout.write(`  homepage:    ${m.homepage}\n`)
        if (m.repository)  process.stdout.write(`  repository:  ${m.repository}\n`)
        if (m.license)     process.stdout.write(`  license:     ${m.license}\n`)
        if (m.keywords && m.keywords.length > 0) {
          process.stdout.write(`  keywords:    ${m.keywords.join(', ')}\n`)
        }
      }
      process.exit(0)
    } catch (err) {
      process.stderr.write(`plugin list failed: ${(err as Error).message}\n`)
      process.exit(1)
    }
  })()
} else if (argv[0] === 'plugin' && argv[1] === 'install' && argv[2]) {
  const source = argv[2]
  const force = argv.includes('--force')
  ;(async () => {
    try {
      const manifest = await readManifestFrom(path.resolve(source))
      process.stdout.write(`About to install plugin '${manifest.name}' into ~/.nuka/plugins/${manifest.name}\n`)
      process.stdout.write(`  tools: ${manifest.tools.length}  slash: ${manifest.slashCommands.length}  skills: ${manifest.skills.length}  mcp: ${Object.keys(manifest.mcpServers).length}\n`)
      const confirm = async (): Promise<boolean> => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
        const answer: string = await new Promise(res => rl.question('Proceed? [y/N] ', res))
        rl.close()
        return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes'
      }
      const result = await installPluginFromPath({ source: path.resolve(source), home: os.homedir(), force, confirm })
      process.stdout.write(`installed '${result.name}' → ${result.targetDir}\n`)
      process.stdout.write(`  tools: ${result.toolsCount}, slash: ${result.slashCount}, skills: ${result.skillsCount}, mcp: ${result.mcpCount}\n`)
      if (!result.mcpCount && !result.toolsCount && !result.slashCount && !result.skillsCount) {
        process.stdout.write('(plugin contributes no tools/slash/skills/mcp — verify manifest)\n')
      }
      process.exit(0)
    } catch (err) {
      process.stderr.write(`plugin install failed: ${(err as Error).message}\n`)
      process.exit(1)
    }
  })()
} else {
  runInteractive().catch(err => {
    console.error(err)
    process.exit(1)
  })
}

async function runInteractive(): Promise<void> {
  const cwd = process.cwd()
  const config = await loadConfig({ home: os.homedir(), cwd })
  const skills = await loadSkills({ home: os.homedir(), cwd })

  if (config.providers.length === 0) {
    console.error(
      `No providers configured.\nAdd one to ${globalConfigPath()} — see docs/superpowers/specs/2026-04-23-nuka-rewrite-design.md §4.3`,
    )
    process.exit(2)
  }

  const providers = new ProviderResolver(config)
  const store = new SessionStore({ dir: sessionsDir(os.homedir()) })
  const metaWriter = new DebouncedMetaWriter(store)
  const sessions = new SessionManager({ store, metaWriter })
  const firstProvider = config.providers[0]!
  const activeProviderId = config.active.providerId || firstProvider.id
  const activeProvider = config.providers.find(p => p.id === activeProviderId)
  if (!activeProvider) {
    console.error(`active.providerId references unknown provider: ${activeProviderId}`)
    process.exit(2)
  }
  const activeModel = activeProvider!.selectedModel ?? activeProvider!.models?.[0] ?? ''

  // Parse --resume flag: --resume (most recent) or --resume=<id-prefix>
  const resumeArg = process.argv.find(a => a === '--resume' || a.startsWith('--resume='))
  if (resumeArg !== undefined) {
    const prefix = resumeArg.includes('=') ? resumeArg.split('=').slice(1).join('=') : ''
    const allMetas = await sessions.listPersisted()
    let resolvedId: string | undefined
    if (!prefix) {
      resolvedId = allMetas[0]?.id
    } else {
      const matches = allMetas.filter(m => m.id.startsWith(prefix))
      if (matches.length === 1) {
        resolvedId = matches[0]!.id
      } else if (matches.length === 0) {
        console.error(`--resume: no session matching prefix "${prefix}"`)
      } else {
        console.error(`--resume: ambiguous prefix "${prefix}" matches ${matches.length} sessions`)
      }
    }
    if (resolvedId) {
      await sessions.resume(resolvedId)
    } else {
      sessions.start({ providerId: activeProvider!.id, model: activeModel })
    }
  } else {
    sessions.start({ providerId: activeProvider!.id, model: activeModel })
  }

  const todoStore = createTodoStore()
  const tools = new ToolRegistry()
  ;[ReadTool, WriteTool, EditTool, BashTool, GlobTool, GrepTool, WebFetchTool].forEach(t => tools.register(t as any))
  tools.register(makeTodoWriteTool(todoStore) as any)
  tools.register(makeWebSearchTool(config.search) as any)

  const slash = new SlashRegistry()
  ;[ExitCommand, HelpCommand, ClearCommand, NewCommand, BranchCommand, BtwCommand, CostCommand, ModelCommand, ConfigCommand, CompactCommand, ResumeCommand, HistoryCommand, DeleteSessionCommand].forEach(c => slash.register(c))

  const plugins = await loadPlugins({ home: os.homedir(), enabled: config.plugins?.enabled })
  const mcpServers: Record<string, McpServerConfig> = { ...(config.mcp?.servers ?? {}) }
  const hooks: import('./core/hooks/types').HookEntry[] = []
  for (const p of plugins) {
    const result = await wirePlugin(p, { tools, slash, skills, mcpServers, hooks })
    if (result.errors.length > 0) {
      for (const e of result.errors) console.warn(`[plugin:${p.manifest.name}] ${e}`)
    }
    console.error(`[plugin:${p.manifest.name}] tools=${result.toolsAdded} slash=${result.slashAdded} skills=${result.skillsAdded} mcp=${result.mcpAdded} hooks=${result.hooksAdded}`)
  }

  // Register skill tool after all skill-loading (including plugin skills) finishes
  tools.register(makeSkillTool(skills) as any)

  const permBridge = new PermissionBridge()
  const mcpManager = Object.keys(mcpServers).length > 0
    ? new McpManager({
        servers: mcpServers,
        maxResultChars: config.mcp?.maxResultChars,
        connectTimeoutMs: config.mcp?.connectTimeoutMs,
        requestTimeoutMs: config.mcp?.requestTimeoutMs,
        permissionBridge: permBridge,
      })
    : null

  if (mcpManager) {
    tools.register(makeListMcpResourcesTool(mcpManager) as any)
    tools.register(makeReadMcpResourceTool(mcpManager) as any)

    void (async () => {
      await mcpManager.startAll()
      for (const c of mcpManager.listClients()) {
        if (c.status.kind === 'connected') {
          const mcpTools = await mcpToolsFor(c)
          mcpTools.forEach(t => tools.register(t as any))
        }
      }
    })()
  }

  const askUser = (payload: import('./core/permission/bridge').PermissionPayload) =>
    permBridge.ask({ ...payload, suggestedPattern: suggestPattern(payload.call) })

  const permission = new PermissionChecker(() => sessions.active()!.permissionCache, askUser)

  const nodeVersion = process.version
  const shell = process.env.SHELL ?? '/bin/sh'
  const platform = process.platform
  const gitBranch = currentGitBranch(cwd)

  process.on('SIGINT', () => {
    const cleanup = mcpManager ? mcpManager.closeAll() : Promise.resolve()
    cleanup.finally(() => metaWriter.flush().finally(() => process.exit(0)))
  })

  // Build auto-compact opts. Use compact.model with the active session's provider when set;
  // otherwise fall back to the active session's model. Provider resolution uses the active
  // session's provider in both cases (no cross-provider summarization in this phase).
  const activeSession = sessions.active()!
  const compactModel = config.compact?.model ?? activeSession.model
  const { provider: compactProvider } = providers.resolveFor(activeSession)
  const autoCompact: AutoCompactOpts = {
    provider: compactProvider,
    model: compactModel,
    keepTurns: config.compact?.keepTurns ?? 3,
    autoThreshold: config.compact?.autoThreshold ?? 0.8,
    contextWindow: config.compact?.contextWindow ?? 200_000,
  }

  const runAgent = (input: { text: string }, session: Session, signal: AbortSignal) =>
    runAgentLoop(input, session, {
      provider: providers,
      tools,
      permission,
      systemPromptInput: () => ({
        cwd, platform, shell, nodeVersion, gitBranch, skills,
      }),
      skills,
      persist: sessions.persist,
      autoCompact,
      hooks,
    }, signal)

  render(
    <App
      sessions={sessions}
      slash={slash}
      providers={providers}
      config={config}
      runAgent={runAgent}
      permissionBridge={permBridge}
      onExit={() => process.exit(0)}
      onOpenEditor={() => {
        const editor = process.env.EDITOR ?? 'vi'
        spawn(editor, [globalConfigPath()], { stdio: 'inherit' })
      }}
      compactSession={async (s) => {
        const { provider, model } = providers.resolveFor(s)
        await compactSession(s, { provider, model, keepTurns: config.compact?.keepTurns ?? 3 })
      }}
      cwd={cwd}
      gitBranch={gitBranch}
      version={MACRO_VERSION}
      mcpManager={mcpManager ?? undefined}
      tools={tools}
    />,
  )
}

