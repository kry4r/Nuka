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
import { makeLazyTool } from './core/tools/lazy'
import { loadToolFromSidecar } from './core/tools/extra/loader'
import { createHookRegistry, wrapWithHooks, applyHookConfig, defaultHookConfigPaths, makeHookListTool, fireSessionStart, fireSessionEnd } from './core/hooks'
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
import { HistoryCommand } from './slash/history'
import { MemdirCommand, setMemdirSynthCallable } from './slash/memdir'
import { VimCommand } from './slash/vim'
import { DoctorCommand } from './slash/doctor'
import { RewindCommand } from './slash/rewind'
import { TasksCommand } from './slash/tasks'
import { TaskRunCommand } from './slash/taskRun'
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
import { getCronStore } from './core/cron/store'
import { makeCronTools } from './core/cron/tools'
import { bootRehydrate as bootCronRehydrate, defaultCronPath } from './core/cron/persist'
import { CronScheduler } from './core/cron/scheduler'
import { CronPromptQueue } from './core/session/cronPromptQueue'
import { EstimateTokensTool } from './core/tokens/tools'
import { TokenCountTool } from './core/tokens/tokenCountTool'
import { getWorktreeStore } from './core/worktree/store'
import { makeWorktreeTools } from './core/worktree/tools'
import { createStructuredOutputTool } from './core/structuredOutput/tool'
import { SleepTool } from './core/sleep/tool'
// FormatDuration / JsonFormat / ShellQuote / CodeBlocks / WrapText /
// Slug / Truncate / TextStats / Whitespace / CaseConvert / AnsiStyle /
// UrlExtract / GlobMatch — heavy text-utility tools moved to the
// sidecar bundle `dist/tools-extra.js`; registered as lazy proxies
// below (see Phase P2 #12, core/tools/lazy.ts).
import { LAZY_TOOL_ENTRIES, lspQueryToolMeta } from './core/tools/extra/lazyMetas'
// ApplyDiffTool / FindReplaceTool — lazy via sidecar (Phase P2 #12).
// Their permission predicates are inlined in the lazy metadata so the
// permission gate stays synchronous.
import { createApplyDiffPermissionHandler } from './core/diff/applyDiffPermissionHook'
import { PlanModeState } from './core/planMode/planModeState'
import { makePlanModeTools } from './core/planMode/planModeTools'
import { writePlan } from './core/plan/state'
import { getTaskStore } from './core/tasks/store'
import { makeTaskTools } from './core/tasks/tools'
import { makeTaskOutputTool } from './core/tasks/outputTool'
import { makeTaskStopTool } from './core/tasks/stopTool'
import { makeToolSearchTool } from './core/toolSearch/tool'
import { FileSearchTool } from './core/fileSearch/fileSearchTool'
import { makeRecentFilesTool } from './core/fileSearch/recentFilesTool'
import { RecentFiles, createPersistentRecentFiles, defaultRecentFilesPath } from './core/fileSearch/recentFiles'
import type { PersistentRecentFiles } from './core/fileSearch/recentFiles'
import { createRecentFilesTouchHandler } from './core/fileSearch/recentFilesHook'
import { createAutoTruncateHook } from './core/toolResult/autoTruncateHook'
import { createPathDisplayHandler } from './core/paths/pathDisplayHook'
import { createJsonFormatHandler } from './core/jsonFormat/jsonFormatHook'
import { createWordWrapHandler } from './core/wordWrap/wordWrapHook'
import { createWhitespaceHookHandler } from './core/whitespace/whitespaceHook'
import { createUrlExtractHandler } from './core/urlExtract/urlExtractHook'
import { currentGitBranch } from './core/session/telemetry'
import { runAgent as runAgentLoop } from './core/agent/loop'
import { compactSession } from './core/compact/compact'
import type { AutoCompactSessionAwareOpts } from './core/agent/autoCompact'
import { globalConfigPath } from './core/config/paths'
import { microCompactOptionsFromConfig } from './core/config/microCompact'
import { resolveEffortForModel } from './core/config/effort'
import { MACRO_VERSION } from './version'
import type { Session } from './core/session/types'
import { loadAllSkills } from './core/skill/loadDir'
import { initBundledSkills } from './core/skill/bundled/index'
import { loadOutputStyles } from './core/outputStyles/loader'
import { selectActiveStyleName, resolveActiveOutputStyle } from './core/outputStyles/resolve'
import { makeSkillTool } from './core/skill/skillTool'
import { buildSessionPersistence } from './core/session/history/persist'
import { loadPlugins } from './core/plugin/loader'
import { wirePlugin } from './core/plugin/wire'
import { readManifestFrom, installPluginFromPath } from './core/plugin/install'
import { readUserConfig, writeUserConfig } from './core/plugin/userConfig'
import { AgentRegistry } from './core/agents/registry'
import { makeDispatchAgentTool } from './core/agents/dispatchTool'
import { makeSpawnAgentTool } from './core/agents/spawnTool'
import { makeCloseAgentTool, makeResumeAgentTool, makeSendAgentTool, makeSendInputTool, makeWaitAgentTool } from './core/agents/agentLifecycleTools'
import { makeCoordinateAgentsTool } from './core/tools/coordinator/coordinateAgentsTool'
import type { Tool as ToolType } from './core/tools/types'
import { dispatchAgent } from './core/agents/dispatch'
import { resolveAgentDef } from './core/agents/loader'
import { loadSubagentsFromDir, defaultSubagentDirs, subagentToAgentDef } from './core/agents/subagentLoader'
import { validatePlugin, formatReport } from './core/plugin/validate'
import { LspManager } from './core/lsp/manager'
import { makeLspDiagnosticsTool, makeLspDefinitionTool, makeLspReferencesTool } from './core/lsp/tools'
// `makeLspQueryTool` — lazy via sidecar (Phase P2 #12). Loaded from
// `dist/tools-extra.js` and bound to the local LspManager closure on
// first call.
// Wizard / saveWizardPatch — only loaded on `nuka init`. Mirrors the
// existing dynamic-import pattern used by `nuka doctor` (Phase P2 #12).
import { CostTracker } from './core/cost/tracker'
import { defaultCostPath, readCostFile, writeCostFile } from './core/cost/persist'
import { installCostExitHook } from './core/cost/costHook'
import { defaultCostHistoryPath } from './core/cost/costHistory'
import { loadMemory, loadTeamMemory, appendMemory } from './core/memdir/index'
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
import { createAwaySummaryRunner, makeAwaySummaryTool, startIdleAwaySummaryHook } from './core/awaySummary'
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
import { makeInkStdin } from './tui/inkStdin'
import { getEmergencyTipFromConfig } from './core/notices/emergencyTip'
import { formatCronMissedNotice, type CronMissedNotice } from './core/notices/cronMissed'

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
} else if (argv[0] === 'explore') {
  // ---------------------------------------------------------------------------
  // nuka explore <verb> [options]
  //
  // M0 — explorer module skeleton.  The explorer bundle is lazy-loaded from
  // dist/explorer.js (T3) so it never enters dist/cli.js.  In dev mode
  // (tsx src/cli.tsx) the dist file does not exist; the catch path falls back
  // to the in-tree TypeScript source, mirroring the --test-plan pattern above.
  // ---------------------------------------------------------------------------
  ;(async () => {
    try {
      let mod: typeof import('./core/testing/explorer/index')
      const distUrl = new URL('./explorer.js', import.meta.url).href
      try {
        mod = (await import(distUrl)) as typeof import('./core/testing/explorer/index')
      } catch {
        const srcUrl = new URL('./core/testing/explorer/index.ts', import.meta.url).href
        mod = (await import(srcUrl)) as typeof import('./core/testing/explorer/index')
      }
      process.exit(await mod.runExploreCli(argv.slice(1)))
    } catch (err) {
      process.stderr.write(`explore failed: ${(err as Error).message}\n`)
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
      const { Wizard } = await import('./tui/Onboarding/Wizard')
      const { saveWizardPatch } = await import('./core/onboarding/save')
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
        { stdin: makeInkStdin() },
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
  // Register the bundled (in-process) tier-1 skills once at bootstrap.
  // `loadAllSkills` reads the same registry and merges disk skills on
  // top so disk continues to override bundled by name.
  initBundledSkills()
  const skills = await loadAllSkills({ home: os.homedir(), cwd })
  // User-defined output styles from `.nuka/output-styles/*.md`. Best-
  // effort load: scan failures fall back to an empty list so a broken
  // directory never blocks startup. Resolution to the active style
  // (env var > config field > none) happens lazily so changes between
  // turns are observed without a CLI restart.
  const outputStylesCache = await loadOutputStyles({ home: os.homedir(), cwd }).catch(() => [])
  const resolveActiveOutputStyleNow = () => {
    const name = selectActiveStyleName(process.env)
    return resolveActiveOutputStyle(outputStylesCache, name)
  }

  const hasProviders = config.providers.length > 0
  if (!hasProviders) {
    console.error(
      `\u001b[33m[nuka]\u001b[0m No providers configured. Starting in offline mode — use /settings or /model to add a provider, or edit ${globalConfigPath()}.`,
    )
  }

  const providers = new ProviderResolver(config)
  // B4 — persistence is now opt-in via NUKA_SESSION_PERSIST. When the env
  // is unset (default), both store + metaWriter are undefined, the
  // SessionManager runs in-memory only, and `--resume` / `/history` are
  // unavailable. When set, the wiring is identical to pre-B4 behaviour.
  const persistence = buildSessionPersistence({ home: os.homedir(), env: process.env })
  const store = persistence.store
  const metaWriter = persistence.metaWriter
  const sessions = new SessionManager(persistence)
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
  if (resumeArg !== undefined && !store) {
    console.error('--resume requires NUKA_SESSION_PERSIST=1')
    process.exit(2)
  }
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
  // Process-singleton in-process HookRegistry. Wired into tool execution
  // via wrapWithHooks: every tool registered on this ToolRegistry has its
  // `run` intercepted to fire `beforeToolCall` / `afterToolCall` hooks
  // (with `{ skip: true }` veto semantics). Handlers are registered by
  // future iters (plugins, hooks-config loader, etc.); today the registry
  // ships empty so wiring is a no-op for users without hook contributors.
  const hookRegistry = createHookRegistry()
  // Practical Iter FFF — session-scoped MRU tracker, shared between the
  // agent-callable RecentFilesTool (which lets the model inspect/manage
  // history) and the beforeToolCall hook below (which bumps it on every
  // Read/Edit/Write). Lifting the construction here keeps the tracker
  // singleton across the two consumers without leaking it to other
  // modules.
  //
  // Practical Iter OOO — when persistence is enabled (default ON; opt-out
  // via NUKA_RECENT_FILES_NO_PERSIST=1) the tracker rehydrates from
  // `~/.nuka/recent-files.json` on boot and atomically mirrors every
  // touch/forget/clear back to disk. Writes are coalesced inside
  // `createPersistentRecentFiles` — at most one in-flight write at a
  // time, with a single follow-up flush picking up any dirty state.
  // Failures inside the writer are swallowed so disk hiccups never
  // surface as tool errors. Tests / CI set `NUKA_RECENT_FILES_NO_PERSIST=1`
  // to keep the home dir untouched.
  let recentFilesTracker: RecentFiles
  let recentFilesPersistent: PersistentRecentFiles | null = null
  if (process.env.NUKA_RECENT_FILES_NO_PERSIST === '1') {
    recentFilesTracker = new RecentFiles()
  } else {
    try {
      const persistent = await createPersistentRecentFiles({
        path: defaultRecentFilesPath(),
      })
      recentFilesTracker = persistent
      recentFilesPersistent = persistent
    } catch {
      // Any unexpected error during load → fall back to in-memory only.
      // Persistence is best-effort; users without write access to ~ shouldn't
      // see a crash here.
      recentFilesTracker = new RecentFiles()
    }
  }
  hookRegistry.register(
    'beforeToolCall',
    createRecentFilesTouchHandler(recentFilesTracker),
    { id: 'recentFiles-auto-touch' },
  )
  // Practical Iter III — afterToolCall guard that middle-truncates oversized
  // string `output` before it reaches the agent's context. Default budget
  // (8000 graphemes) is large enough for typical reads and bash dumps,
  // small enough to stop a 50k-line log from blowing the model's window.
  // Error outputs and ContentBlock[] outputs pass through unchanged — the
  // hook intentionally only shrinks successful textual results.
  hookRegistry.register(
    'afterToolCall',
    createAutoTruncateHook({ maxChars: 8000 }),
    { id: 'auto-truncate-output' },
  )
  // Iter LLL — opt-in path-display rewriter. When
  // NUKA_PATH_DISPLAY_HOOK=1 is set, every successful string ToolResult
  // is post-processed so absolute paths in `output` are humanised via
  // `displayPath` (tildify + cwd-relativise). Default: off — rewriting
  // tool output is a user-visible behaviour change and some workflows
  // expect verbatim path text. The handler is conservative: error
  // results, ContentBlock[] outputs, and substrings inside JSON string
  // literals are left untouched.
  if (process.env.NUKA_PATH_DISPLAY_HOOK === '1') {
    hookRegistry.register(
      'afterToolCall',
      createPathDisplayHandler({ cwd }),
      { id: 'path-display-rewriter' },
    )
  }
  // Iter NNN — opt-in JSON pretty-printer. When NUKA_JSON_FORMAT_HOOK=1
  // is set, raw single-line JSON tool output is reformatted via
  // `formatJSON`. The handler is conservative: it parses the trimmed
  // body with `JSON.parse` and only rewrites on a successful round-trip,
  // so "looks JSON-ish" output (markdown that happens to start with `{`
  // / `[`) is left untouched. Default: off — rewriting tool output is a
  // user-visible behaviour change.
  if (process.env.NUKA_JSON_FORMAT_HOOK === '1') {
    hookRegistry.register(
      'afterToolCall',
      createJsonFormatHandler(),
      { id: 'json-format-pretty-printer' },
    )
  }
  // Iter BBBB — opt-in word-wrap rewriter. When NUKA_WORD_WRAP_HOOK=1 is
  // set, successful STRING ToolResults are re-flowed via `wrapText` to
  // fit the configured column budget (NUKA_WORD_WRAP_WIDTH, default 100).
  // The handler is conservative: error results, ContentBlock[] outputs,
  // outputs below minLength, and outputs that already fit the budget on
  // every line pass through unchanged. Default: off — re-flowing tool
  // output is a user-visible behaviour change and CI / mechanical-diff
  // workflows expect verbatim columns.
  if (process.env.NUKA_WORD_WRAP_HOOK === '1') {
    const rawWidth = process.env.NUKA_WORD_WRAP_WIDTH
    let width: number | undefined
    if (rawWidth !== undefined && rawWidth.length > 0) {
      const parsed = Number.parseInt(rawWidth, 10)
      if (Number.isInteger(parsed) && parsed > 0) width = parsed
    }
    hookRegistry.register(
      'afterToolCall',
      createWordWrapHandler(width !== undefined ? { width } : {}),
      { id: 'word-wrap-rewriter' },
    )
  }
  // Iter EEEE — opt-in URL annotator. When NUKA_URL_EXTRACT_HOOK=1 is set,
  // successful STRING ToolResults are scanned for URLs and the extracted
  // list is tacked onto the surfaced result as a sibling `urls` field.
  // The text `output` is preserved verbatim — wrap/truncate/pathDisplay
  // handle the visible side; this hook just annotates. Downstream
  // observers (TUI Cmd+Click sidebar, telemetry, future fetcher
  // heuristics) can read the field; consumers that don't know it just
  // ignore it. Error results, ContentBlock[] outputs, and outputs below
  // 50 chars pass through unchanged. Default: off — annotation is a
  // user-visible behaviour change for any consumer that already reads
  // the result object as a strict ToolResult.
  if (process.env.NUKA_URL_EXTRACT_HOOK === '1') {
    hookRegistry.register(
      'afterToolCall',
      createUrlExtractHandler(),
      { id: 'url-extract-annotator' },
    )
  }
  // P0 #2 — opt-in whitespace normalizer for ASSISTANT model output (not
  // tool output, unlike BBBB/LLL/etc.). When NUKA_WHITESPACE_HOOK=1 is
  // set, the handler runs `whitespace.normalize` over the assembled
  // assistant text each time an assistant message lands on the
  // transcript and surfaces the diagnostic via the registry's
  // InvocationResult. CURRENT SEMANTICS: observer-only. The handler does
  // NOT rewrite session.messages — `afterAssistantMessage` fires AFTER
  // appendMessage, and a retroactive rewrite contract is not yet
  // designed. This step plumbs the event end-to-end; a follow-up iter
  // may layer `replaceText` once the rewrite path is agreed.
  if (process.env.NUKA_WHITESPACE_HOOK === '1') {
    hookRegistry.register(
      'afterAssistantMessage',
      createWhitespaceHookHandler(),
      { id: 'whitespace-normalize-observer' },
    )
  }
  // Iter KKK — opt-in ApplyDiff sandbox. When
  // NUKA_APPLY_DIFF_ALLOWED_ROOTS is set (comma-separated list of roots,
  // absolute or relative to cwd), any ApplyDiff call whose target path
  // escapes the allow-list is vetoed before it touches disk. Unset →
  // unchanged behaviour (production default). Roots are resolved
  // against the launch-time cwd so the user's sandbox follows the
  // session, not the agent's later directory hops.
  const applyDiffAllowedRoots = process.env.NUKA_APPLY_DIFF_ALLOWED_ROOTS
  if (applyDiffAllowedRoots && applyDiffAllowedRoots.trim().length > 0) {
    const roots = applyDiffAllowedRoots
      .split(',')
      .map((r) => r.trim())
      .filter((r) => r.length > 0)
    if (roots.length > 0) {
      hookRegistry.register(
        'beforeToolCall',
        createApplyDiffPermissionHandler({ allowedRoots: roots, cwd }),
        { id: 'applyDiff-permission-gate' },
      )
    }
  }
  // Practical Iter GGG — load any user-defined in-process hook handlers
  // from default search paths (cwd/.nuka/hooks.config.{js,mjs} and
  // home/.nuka/hooks.config.{js,mjs}). Missing files are a no-op; only
  // files that *exist* but fail to load/validate produce a warning.
  // Mirrors the plugin-loader / cron-rehydrate posture — never blocks boot.
  for (const hookConfigPath of defaultHookConfigPaths(cwd, os.homedir())) {
    const cfgResult = await applyHookConfig(hookRegistry, hookConfigPath)
    if (cfgResult.errors.length > 0) {
      console.warn(`[nuka:hooks] config errors from ${hookConfigPath}: ${cfgResult.errors.map(e => e.message).join('; ')}`)
    }
  }
  // Practical Iter JJJ — fire sessionStart once the registry is fully
  // populated (built-in handlers + user config). The active session is
  // already created above. Resumed sessions report `resumed: true` so
  // handlers can distinguish a fresh boot from `--resume`.
  {
    const startSession = sessions.active()
    if (startSession) {
      void fireSessionStart(hookRegistry, {
        sessionId: startSession.id,
        providerId: startSession.providerId,
        model: startSession.model,
        cwd,
        resumed: resumeArg !== undefined,
      })
    }
  }
  // Intercept register() to wrap each Tool exactly once. Keeping the
  // override local avoids changing ToolRegistry's public surface and
  // every consumer that constructs its own registry (subagent dispatch,
  // tests, etc.) opts in independently.
  //
  // Iter WWW — afterToolCall dispatch mode. As of the pipeline-default
  // flip, multi-hook output transformers (jsonFormat → pathDisplay →
  // wordWrap → urlExtract) CHAIN by default: each handler's
  // `data.replaceResult` feeds the next handler's `payload.result`, so
  // the transforms compose into a single output. Single-handler setups
  // see no behaviour change (pipeline ≡ last-write-wins with one
  // handler). To restore the legacy Iter III shape (every handler reads
  // the original tool result; last successful replaceResult wins) set
  // NUKA_HOOK_PIPELINE_MODE=last-write-wins in the environment.
  const hookPipelineMode =
    process.env.NUKA_HOOK_PIPELINE_MODE === 'last-write-wins'
      ? ('last-write-wins' as const)
      : ('pipeline' as const)
  const originalRegister = tools.register.bind(tools)
  tools.register = ((tool) => originalRegister(wrapWithHooks(tool, hookRegistry, { pipelineMode: hookPipelineMode }))) as typeof tools.register
  ;[ReadTool, WriteTool, EditTool, BashTool, GlobTool, GrepTool, WebFetchTool].forEach(t => tools.register(t as any))
  tools.register(makeTodoWriteTool(todoStore) as any)
  tools.register(makeWebSearchTool(config.search) as any)
  // Iter GGGG — hoisted scheduler reference so SIGINT / beforeExit can
  // stop it. Set inside the cron-wiring block below when (and only when)
  // `NUKA_CRON_SCHEDULER=1` is in the env. Default is OFF so existing
  // installs see no behaviour change — surprise periodic activity in
  // production is opt-in.
  let cronScheduler: CronScheduler | null = null
  // Iter JJJJ — process-wide cron prompt queue. Always instantiated (the
  // queue is a cheap object whether or not anything pushes to it), but the
  // agent loop only drains it when `NUKA_CRON_INJECT_PROMPTS=1` is set.
  // Hoisted alongside `cronScheduler` so both wiring sites (the scheduler
  // fire callback below and the `runAgent` deps further down) see the
  // same instance.
  const cronPromptQueue = new CronPromptQueue()
  // P1 #5 — missed-task notice payload. Hoisted out of the cron IIFE so we
  // can thread it into the `<App>` props alongside `emergencyTip`. `null`
  // until either (a) bootCronRehydrate returns no missed tasks, or (b) the
  // notice formatter returns null. Either way the Welcome slot stays empty.
  let cronMissedNotice: CronMissedNotice | null = null
  {
    // Practical Iter J — rehydrate persisted cron jobs BEFORE we touch the
    // singleton store (first-caller-wins semantics: `getCronStore({...})`
    // here decides durability for the process). Missed tasks (scheduled
    // window in the past while Nuka was down) are surfaced via the Welcome
    // notice slot (see CronMissedNotice).
    const cronPath = defaultCronPath(cwd)
    const cronStore = getCronStore({ persistPath: cronPath })
    try {
      const { missed } = await bootCronRehydrate({ store: cronStore, path: cronPath })
      // P1 #5 — route the missed-task list into the Welcome notice slot
      // instead of `console.warn`. Stderr writes here would race the ink
      // alt-screen handover (and on some terminals get eaten outright);
      // the bordered notice below the welcome banner is the right surface.
      // `formatCronMissedNotice` returns null for the empty case, so the
      // slot renders nothing when there's nothing to say.
      cronMissedNotice = formatCronMissedNotice(missed)
    } catch {
      // Best-effort — never block startup on a cron-file read.
    }
    const cronTools = makeCronTools(cronStore)
    ;[cronTools.create, cronTools.list, cronTools.delete].forEach(t => tools.register(t as any))
    // Iter GGGG — REPL-side cron tick. Opt-in via `NUKA_CRON_SCHEDULER=1`
    // so the default boot remains tick-free (matches the cron-tools
    // posture before this iter — registry only). When enabled, fires
    // tasks via stderr + the `[nuka:cron]` tag so downstream UIs can
    // hook in later without touching the scheduler contract.
    if (process.env.NUKA_CRON_SCHEDULER === '1') {
      cronScheduler = new CronScheduler({
        registry: cronStore,
        fire: async (taskId, task, firedAt) => {
          // Iter JJJJ — route fires into the agent input queue so a cron
          // task can actually drive the model. When
          // `NUKA_CRON_INJECT_PROMPTS=1` is also set, the agent loop
          // drains this queue at start-of-runAgent. Otherwise the entries
          // pile up harmlessly and the stderr log below remains the only
          // visible side effect (matches the Iter GGGG first-pass surface
          // so existing behaviour with NUKA_CRON_SCHEDULER=1 alone is
          // preserved).
          cronPromptQueue.enqueue(taskId, task.prompt, firedAt)
          // Diagnostic line — kept regardless of injection so the
          // `[nuka:cron]` tag in stderr remains a stable signal for log
          // greppers / future TUI banner integration.
          process.stderr.write(
            `[nuka:cron] fired ${taskId} (${task.cron}): ${task.prompt}\n`,
          )
        },
      })
      cronScheduler.start()
    }
  }
  tools.register(EstimateTokensTool as any)
  tools.register(TokenCountTool as any)
  {
    const wt = makeWorktreeTools({ store: getWorktreeStore() })
    ;[wt.enter, wt.list, wt.exit].forEach(t => tools.register(t as any))
  }
  { const so = createStructuredOutputTool({ type: 'object', properties: {} }); if (so.ok) tools.register(so.tool as any) }
  tools.register(SleepTool as any)
  // Phase P2 #12 — heavy text-utility tools live in
  // `dist/tools-extra.js` and are registered as lazy proxies that
  // dynamic-import the real impl on first call (see
  // core/tools/lazy.ts + core/tools/extra/lazyMetas.ts). Metadata
  // (name / params / tags / permission hint / aliases / searchHint)
  // is inlined so the registry, ToolSearch, and permission checker
  // stay synchronous at boot. wrapWithHooks runs around the proxy's
  // run() — hook threading is unchanged.
  for (const entry of LAZY_TOOL_ENTRIES) {
    const exportName = entry.exportName
    tools.register(
      makeLazyTool(entry.meta, async () => {
        const real = await loadToolFromSidecar(exportName)
        return real as unknown as import('./core/tools/types').Tool<unknown>
      }) as any,
    )
  }
  // ApplyDiff / FindReplace are now part of LAZY_TOOL_ENTRIES (see
  // their entries with input-dependent `needsPermission`). The
  // permission HOOK still loads eagerly — see
  // createApplyDiffPermissionHandler import + hook registration above.
  {
    const tt = makeTaskTools(getTaskStore())
    ;[tt.create, tt.list, tt.get, tt.update].forEach(t => tools.register(t as any))
  }
  tools.register(makeToolSearchTool(tools) as any)
  tools.register(FileSearchTool as any)
  // Practical Iter JJ — RecentFilesTool wraps the session-scoped MRU
  // tracker so the agent can inspect/manage recent-file history via
  // tool-use. The tracker is the same singleton bumped automatically by
  // the `recentFiles-auto-touch` beforeToolCall hook (Iter FFF), so a
  // tool-issued `list` reflects every Read/Edit/Write the agent has
  // done this session.
  tools.register(makeRecentFilesTool(recentFilesTracker) as any)
  // Iter YYY/ZZZ — Plan-mode tool. `PlanModeState` is a per-process
  // singleton (one per CLI invocation, just like `recentFilesTracker`
  // above) that the three plan-mode tools share.
  //
  // Iter ZZZ wired the state to the active session + per-cwd plan
  // file: the listener below flips `Session.mode` between 'plan' and
  // 'normal' on enter/exit, which is what `PermissionChecker` already
  // gates on (Write/Edit/Bash + destructive/openWorld annotations get
  // blocked when `mode === 'plan'` — see core/permission/checker.ts).
  // On exit, the plan text is also persisted to the per-cwd file via
  // `writePlan()` so it survives the process. Persistence errors are
  // logged but do NOT prevent the session.mode reset — losing the disk
  // copy is bad, but leaving the user stuck in plan mode is worse.
  const planModeState = new PlanModeState()
  planModeState.subscribe(event => {
    const active = sessions.active()
    if (!active) {
      // No active session yet (very early in startup, e.g. before
      // `sessions.start(...)` ran). The plan-mode tools shouldn't have
      // been callable yet, but bail safely if it happens.
      return
    }
    if (event.type === 'enter') {
      active.mode = 'plan'
      return
    }
    if (event.type === 'exit') {
      active.mode = 'normal'
      // Fire-and-forget; we don't await inside a sync listener but we
      // do catch + log so a fs failure doesn't leak as an unhandled
      // promise rejection.
      void writePlan(process.cwd(), event.plan).catch(err => {
        console.error('[plan-mode] failed to persist plan:', err)
      })
      return
    }
    // event.type === 'reset' — same fall-back-to-normal effect as exit
    // but without writing the (now-cleared) plan to disk.
    active.mode = 'normal'
  })
  const planModeTools = makePlanModeTools(planModeState)
  tools.register(planModeTools.enter as any)
  tools.register(planModeTools.exit as any)
  tools.register(planModeTools.status as any)
  // Practical Iter HHH — agent-facing introspection over the same
  // HookRegistry wired above. Read-only `list` / `count` plus a narrow
  // `clearByEvent` for debugging; `register` is intentionally NOT
  // exposed (security: agent could install arbitrary handlers).
  tools.register(makeHookListTool(hookRegistry) as any)

  const slash = new SlashRegistry()
  ;[
    ExitCommand, HelpCommand, ClearCommand, NewCommand, ForkCommand, BtwCommand,
    CostCommand, ModelCommand, EffortCommand, SettingsCommand, ConfigCommand, CompactCommand, ResumeCommand,
    HistoryCommand,
    MemdirCommand, VimCommand, DoctorCommand,
    RewindCommand, TasksCommand, TaskRunCommand, ThemeCommand, StatsCommand, PlanCommand, IdeCommand,
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

  // Practical track iter H — TaskOutput + TaskStop tools wrap the live
  // TaskManager so the model can read stdout/state and kill background tasks.
  // (Complements iter G's TaskCreate/List/Get/Update which operate on the
  //  agent-facing TODO list in src/core/tasks/store.ts.)
  const taskOutputTool = makeTaskOutputTool(taskManager, { home })
  const taskStopTool = makeTaskStopTool(taskManager)
  tools.register(taskOutputTool as any)
  tools.register(taskStopTool as any)
  tools.register(makeWaitAgentTool(taskOutputTool) as any)
  tools.register(makeCloseAgentTool(taskStopTool) as any)

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
  // B1 — fold session entries into the long-lived daily-totals file
  // (`~/.nuka/cost-history.json`) when the process exits. Synchronous by
  // necessity (process.on('exit') doesn't await Promises). Safe to install
  // unconditionally — when the tracker is empty at exit the handler no-ops.
  // We intentionally leave the handler installed across the SIGINT graceful
  // path: writeCostFile in that block writes the per-entry log (cost.json),
  // not the history file. process.exit(0) fires the 'exit' event so the
  // daily fold still runs once on either path.
  installCostExitHook(costTracker, defaultCostHistoryPath())

  // Wire plugins that are ready (have config or don't need it)
  const pendingPlugins = plugins.filter(p => p.needsUserConfig)
  const readyPlugins = plugins.filter(p => !p.needsUserConfig)
  for (const p of readyPlugins) {
    const pluginConfig = await readUserConfig(os.homedir(), p.manifest.name)
    const result = await wirePlugin(p, {
      tools, slash, skills, hooks, agents, lsp: lspManager,
      hookRegistry,
      pluginConfig: pluginConfig ?? undefined,
    })
    if (result.errors.length > 0) {
      for (const e of result.errors) console.warn(`[plugin:${p.manifest.name}] ${e}`)
    }
    console.error(`[plugin:${p.manifest.name}] tools=${result.toolsAdded} slash=${result.slashAdded} skills=${result.skillsAdded} hooks=${result.hooksAdded} agents=${result.agentsAdded} lsp=${result.lspAdded} inProcessHooks=${result.inProcessHooksAdded}`)
  }

  // Register LSP tools when at least one server is configured
  if (lspManager.list().length > 0) {
    tools.register(makeLspDiagnosticsTool(lspManager) as any)
    tools.register(makeLspDefinitionTool(lspManager) as any)
    tools.register(makeLspReferencesTool(lspManager) as any)
  }
  // Iter UUU — LSPQuery (navigation: definition/references/hover/documentSymbols).
  // Always registered so the schema is stable; when no server is configured
  // every action returns a friendly `notConfigured: true` payload.
  //
  // Phase P2 #12 — lazy via the `tools-extra.js` sidecar bundle. The
  // factory takes the local `LspManager` closure so the proxy must
  // re-bind on first call.
  tools.register(
    makeLazyTool(lspQueryToolMeta, async () => {
      const sidecar = await import('./core/tools/extra/loader').then(m => m.loadToolsExtraModule())
      return sidecar.makeLspQueryTool(lspManager) as unknown as import('./core/tools/types').Tool<unknown>
    }) as any,
  )

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

  // Iter MMM — load loose-file subagent definitions from
  // cwd/.nuka/subagents and home/.nuka/subagents. Each YAML/JSON file
  // becomes an `AgentDef`, resolves into a `ResolvedAgentDef`, and
  // registers under pluginName `project` (cwd-scoped) or `user`
  // (home-scoped) so the namespaced key matches Nuka's existing
  // `<pluginName>:<name>` convention. Missing dirs are a no-op;
  // per-file errors surface via console.warn but never block boot.
  {
    const subagentDirs = defaultSubagentDirs(cwd, os.homedir())
    for (let i = 0; i < subagentDirs.length; i++) {
      const dirPath = subagentDirs[i]!
      const pluginName = i === 0 ? 'project' : 'user'
      const { loaded, errors } = await loadSubagentsFromDir(dirPath)
      for (const err of errors) {
        console.warn(`[nuka:subagent] ${err.path}: ${err.message}`)
      }
      let registered = 0
      for (const sub of loaded) {
        try {
          const agentDef = subagentToAgentDef(sub)
          const resolved = await resolveAgentDef(agentDef, dirPath, pluginName)
          agents.register(resolved)
          registered++
        } catch (err) {
          console.warn(`[nuka:subagent] ${sub.sourcePath}: ${(err as Error).message}`)
        }
      }
      if (loaded.length > 0) {
        console.error(`[nuka:subagent] ${pluginName} dir ${dirPath} — loaded ${registered}/${loaded.length}`)
      }
    }
  }

  // Register the dispatch_agent tool after all plugins have wired their agents
  // (so the tool's description enumerates every <plugin>:<agent> pair).
  // Iter RRR: thread the hookRegistry through so sub-agents fire their own
  // lifecycle events under context: 'subagent'.
  tools.register(
    makeDispatchAgentTool({
      agents,
      registry: tools,
      providerResolver: providers,
      permission,
      hookRegistry,
      // P1 #6 — share the singleton so sub-agents inherit the parent's
      // active worktree (and EnterWorktree calls from inside a sub-agent
      // mutate the same store the main loop reads on the next turn).
      worktreeStore: getWorktreeStore(),
      // Output styles: same resolver the main loop uses, so a single
      // `NUKA_OUTPUT_STYLE` setting steers both contexts consistently.
      outputStyle: resolveActiveOutputStyleNow,
    }) as any,
  )
  tools.register(
    makeSpawnAgentTool({
      agents,
      registry: tools,
      providerResolver: providers,
      permission,
      taskManager,
      hookRegistry,
      worktreeStore: getWorktreeStore(),
      outputStyle: resolveActiveOutputStyleNow,
    }) as any,
  )
  tools.register(
    makeResumeAgentTool({
      taskManager,
      home,
      agents,
      registry: tools,
      providerResolver: providers,
      permission,
      hookRegistry,
      worktreeStore: getWorktreeStore(),
      outputStyle: resolveActiveOutputStyleNow,
    }) as any,
  )
  tools.register(
    makeSendAgentTool({
      taskManager,
      home,
      agents,
      registry: tools,
      providerResolver: providers,
      permission,
      hookRegistry,
      worktreeStore: getWorktreeStore(),
      outputStyle: resolveActiveOutputStyleNow,
    }) as any,
  )
  tools.register(
    makeSendInputTool({
      taskManager,
      home,
      agents,
      registry: tools,
      providerResolver: providers,
      permission,
      hookRegistry,
      worktreeStore: getWorktreeStore(),
      outputStyle: resolveActiveOutputStyleNow,
    }) as any,
  )

  // B5 — `coordinate_agents` is opt-in via NUKA_COORDINATOR=1 (Nuka env-opt-in
  // invariant). When enabled, the tool is registered alongside `dispatch_agent`
  // and runs on top of the same AgentRegistry / ToolRegistry / providers.
  if (process.env['NUKA_COORDINATOR'] === '1') {
    tools.register(
      makeCoordinateAgentsTool({
        agents,
        registry: tools,
        providerResolver: providers,
        permission,
      }) as unknown as ToolType,
    )
  }

  const nodeVersion = process.version
  const shell = process.env.SHELL ?? '/bin/sh'
  const platform = process.platform
  const gitBranch = currentGitBranch(cwd)

  process.on('SIGINT', () => {
    const lspCleanup = lspManager.closeAll().catch(() => {})
    // Phase 7 §5.2 — flush cost tracker on exit. Best-effort.
    const costFlush = writeCostFile(defaultCostPath(), costTracker.snapshot()).catch(() => {})
    // Practical Iter OOO — flush any pending recent-files write so the
    // freshest MRU state survives ^C. The helper coalesces writes
    // internally; flush awaits the in-flight one (if any). Best-effort.
    const recentFilesFlush =
      recentFilesPersistent !== null
        ? recentFilesPersistent.flush().catch(() => {})
        : Promise.resolve()
    // Phase 7 §5.3 — synth a memory entry from this session's transcript.
    // Hard-bounded by synth's 5s internal timeout; failures are swallowed.
    const memSynth = synthOnExit()
    // Practical Iter JJJ — fire sessionEnd alongside the other flush work.
    // The fire helper has its own 5s timeout so a slow handler can't stall
    // SIGINT cleanup; failures are absorbed inside fireSessionEnd itself.
    const endSession = sessions.active()
    const sessionEndFire = endSession
      ? fireSessionEnd(hookRegistry, { sessionId: endSession.id, reason: 'sigint' })
      : Promise.resolve([])
    // Iter GGGG — stop the cron tick so a fresh setInterval round doesn't
    // race the exit. Synchronous; safe before / after the async flushes.
    cronScheduler?.stop()
    Promise.all([lspCleanup, costFlush, recentFilesFlush, memSynth, sessionEndFire]).finally(() => {
      const flushMeta = metaWriter ? metaWriter.flush() : Promise.resolve()
      flushMeta.finally(() => process.exit(0))
    })
  })

  // Practical Iter OOO — final flush on the soft-exit path. `beforeExit`
  // fires when the event loop drains naturally (no SIGINT, just nothing
  // left to do). Mirrors the SIGINT branch but doesn't force-exit.
  if (recentFilesPersistent !== null) {
    const persistent = recentFilesPersistent
    process.on('beforeExit', () => {
      void persistent.flush().catch(() => {})
    })
  }

  // Iter GGGG — defensive belt-and-braces stop on graceful exit. The
  // scheduler's timer is `unref()`-ed so it shouldn't keep the event loop
  // alive on its own, but an explicit stop guarantees no in-flight tick
  // gets stranded once the rest of the system has drained.
  if (cronScheduler !== null) {
    const sched = cronScheduler
    process.on('beforeExit', () => sched.stop())
  }
  const activeSession = sessions.active()!
  let autoCompact: AutoCompactSessionAwareOpts | undefined
  if (hasProviders && activeSession.providerId) {
    autoCompact = {
      autoThreshold: config.compact?.autoThreshold ?? 0.8,
      contextWindow: config.compact?.contextWindow ?? 200_000,
    }
  }

  // Practical Iter NN — awaySummary end-to-end wiring. Composes
  // createAnthropicCallModel → createRunForkedAgent → adaptToAwaySummaryRunFork
  // → generateAwaySummary (with per-project session memory inlined). The
  // resulting runner is bound to the active session's provider; the
  // AwaySummary tool surfaces it to the agent so /loop wake-ups, harness
  // "user returned" hooks, or explicit recap requests can issue a recap
  // without coupling to a singleton model query.
  let idleHook: { poke: () => void; stop: () => void } | undefined
  if (hasProviders && activeSession.providerId) {
    const { provider: awayProvider } = providers.resolveFor(activeSession)
    const awayRunner = createAwaySummaryRunner({ provider: awayProvider, cwd })
    tools.register(makeAwaySummaryTool(awayRunner) as any)

    // Practical Iter RR — idleWatcher → awaySummary hook. The watcher
    // sits dormant until something pokes it from the input edge — Iter
    // MMMM wires PromptInput's keystroke/submit handler to `poke()`
    // via App's `idleHook` prop + `useIdlePoke` (see src/tui/hooks).
    // When a return-after-idle does fire, the hook snapshots the live
    // transcript and runs the recap; failures are swallowed so a flaky
    // model never crashes the idle loop. Output currently goes to
    // stderr — TUI banner integration is a separate iter.
    idleHook = startIdleAwaySummaryHook({
      runner: awayRunner,
      getMessages: () => sessions.active()?.messages ?? [],
    })
    const hookForExit = idleHook
    process.on('exit', () => hookForExit.stop())
  }

  // Phase 7 §5.3 — preload memory entries for this cwd. Refreshed on each
  // turn so newly synth'd entries appear without a CLI restart.
  let memoryCache: MemoryEntry[] = await loadMemory(cwd).catch(() => [])

  // 2026-05-18 — team memory tier (config.teamId opt-in). Best-effort
  // load; failures fall through to empty so missing/corrupt team files
  // don't block startup. Refreshed alongside `memoryCache` on each turn.
  let teamMemoryCache: MemoryEntry[] = config.teamId
    ? await loadTeamMemory(config.teamId, cwd).catch(() => [])
    : []

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
        teamMemory: config.teamId
          ? findRelevant(teamMemoryCache, tokenize(input.text), 5)
          : undefined,
        outputStyle: resolveActiveOutputStyleNow(),
      }),
      skills,
      persist: sessions.persist,
      autoCompact: autoCompact!,
      microCompact: microCompactOptionsFromConfig(config),
      hooks,
      hookRegistry,
      lsp: lspManager,
      costTracker,
      effort: config.effort,
      resolveEffort: (effort, model) => {
        const providerConfig = providers.getProviderConfig(session.providerId)
        return resolveEffortForModel(effort, providerConfig, model)
      },
      cronPromptQueue,
      // P1 #6 — same singleton the EnterWorktree tool mutates. The loop
      // reads `store.getActive()` on every tool call, so EnterWorktree's
      // side effect lands on the very next tool's `ctx.cwd`.
      worktreeStore: getWorktreeStore(),
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
      if (config.teamId) {
        teamMemoryCache = await loadTeamMemory(config.teamId, cwd).catch(
          () => teamMemoryCache,
        )
      }
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
      store={store}
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
        await compactSession(s, {
          provider,
          model,
          keepTurns: config.compact?.keepTurns ?? 3,
          retainedMessageBudget: config.compact?.retainedMessageBudget,
          postCompactMicroCompact: microCompactOptionsFromConfig(config),
        })
      }}
      cwd={cwd}
      gitBranch={gitBranch}
      version={MACRO_VERSION}
      tools={tools}
      sessionPluginCount={plugins.filter(p => p.source === 'session').length}
      costTracker={costTracker}
      taskManager={taskManager}
      hookRegistry={hookRegistry}
      todoStore={todoStore}
      loadedPlugins={plugins.map(p => ({ name: p.manifest.name, description: p.manifest.description }))}
      loadedSkills={skills.map(s => ({ name: s.name, description: s.description }))}
      updates={welcomeUpdates}
      recent={welcomeRecent}
      harness={harness}
      emergencyTip={getEmergencyTipFromConfig(config)}
      cronMissed={cronMissedNotice}
      planModeState={planModeState}
      idleHook={idleHook}
    />,
    { stdin: makeInkStdin() },
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
          const result = await wirePlugin(p, { tools, slash, skills, hooks, agents, hookRegistry, pluginConfig: config })
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
