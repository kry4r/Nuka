// src/cli.tsx
import React from 'react'
import { render } from 'ink'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { spawn } from 'node:child_process'
import { App } from './tui/App'
import { loadConfig, loadScopedConfig } from './core/config/load'
import type { ConfigScope } from './core/config/scopeMerge'
import { SCOPE_ORDER } from './core/config/scopeMerge'
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
import { readUserConfig, writeUserConfig } from './core/plugin/userConfig'
import { AgentRegistry } from './core/agents/registry'
import { makeDispatchAgentTool } from './core/agents/dispatchTool'
import { validatePlugin, formatReport } from './core/plugin/validate'
import type { McpServerConfig } from './core/mcp/types'
import { LspManager } from './core/lsp/manager'
import { makeLspDiagnosticsTool, makeLspDefinitionTool, makeLspReferencesTool } from './core/lsp/tools'

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
} else if (argv[0] === 'plugin' && argv[1] === 'validate' && argv[2]) {
  const pluginDir = path.resolve(argv[2])
  ;(async () => {
    try {
      const report = await validatePlugin(pluginDir)
      const text = formatReport(report, pluginDir)
      if (report.errors.length > 0) {
        process.stderr.write(text + '\n')
        process.exit(2)
      } else {
        process.stdout.write(text + '\n')
        process.exit(0)
      }
    } catch (err) {
      process.stderr.write(`plugin validate failed: ${(err as Error).message}\n`)
      process.exit(1)
    }
  })()
} else if (argv[0] === 'config' && argv[1] === 'show') {
  // nuka config show [--scope <enterprise|user|project|local>]
  ;(async () => {
    try {
      const scopeIdx = argv.indexOf('--scope')
      const scopeArg: ConfigScope | undefined =
        scopeIdx !== -1 && argv[scopeIdx + 1]
          ? (argv[scopeIdx + 1] as ConfigScope)
          : undefined

      const validScopes: string[] = SCOPE_ORDER
      if (scopeArg !== undefined && !validScopes.includes(scopeArg)) {
        process.stderr.write(
          `Unknown scope '${scopeArg}'. Valid scopes: ${validScopes.join(', ')}\n`,
        )
        process.exit(1)
      }

      const result = await loadScopedConfig({ projectCwd: process.cwd() })

      if (scopeArg !== undefined) {
        const scopeData = result.perScope[scopeArg]
        if (scopeData === null) {
          process.stdout.write(`# scope '${scopeArg}': no config found\n`)
        } else {
          process.stdout.write(`# scope: ${scopeArg}\n`)
          process.stdout.write(JSON.stringify(scopeData, null, 2) + '\n')
        }
      } else {
        process.stdout.write('# effective config (merged from all scopes)\n')
        process.stdout.write(JSON.stringify(result.effective, null, 2) + '\n')
        if (Object.keys(result.sources).length > 0) {
          process.stdout.write('\n# sources:\n')
          for (const [key, scope] of Object.entries(result.sources).sort()) {
            process.stdout.write(`#   ${key}: ${scope}\n`)
          }
        }
        if (result.locked.length > 0) {
          process.stdout.write('\n# enterprise-locked paths:\n')
          for (const p of result.locked) {
            process.stdout.write(`#   ${p}\n`)
          }
        }
      }
      process.exit(0)
    } catch (err) {
      process.stderr.write(`config show failed: ${(err as Error).message}\n`)
      process.exit(1)
    }
  })()
} else {
  runInteractive().catch(err => {
    console.error(err)
    process.exit(1)
  })
}

/** Collect all --plugin-dir <path> values from argv (repeatable flag). */
function parsePluginDirs(rawArgv: string[]): string[] {
  const dirs: string[] = []
  for (let i = 0; i < rawArgv.length; i++) {
    if (rawArgv[i] === '--plugin-dir' && rawArgv[i + 1] !== undefined) {
      dirs.push(path.resolve(rawArgv[i + 1]!))
      i++ // skip the value token
    } else if (rawArgv[i]?.startsWith('--plugin-dir=')) {
      dirs.push(path.resolve(rawArgv[i]!.slice('--plugin-dir='.length)))
    }
  }
  return dirs
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

  const extraDirs = parsePluginDirs(process.argv.slice(2))
  const plugins = await loadPlugins({
    home: os.homedir(),
    enabled: config.plugins?.enabled,
    extraDirs,
    checkUserConfig: true,
  })
  const mcpServers: Record<string, McpServerConfig> = { ...(config.mcp?.servers ?? {}) }
  const hooks: import('./core/hooks/types').HookEntry[] = []
  const agents = new AgentRegistry()

  const lspManager = new LspManager()

  // Wire plugins that are ready (have config or don't need it)
  const pendingPlugins = plugins.filter(p => p.needsUserConfig)
  const readyPlugins = plugins.filter(p => !p.needsUserConfig)
  for (const p of readyPlugins) {
    const pluginConfig = await readUserConfig(os.homedir(), p.manifest.name)
    const result = await wirePlugin(p, {
      tools, slash, skills, mcpServers, hooks, agents, lsp: lspManager,
      pluginConfig: pluginConfig ?? undefined,
    })
    if (result.errors.length > 0) {
      for (const e of result.errors) console.warn(`[plugin:${p.manifest.name}] ${e}`)
    }
    console.error(`[plugin:${p.manifest.name}] tools=${result.toolsAdded} slash=${result.slashAdded} skills=${result.skillsAdded} mcp=${result.mcpAdded} hooks=${result.hooksAdded} agents=${result.agentsAdded} lsp=${result.lspAdded}`)
  }

  // Register LSP tools when at least one server is configured
  if (lspManager.list().length > 0) {
    tools.register(makeLspDiagnosticsTool(lspManager) as any)
    tools.register(makeLspDefinitionTool(lspManager) as any)
    tools.register(makeLspReferencesTool(lspManager) as any)
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

  // Register the dispatch_agent tool after all plugins have wired their agents
  // (so the tool's description enumerates every <plugin>:<agent> pair).
  tools.register(
    makeDispatchAgentTool({
      agents,
      registry: tools,
      providerResolver: providers,
      permission,
    }) as any,
  )

  const nodeVersion = process.version
  const shell = process.env.SHELL ?? '/bin/sh'
  const platform = process.platform
  const gitBranch = currentGitBranch(cwd)

  process.on('SIGINT', () => {
    const mcpCleanup = mcpManager ? mcpManager.closeAll() : Promise.resolve()
    const lspCleanup = lspManager.closeAll().catch(() => {})
    Promise.all([mcpCleanup, lspCleanup]).finally(() => metaWriter.flush().finally(() => process.exit(0)))
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
      lsp: lspManager,
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
      sessionPluginCount={plugins.filter(p => p.source === 'session').length}
    />,
  )

  // After render, process plugins that need user config input.
  // The App will have set the pluginConfigHandler on the bridge by this point
  // (set in App's first useEffect). We give React one tick via setImmediate.
  if (pendingPlugins.length > 0) {
    void new Promise<void>(resolve => setImmediate(resolve)).then(async () => {
      for (const p of pendingPlugins) {
        const fields = p.manifest.userConfig?.fields ?? []
        const config = await permBridge.promptPluginConfig({ plugin: p, fields })
        if (config !== null) {
          await writeUserConfig(os.homedir(), p.manifest.name, config)
          const result = await wirePlugin(p, { tools, slash, skills, mcpServers, hooks, agents, pluginConfig: config })
          if (result.errors.length > 0) {
            for (const e of result.errors) console.warn(`[plugin:${p.manifest.name}] ${e}`)
          }
        } else {
          console.warn(`[plugin:${p.manifest.name}] user skipped config — plugin inactive this session`)
        }
      }
    })
  }
}

