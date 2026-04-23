// src/cli.tsx
import React from 'react'
import { render } from 'ink'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { App } from './tui/App'
import { loadConfig } from './core/config/load'
import { ProviderResolver } from './core/provider/resolver'
import { SessionManager } from './core/session/manager'
import { ToolRegistry } from './core/tools/registry'
import { PermissionCache } from './core/permission/cache'
import { PermissionChecker } from './core/permission/checker'
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
import { ReadTool } from './core/tools/read'
import { WriteTool } from './core/tools/write'
import { EditTool } from './core/tools/edit'
import { BashTool } from './core/tools/bash'
import { GlobTool } from './core/tools/glob'
import { GrepTool } from './core/tools/grep'
import { currentGitBranch } from './core/session/telemetry'
import { runAgent as runAgentLoop } from './core/agent/loop'
import { compactSession } from './core/compact/compact'
import { globalConfigPath } from './core/config/paths'
import { MACRO_VERSION } from './version'
import type { Session } from './core/session/types'
import type { PermissionCall, PermissionDecision } from './core/permission/types'

async function main(): Promise<void> {
  const cwd = process.cwd()
  const config = await loadConfig({ home: os.homedir(), cwd })

  if (config.providers.length === 0) {
    console.error(
      `No providers configured.\nAdd one to ${globalConfigPath()} — see docs/superpowers/specs/2026-04-23-nuka-rewrite-design.md §4.3`,
    )
    process.exit(2)
  }

  const providers = new ProviderResolver(config)
  const sessions = new SessionManager()
  const firstProvider = config.providers[0]!
  const activeProviderId = config.active.providerId || firstProvider.id
  const activeProvider = config.providers.find(p => p.id === activeProviderId)
  if (!activeProvider) {
    console.error(`active.providerId references unknown provider: ${activeProviderId}`)
    process.exit(2)
  }
  const activeModel = activeProvider!.selectedModel ?? activeProvider!.models?.[0] ?? ''
  sessions.start({ providerId: activeProvider!.id, model: activeModel })

  const tools = new ToolRegistry()
  ;[ReadTool, WriteTool, EditTool, BashTool, GlobTool, GrepTool].forEach(t => tools.register(t as any))

  // askUser is populated by App via a side channel; wire a promise-based bridge:
  type PermQ = {
    resolve: (d: PermissionDecision) => void
    payload: { call: PermissionCall; suggestedPattern?: string }
  }
  const pendingPerm: { current: PermQ | null } = { current: null }
  const askUser = (call: PermissionCall) =>
    new Promise<PermissionDecision>((resolve) => {
      pendingPerm.current = { resolve, payload: { call, suggestedPattern: suggestPattern(call) } }
      // Trigger App rerender by setting window global — replaced with a proper event bus on follow-up iteration.
      ;(globalThis as any).__NUKA_PERM__?.(pendingPerm.current.payload, resolve)
    })

  const permission = new PermissionChecker(new PermissionCache(), askUser)

  const slash = new SlashRegistry()
  ;[ExitCommand, HelpCommand, ClearCommand, NewCommand, BranchCommand, BtwCommand, CostCommand, ModelCommand, ConfigCommand, CompactCommand].forEach(c => slash.register(c))

  const nodeVersion = process.version
  const shell = process.env.SHELL ?? '/bin/sh'
  const platform = process.platform
  const gitBranch = currentGitBranch(cwd)

  const runAgent = (input: { text: string }, session: Session, signal: AbortSignal) =>
    runAgentLoop(input, session, {
      provider: providers,
      tools,
      permission,
      systemPromptInput: () => ({
        cwd, platform, shell, nodeVersion, gitBranch,
      }),
    }, signal)

  render(
    <App
      sessions={sessions}
      slash={slash}
      providers={providers}
      config={config}
      runAgent={runAgent}
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
    />,
  )
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
