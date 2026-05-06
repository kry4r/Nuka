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
import { ForkCommand } from './slash/fork'
import { BtwCommand } from './slash/btw'
import { CostCommand } from './slash/cost'
import { ModelCommand } from './slash/model'
import { EffortCommand } from './slash/effort'
import { SettingsCommand, ConfigCommand } from './slash/settings'
import { CompactCommand } from './slash/compact'
import { ResumeCommand } from './slash/resume'
import { MemdirCommand, setMemdirSynthCallable } from './slash/memdir'
import { VimCommand } from './slash/vim'
import { DoctorCommand } from './slash/doctor'
import { RewindCommand } from './slash/rewind'
import { TasksCommand } from './slash/tasks'
import { TaskManager } from './core/tasks/manager'
import { ThemeCommand } from './slash/theme'
import { StatsCommand } from './slash/stats'
import { PlanCommand } from './slash/plan'
import { IdeCommand } from './slash/ide'
import { StatusBarCommand } from './slash/statusBar'
import { createPluginCommand } from './slash/plugin'
import { SkillCommand } from './slash/skill'
import { RecapCommand } from './slash/recap'
import { monitorCommand } from './slash/monitor'
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
import { loadPlugins } from './core/plugin/loader'
import { wirePlugin } from './core/plugin/wire'
import { readManifestFrom, installPluginFromPath } from './core/plugin/install'
import { readUserConfig, writeUserConfig } from './core/plugin/userConfig'
import { AgentRegistry } from './core/agents/registry'
import { makeDispatchAgentTool } from './core/agents/dispatchTool'
import { dispatchAgent } from './core/agents/dispatch'
import { validatePlugin, formatReport } from './core/plugin/validate'
import { LspManager } from './core/lsp/manager'
import { makeLspDiagnosticsTool, makeLspDefinitionTool, makeLspReferencesTool } from './core/lsp/tools'
import { Wizard } from './tui/Onboarding/Wizard'
import { saveWizardPatch } from './core/onboarding/save'
import { CostTracker } from './core/cost/tracker'
import { defaultCostPath, readCostFile, writeCostFile } from './core/cost/persist'
import { loadMemory, appendMemory } from './core/memdir/index'
import { findRelevant, tokenize } from './core/memdir/relevance'
import { synthMemoryEntry } from './core/memdir/synth'
import type { MemoryEntry } from './core/memdir/parser'
import { loadUpdates } from './core/updates/load'
import type { UpdateEntry } from './core/updates/load'
import { loadRecent } from './core/session/recent'
import type { RecentEntry } from './core/session/recent'
import { ensureNukaLayout } from './core/paths'
import { runRetentionSweep } from './core/tasks/retention'
import { eventBus } from './core/events/bus'
import { HarnessStateMachine } from './core/harness/state'
import { editorAgent } from './core/agents/builtin/editor'
import { makeSequentialThinkingTool, makeSearchAndVerifyTool, makeAskUserQuestionTool } from './core/harness/primitives'
import { makeHarnessCommand } from './slash/harness'
import { makeTriageCommand } from './slash/triage'
import { makeCoordinationCommand } from './slash/coordination'
import * as fs from 'node:fs'
import { initAutoDream } from './core/recap/autoDream'
import { makeTeamCreateTool } from './core/tools/builtin/teamCreate'
import { makeTeamDeleteTool } from './core/tools/builtin/teamDelete'
import { makeSendMessageTool } from './core/tools/builtin/sendMessage'
import { makePipelineRunTool } from './core/tools/builtin/pipelineRun'
import { makeRoundtableTool } from './core/tools/builtin/roundtable'
import { TeamRegistry } from './core/teams/registry'
import { MessageRouter } from './core/messaging/router'
import { InProcessBackend } from './core/messaging/inProcessBackend'
import { ROLE_AGENTS } from './core/agents/builtin/roles'
import { runPipeline } from './core/swarm/pipeline'
import { runRoundtable } from './core/swarm/roundtable'



// Non-TTY safety shim: stub setRawMode/ref/unref so Ink's reconciler can
// at least mount under a pipe.  isTTY stays truthful so headless callers
// branching on `process.stdin.isTTY` aren't misled.
//
// Caveat (Phase C followup): Ink 6.8.0's `App.handleSetRawMode`
// (node_modules/ink/build/components/App.js) gates on
// `isRawModeSupported = stdin.isTTY` and throws when false — regardless of
// whether the methods exist — once `useInput` mounts.  Under a pipe the
// resulting ErrorOverview surfaces a React duplicate-key warning.  The
// architecturally clean fix (Phase D) is to pass an `{ stdin }` proxy with
// `isTTY=true` to `render()` so only Ink sees a fake-TTY, leaving the real
// `process.stdin.isTTY` untouched.
if (!process.stdin.isTTY) {
  const s = process.stdin as unknown as Record<string, unknown>
  if (typeof s['setRawMode'] !== 'function') s['setRawMode'] = () => process.stdin
  if (typeof s['ref'] !== 'function') s['ref'] = () => process.stdin
  if (typeof s['unref'] !== 'function') s['unref'] = () => process.stdin
}

const argv = process.argv.slice(2)

// ---------------------------------------------------------------------------
// --test-plan <path>  [--update-snapshots]  [--reporter=tap|json|pretty]
//
// Phase 10 §4.1 — the testing helpers (parser, mock provider, harness,
// runner, reporters) live in a separate `dist/test-runner.js` bundle that
// is lazy-loaded only on `--test-plan`. We compute the import URL via
// `import.meta.url` so esbuild cannot statically resolve it; the production
// `dist/cli.js` therefore omits every testing module.
//
// Source/dev mode (`tsx src/cli.tsx`) doesn't have a built test-runner;
// the catch falls back to the in-tree `core/testing/cli-entry` module.
// ---------------------------------------------------------------------------
const testPlanIdx = argv.findIndex(a => a === '--test-plan' || a.startsWith('--test-plan='))
if (testPlanIdx !== -1) {
  ;(async () => {
    try {
      let mod: typeof import('./core/testing/cli-entry')
      const distUrl = new URL('./test-runner.js', import.meta.url).href
      try {
        mod = (await import(distUrl)) as typeof import('./core/testing/cli-entry')
      } catch {
        const srcUrl = new URL('./core/testing/cli-entry.ts', import.meta.url).href
        mod = (await import(srcUrl)) as typeof import('./core/testing/cli-entry')
      }
      process.exit(await mod.runTestPlanCli(argv))
    } catch (err) {
      process.stderr.write(`test-plan failed: ${(err as Error).message}\n`)
      process.exit(1)
    }
  })()
} else if (argv[0] === 'doctor') {
  // nuka doctor — environment diagnostics
  ;(async () => {
    try {
      const { runDoctor } = await import('./core/doctor/run')
      const report = await runDoctor({
        home: os.homedir(),
        cwd: process.cwd(),
      })

      const GREEN = '\x1b[32m'
      const YELLOW = '\x1b[33m'
      const RED   = '\x1b[31m'
      const RESET = '\x1b[0m'

      for (const check of report.checks) {
        let icon: string
        let color: string
        if (check.status === 'ok') { icon = '✓'; color = GREEN }
        else if (check.status === 'warn') { icon = '⚠'; color = YELLOW }
        else { icon = '✗'; color = RED }
        process.stdout.write(`  ${color}${icon}${RESET} ${check.name}: ${check.detail}\n`)
        if (check.remedy) {
          process.stdout.write(`      → ${check.remedy}\n`)
        }
      }
      process.stdout.write('\n')
      if (report.ok) {
        process.stdout.write(`${GREEN}All checks passed.${RESET}\n`)
        process.exit(0)
      } else {
        process.stdout.write(`${RED}Some checks failed.${RESET}\n`)
        process.exit(1)
      }
    } catch (err) {
      process.stderr.write(`doctor failed: ${(err as Error).message}\n`)
      process.exit(1)
    }
  })()
} else if (argv[0] === 'init') {
  ;(async () => {
    try {
      const home = os.homedir()
      const { waitUntilExit } = render(
        <Wizard
          onDone={async (patch) => {
            try {
              await saveWizardPatch(home, patch)
              process.stdout.write(`\nSaved provider '${patch.providerId}' to ${globalConfigPath()}\n`)
              process.exit(0)
            } catch (err) {
              process.stderr.write(`\nFailed to save provider: ${(err as Error).message}\n`)
              process.exit(1)
            }
          }}
          onCancel={() => {
            process.stderr.write('\nOnboarding cancelled.\n')
            process.exit(2)
          }}
        />,
      )
      await waitUntilExit()
    } catch (err) {
      process.stderr.write(`init failed: ${(err as Error).message}\n`)
      process.exit(1)
    }
  })()
} else if (argv[0] === 'plugin' && argv[1] === 'list') {
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
      process.stdout.write(`  tools: ${manifest.tools.length}  slash: ${manifest.slashCommands.length}  skills: ${manifest.skills.length}\n`)
      const confirm = async (): Promise<boolean> => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
        const answer: string = await new Promise(res => rl.question('Proceed? [y/N] ', res))
        rl.close()
        return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes'
      }
      const result = await installPluginFromPath({ source: path.resolve(source), home: os.homedir(), force, confirm })
      process.stdout.write(`installed '${result.name}' → ${result.targetDir}\n`)
      process.stdout.write(`  tools: ${result.toolsCount}, slash: ${result.slashCount}, skills: ${result.skillsCount}\n`)
      if (!result.toolsCount && !result.slashCount && !result.skillsCount) {
        process.stdout.write('(plugin contributes no tools/slash/skills — verify manifest)\n')
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

  const hasProviders = config.providers.length > 0
  if (!hasProviders) {
    console.error(
      `\u001b[33m[nuka]\u001b[0m No providers configured. Starting in offline mode — use /settings or /model to add a provider, or edit ${globalConfigPath()}.`,
    )
  }

  const providers = new ProviderResolver(config)
  const store = new SessionStore({ dir: sessionsDir(os.homedir()) })
  const metaWriter = new DebouncedMetaWriter(store)
  const sessions = new SessionManager({ store, metaWriter })
  const firstProvider = config.providers[0]
  const activeProviderId = config.active.providerId || firstProvider?.id || ''
  const activeProvider = activeProviderId ? config.providers.find(p => p.id === activeProviderId) : undefined
  if (activeProviderId && !activeProvider && hasProviders) {
    console.error(`active.providerId references unknown provider: ${activeProviderId}`)
    process.exit(2)
  }
  const activeModel = activeProvider?.selectedModel ?? activeProvider?.models?.[0] ?? ''

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
      sessions.start({ providerId: activeProvider?.id ?? '', model: activeModel })
    }
  } else {
    sessions.start({ providerId: activeProvider?.id ?? '', model: activeModel })
  }

  const todoStore = createTodoStore()
  const tools = new ToolRegistry()
  ;[ReadTool, WriteTool, EditTool, BashTool, GlobTool, GrepTool, WebFetchTool].forEach(t => tools.register(t as any))
  tools.register(makeTodoWriteTool(todoStore) as any)
  tools.register(makeWebSearchTool(config.search) as any)

  const slash = new SlashRegistry()
  ;[
    ExitCommand, HelpCommand, ClearCommand, NewCommand, ForkCommand, BtwCommand,
    CostCommand, ModelCommand, EffortCommand, SettingsCommand, ConfigCommand, CompactCommand, ResumeCommand,
    MemdirCommand, VimCommand, DoctorCommand,
    RewindCommand, TasksCommand, ThemeCommand, StatsCommand, PlanCommand, IdeCommand,
    StatusBarCommand, SkillCommand, RecapCommand, monitorCommand,
  ].forEach(c => slash.register(c))
  // /plugin slash dispatches to subcommands. Heavy operations
  // (install/update from the marketplace) live as top-level CLI subcommands;
  // the slash version stubs them with a hint so users don't get silent failures.
  slash.register(createPluginCommand({
    list: async () => {
      const all = await loadPlugins({ home: os.homedir() })
      return all.map(p => ({
        name: p.manifest.name,
        version: p.manifest.version,
        description: p.manifest.description,
        enabled: true,
      }))
    },
    search: async () => [],
    install: async (n) => { throw new Error(`run \`nuka plugin install ${n}\` from the shell`) },
    uninstall: async (n) => { throw new Error(`uninstall via \`rm -rf ~/.nuka/plugins/${n}\``) },
    enable: async () => { throw new Error('plugin enable: edit ~/.nuka/config.yaml plugins.enabled') },
    update: async () => ({ changed: false }),
  }))

  // Phase 10 §4.3 — singleton TaskManager for the lifetime of the CLI process.
  const home = os.homedir()
  ensureNukaLayout(home)
  try { runRetentionSweep(home) } catch { /* non-fatal */ }
  const taskManager = new TaskManager({ home, bus: eventBus })

  // Phase 14c §6.5 — autoDream periodic memdir consolidation.
  // Ticks every 30 minutes; all three gates must pass before enqueuing a dream task.
  if (config.recap?.autoDream?.enabled !== false) {
    const ad = initAutoDream({
      home,
      tasks: taskManager,
      config: {
        minHours: config.recap?.autoDream?.minHours ?? 6,
        minSessions: config.recap?.autoDream?.minSessions ?? 3,
      },
      now: () => Date.now(),
      newSessionsCount: () => 0,
      lastConsolidatedAt: () => {
        try {
          const metaPath = path.join(home, '.nuka', 'memdir', '.dream.meta.json')
          const m = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as { lastConsolidatedAt?: number }
          return m.lastConsolidatedAt ?? 0
        } catch {
          return 0
        }
      },
    })
    setInterval(() => { void ad.tick() }, 30 * 60_000).unref()
  }

  const extraDirs = parsePluginDirs(process.argv.slice(2))
  const plugins = await loadPlugins({
    home: os.homedir(),
    enabled: config.plugins?.enabled,
    extraDirs,
    checkUserConfig: true,
  })
  const hooks: import('./core/hooks/types').HookEntry[] = []
  const agents = new AgentRegistry()

  const lspManager = new LspManager()

  // Phase 7 §5.2 — process-wide cost tracker hydrated from ~/.nuka/cost.json.
  // Persisted on SIGINT (best-effort; failures are swallowed to keep exit fast).
  const costTracker = new CostTracker()
  try {
    const entries = await readCostFile(defaultCostPath())
    if (entries.length > 0) costTracker.hydrate(entries)
  } catch {
    // ignore — start with empty tracker on read failure
  }

  // Wire plugins that are ready (have config or don't need it)
  const pendingPlugins = plugins.filter(p => p.needsUserConfig)
  const readyPlugins = plugins.filter(p => !p.needsUserConfig)
  for (const p of readyPlugins) {
    const pluginConfig = await readUserConfig(os.homedir(), p.manifest.name)
    const result = await wirePlugin(p, {
      tools, slash, skills, hooks, agents, lsp: lspManager,
      pluginConfig: pluginConfig ?? undefined,
    })
    if (result.errors.length > 0) {
      for (const e of result.errors) console.warn(`[plugin:${p.manifest.name}] ${e}`)
    }
    console.error(`[plugin:${p.manifest.name}] tools=${result.toolsAdded} slash=${result.slashAdded} skills=${result.skillsAdded} hooks=${result.hooksAdded} agents=${result.agentsAdded} lsp=${result.lspAdded}`)
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

  const askUser = (payload: import('./core/permission/bridge').PermissionPayload) =>
    permBridge.ask({ ...payload, suggestedPattern: suggestPattern(payload.call) })

  const permission = new PermissionChecker(() => sessions.active()!.permissionCache, askUser)

  // Phase 14d — register core:editor agent before dispatch_agent so it
  // appears in the dispatch_agent description (which snapshots agents.list()).
  agents.register(editorAgent)

  // Phase 14a — swarm tools + role agents
  const swarmTeams = new TeamRegistry({ home })
  const swarmBackend = new InProcessBackend()
  const swarmRouter = new MessageRouter({ backends: [swarmBackend], bus: eventBus })

  tools.register(makeTeamCreateTool({ teams: swarmTeams }) as any)
  tools.register(makeTeamDeleteTool({ teams: swarmTeams }) as any)
  tools.register(makeSendMessageTool({ router: swarmRouter, teams: swarmTeams }) as any)
  tools.register(makePipelineRunTool({
    runPipeline: (i) => runPipeline({
      input: i,
      runStage: async (nodeId, prompt) => {
        const node = i.nodes.find(n => n.id === nodeId)
        if (!node) throw new Error(`pipeline: node "${nodeId}" not found`)
        const agentDef = agents.find(node.agent)
        if (!agentDef) throw new Error(`pipeline: unknown agent "${node.agent}"`)
        const ctrl = new AbortController()
        const r = await dispatchAgent({
          agent: agentDef, task: prompt, registry: tools,
          providerResolver: providers, permission, signal: ctrl.signal,
        })
        return typeof r.output === 'string'
          ? r.output
          : r.output.map(b => b.type === 'text' ? (b as { type: 'text'; text: string }).text : '').join('')
      },
    }),
  }) as any)
  tools.register(makeRoundtableTool({
    runRoundtable: (i) => runRoundtable({
      input: i,
      sendRound: async (memberName, round) => {
        const member = i.members.find(m => m.name === memberName)
        if (!member) throw new Error(`roundtable: member "${memberName}" not found`)
        const agentDef = agents.find(member.agent)
        if (!agentDef) throw new Error(`roundtable: unknown agent "${member.agent}"`)
        const ctrl = new AbortController()
        const r = await dispatchAgent({
          agent: agentDef,
          task: `[Roundtable round ${round + 1}] Topic: ${i.topic}\nYour role: ${member.role}`,
          registry: tools, providerResolver: providers, permission, signal: ctrl.signal,
        })
        return typeof r.output === 'string'
          ? r.output
          : r.output.map(b => b.type === 'text' ? (b as { type: 'text'; text: string }).text : '').join('')
      },
      synthesize: async (transcript) => {
        const synthMember = i.members.find(m => m.name === i.synthesizer)
        const agentRef = synthMember?.agent ?? i.synthesizer
        const agentDef = agents.find(agentRef)
        if (!agentDef) throw new Error(`roundtable: unknown synthesizer agent "${agentRef}"`)
        const ctrl = new AbortController()
        const r = await dispatchAgent({
          agent: agentDef,
          task: `Synthesize the following roundtable discussion into a final artifact:\n\n${transcript}`,
          registry: tools, providerResolver: providers, permission, signal: ctrl.signal,
        })
        return typeof r.output === 'string'
          ? r.output
          : r.output.map(b => b.type === 'text' ? (b as { type: 'text'; text: string }).text : '').join('')
      },
    }),
  }) as any)

  for (const role of ROLE_AGENTS) agents.register(role)

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
    const lspCleanup = lspManager.closeAll().catch(() => {})
    // Phase 7 §5.2 — flush cost tracker on exit. Best-effort.
    const costFlush = writeCostFile(defaultCostPath(), costTracker.snapshot()).catch(() => {})
    // Phase 7 §5.3 — synth a memory entry from this session's transcript.
    // Hard-bounded by synth's 5s internal timeout; failures are swallowed.
    const memSynth = synthOnExit()
    Promise.all([lspCleanup, costFlush, memSynth]).finally(() => metaWriter.flush().finally(() => process.exit(0)))
  })

  const activeSession = sessions.active()!
  let autoCompact: AutoCompactOpts | undefined
  if (hasProviders && activeSession.providerId) {
    const compactModel = config.compact?.model ?? activeSession.model
    const { provider: compactProvider } = providers.resolveFor(activeSession)
    autoCompact = {
      provider: compactProvider,
      model: compactModel,
      keepTurns: config.compact?.keepTurns ?? 3,
      autoThreshold: config.compact?.autoThreshold ?? 0.8,
      contextWindow: config.compact?.contextWindow ?? 200_000,
    }
  }

  // Phase 7 §5.3 — preload memory entries for this cwd. Refreshed on each
  // turn so newly synth'd entries appear without a CLI restart.
  let memoryCache: MemoryEntry[] = await loadMemory(cwd).catch(() => [])

  // Phase 13 M2 — load updates + recent sessions for the Welcome screen.
  // Both are best-effort: failures silently return [].
  const [welcomeUpdates, welcomeRecent]: [UpdateEntry[], RecentEntry[]] =
    await Promise.all([
      loadUpdates(os.homedir()),
      loadRecent(os.homedir()),
    ])

  const runAgent = (input: { text: string }, session: Session, signal: AbortSignal) => {
    if (!session.providerId) {
      throw new Error('No provider configured. Use /settings to add one, or edit ~/.nuka/config.yaml.')
    }
    return runAgentLoop(input, session, {
      provider: providers,
      tools,
      permission,
      systemPromptInput: () => ({
        cwd, platform, shell, nodeVersion, gitBranch, skills,
        memory: findRelevant(memoryCache, tokenize(input.text), 5),
      }),
      skills,
      persist: sessions.persist,
      autoCompact: autoCompact!,
      hooks,
      lsp: lspManager,
      costTracker,
      effort: config.effort,
    }, signal)
  }

  // Phase 7 §5.3 — synth + append. Returns the entry or null. Always
  // swallows errors; never throws. Used by both SIGINT and /memdir compact.
  const synthAndAppend = async () => {
    const active = sessions.active()
    if (!active || !active.providerId) return null
    if (active.messages.length < 2) return null
    try {
      const { provider, model } = providers.resolveFor(active)
      const entry = await synthMemoryEntry(active.messages, provider, model, active.id)
      if (!entry) return null
      await appendMemory(cwd, entry)
      memoryCache = await loadMemory(cwd).catch(() => memoryCache)
      return entry
    } catch {
      return null
    }
  }
  setMemdirSynthCallable(synthAndAppend)
  const synthOnExit = async (): Promise<void> => { await synthAndAppend() }

  // Phase 14d — harness state machine + primitives + /harness slash.
  // Mode defaults to 'deep'; set to 'off' in config.harness.mode to disable.
  // Note: session.leadAgent and systemPromptOverride are not yet available in
  // this host; editor system prompt binding deferred to phase14b/c follow-up.
  const harnessMode = activeSession ? (config.harness?.mode ?? 'deep') : 'off'
  const harness = new HarnessStateMachine({
    sessionId: sessions.active()?.id ?? 'default',
    bus: eventBus,
    home,
    mode: harnessMode,
    scratchpadKB: config.harness?.scratchpadKB ?? 50,
  })
  if (harnessMode !== 'off') {
    tools.register(makeSequentialThinkingTool(harness) as any)
    tools.register(makeSearchAndVerifyTool(harness, { runResearcher: async (q) => `(stub) results for: ${q}` }) as any)
    tools.register(makeAskUserQuestionTool(harness, { askUser: async (q) => `(prompt user via TUI: ${q})` }) as any)
  }
  // T8.1 — three-axis triage slash command. `runFork` is currently stubbed
  // (the production fork bridge is wired through dispatch_agent and not yet
  // exposed as a plain prompt-in/text-out callable here); this matches the
  // stub style above for the harness primitives.
  const triageRunFork = async (_p: string): Promise<{ text: string }> => ({
    text: '(stub triage fork response)',
  })
  const triageDeps = { runFork: triageRunFork }
  slash.register(makeHarnessCommand(harness, triageDeps))
  slash.register(makeTriageCommand({ harness, ...triageDeps }))
  // T8.2 — coordination layer slash command. Reuses the same paths the
  // harness uses internally and the swarm's MessageRouter for a2a sends.
  slash.register(
    makeCoordinationCommand({
      graphPath: () => harness.snapshot().taskGraphPath,
      subsPath: () => path.join(home, '.nuka', 'coordination', `${harness.snapshot().sessionId}.subs.json`),
      router: swarmRouter,
    }),
  )

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
      tools={tools}
      sessionPluginCount={plugins.filter(p => p.source === 'session').length}
      costTracker={costTracker}
      taskManager={taskManager}
      todoStore={todoStore}
      loadedPlugins={plugins.map(p => ({ name: p.manifest.name, description: p.manifest.description }))}
      loadedSkills={skills.map(s => ({ name: s.name, description: s.description }))}
      updates={welcomeUpdates}
      recent={welcomeRecent}
      harness={harness}
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
          const result = await wirePlugin(p, { tools, slash, skills, hooks, agents, pluginConfig: config })
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

