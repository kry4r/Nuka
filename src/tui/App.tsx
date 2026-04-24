// src/tui/App.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Welcome } from './Welcome/Welcome'
import { Messages } from './Messages/Messages'
import { PromptInput } from './PromptInput/PromptInput'
import { StatusBar } from './StatusBar/StatusBar'
import { PermissionDialog } from './dialogs/PermissionDialog'
import { ElicitationDialog } from './dialogs/ElicitationDialog'
import { PluginConfigDialog } from './dialogs/PluginConfigDialog'
import { ModelPicker } from './dialogs/ModelPicker'
import { ConfigEditor } from './dialogs/ConfigEditor'
import { SessionPicker } from './dialogs/SessionPicker'
import type { ElicitationPayload, ElicitationResult } from '../core/mcp/elicitation'
import type { SessionMeta } from '../core/session/store'
import type { LoadedPlugin, PluginUserConfigField } from '../core/plugin/manifest'
import { pickTip } from './Welcome/tips'
import type { SessionManager } from '../core/session/manager'
import type { ProviderResolver } from '../core/provider/resolver'
import type { Config } from '../core/config/schema'
import type { AgentEvent } from '../core/agent/events'
import type { SlashRegistry } from '../slash/registry'
import type { Session } from '../core/session/types'
import type { PermissionCall, PermissionDecision } from '../core/permission/types'
import type { PermissionBridge } from '../core/permission/bridge'
import type { McpManager } from '../core/mcp/manager'
import type { ToolRegistry } from '../core/tools/registry'
import { computeCost } from '../core/session/telemetry'
import { useAgentStream } from './hooks/useAgentStream'
import { runBangShell } from './bangShell'
import { makeUserMessage } from '../core/message/factories'

type Dialog =
  | {
      kind: 'permission'
      call: PermissionCall
      suggestedPattern?: string
      annotationBadges?: import('../core/permission/bridge').AnnotationBadge[]
      resolve: (d: PermissionDecision) => void
    }
  | {
      kind: 'elicitation'
      payload: ElicitationPayload
      resolve: (r: ElicitationResult) => void
    }
  | {
      kind: 'plugin-config'
      plugin: LoadedPlugin
      fields: PluginUserConfigField[]
      resolve: (result: Record<string, unknown> | null) => void
    }
  | { kind: 'model-picker' }
  | { kind: 'config-editor' }
  | { kind: 'session-picker'; metas: SessionMeta[] | 'loading' }

export type AppProps = {
  sessions: SessionManager
  slash: SlashRegistry
  providers: ProviderResolver
  config: Config
  runAgent: (input: { text: string }, session: Session, signal: AbortSignal) => AsyncIterable<AgentEvent>
  permissionBridge: PermissionBridge
  onExit: () => void
  onOpenEditor: () => void
  compactSession: (s: Session) => Promise<void>
  cwd: string
  gitBranch: { branch: string; dirty: boolean } | null
  version: string
  mcpManager?: McpManager
  tools?: ToolRegistry
  /** Number of session plugins loaded via --plugin-dir (shown in status bar) */
  sessionPluginCount?: number
}

export function App(props: AppProps): React.JSX.Element {
  const { exit } = useApp()
  const [session, setSession] = useState<Session>(() => props.sessions.active()!)
  const [input, setInput] = useState('')
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [tip] = useState(() => pickTip(props.config.welcome?.tips))
  const [primedQuit, setPrimedQuit] = useState(false)
  const [mcpTick, setMcpTick] = useState(0)
  const pendingAttachments = useRef<string[]>([])

  useEffect(() => {
    props.permissionBridge.setHandler((payload, resolve) => {
      setDialog({ kind: 'permission', call: payload.call, suggestedPattern: payload.suggestedPattern, annotationBadges: payload.annotationBadges, resolve })
    })
    props.permissionBridge.setElicitationHandler((payload, resolve) => {
      setDialog({ kind: 'elicitation', payload, resolve })
    })
    props.permissionBridge.setPluginConfigHandler((payload, resolve) => {
      setDialog({ kind: 'plugin-config', plugin: payload.plugin, fields: payload.fields, resolve })
    })
    return () => {
      props.permissionBridge.setHandler(null)
      props.permissionBridge.setElicitationHandler(null)
      props.permissionBridge.setPluginConfigHandler(null)
    }
  }, [props.permissionBridge])

  useEffect(() => {
    if (!props.mcpManager) return
    return props.mcpManager.onChange(() => setMcpTick(t => t + 1))
  }, [props.mcpManager])

  const runner = (i: { text: string }, signal: AbortSignal): AsyncIterable<AgentEvent> =>
    props.runAgent(i, session, signal)
  const stream = useAgentStream({ runAgent: runner })

  const handleSlashEffect = useCallback(async (effect: { kind: string }) => {
    if (effect.kind === 'clear-screen') {
      stream.reset()
    } else if (effect.kind === 'new-session') {
      const next = props.sessions.new()
      next.providerId = session.providerId
      next.model = session.model
      setSession(next)
      stream.reset()
    } else if (effect.kind === 'branch-session') {
      const next = props.sessions.branch()
      setSession(next)
      stream.reset()
    } else if (effect.kind === 'compact') {
      await props.compactSession(session)
    }
  }, [session, props, stream])

  const handleSubmit = useCallback(async (raw: string) => {
    setInput('')
    if (raw.startsWith('/')) {
      const parsed = (await import('../slash/registry')).SlashRegistry.parse(raw)
      if (!parsed) return
      const cmd = props.slash.find(parsed.name)
      if (!cmd) return
      const res = await cmd.run(parsed.args, {
        sessions: props.sessions,
        providers: props.providers,
        config: props.config,
      })
      if (res.type === 'exit') { props.onExit(); exit() }
      else if (res.type === 'dialog') {
        if (res.dialog.kind === 'session-picker') {
          setDialog({ kind: 'session-picker', metas: 'loading' })
          const metas = await props.sessions.listPersisted()
          setDialog({ kind: 'session-picker', metas })
        } else {
          setDialog(res.dialog as Dialog)
        }
      }
      else if (res.type === 'effect') await handleSlashEffect(res.effect)
      return
    }

    // !cmd — run shell command, append output as user message, skip agent loop
    if (raw.startsWith('!')) {
      const cmd = raw.slice(1).trim()
      const output = await runBangShell(cmd, props.cwd)
      const text = `[!cmd $ ${cmd}]\n${output}`
      session.messages.push(makeUserMessage({ text }))
      return
    }

    // Resolve @mention attachments
    const attachPaths = pendingAttachments.current.splice(0)
    let text = raw
    if (attachPaths.length > 0) {
      const blocks: string[] = []
      for (const relPath of attachPaths) {
        const abs = path.resolve(props.cwd, relPath)
        let content = ''
        try { content = await readFile(abs, 'utf8') } catch { content = '(unreadable)' }
        blocks.push(`[file: ${relPath}]\n${content}`)
      }
      text = blocks.join('\n\n') + '\n\n' + raw
    }

    if (stream.running) {
      session.queue.push(text) // /btw semantics: pressing enter while running queues
      return
    }
    await stream.send(text)
  }, [props, session, stream, handleSlashEffect, exit])

  useEffect(() => {
    if (!primedQuit) return
    const id = setTimeout(() => setPrimedQuit(false), 2000)
    return () => clearTimeout(id)
  }, [primedQuit])

  useInput((_input, key) => {
    if (key.escape) {
      if (stream.running) { stream.cancel(); return }
      if (primedQuit) { props.onExit(); exit() }
      else { setPrimedQuit(true) }
    }
  })

  const streamingMsg = null // Phase 1 renders via messages[]; streaming text is appended via runAgent pushing to session.messages
  const justCompacted = stream.events.some(e => e.type === 'auto_compacted')
  const contextUsed = session.totalUsage.inputTokens + session.totalUsage.outputTokens
  const contextMax = props.config.compact?.contextWindow ?? 200_000
  const pc = props.providers.getProviderConfig(session.providerId)
  const cost = pc ? computeCost(pc, session.model, session.totalUsage) : 0
  const hintMode: 'idle' | 'running' | 'awaiting-user' | 'primed-quit' =
    dialog ? 'awaiting-user' : stream.running ? 'running' : primedQuit ? 'primed-quit' : 'idle'

  void mcpTick // consumed to trigger re-render on MCP status changes
  const mcpStatuses = props.mcpManager?.status() ?? []
  const mcpCount = mcpStatuses.filter(s => s.status.kind === 'connected').length
  const mcpHealth: 'ok' | 'degraded' | 'none' =
    mcpStatuses.length === 0 ? 'none'
    : mcpStatuses.every(s => s.status.kind === 'connected') ? 'ok'
    : 'degraded'

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" flexGrow={1}>
        {justCompacted && (
          <Text color="gray" dimColor>✻ context compacted — older turns summarized</Text>
        )}
        {session.messages.length === 0
          ? <Welcome
              cwd={props.cwd}
              gitBranch={props.gitBranch}
              model={session.model}
              version={props.version}
              tip={tip}
            />
          : <Messages
              items={session.messages}
              streaming={streamingMsg}
              resolveToolSource={props.tools ? (n) => props.tools!.find(n)?.source : undefined}
              resolveToolAnnotations={props.tools ? (n) => props.tools!.find(n)?.annotations : undefined}
            />}
      </Box>

      {dialog?.kind === 'permission' && (
        <PermissionDialog
          call={dialog.call}
          suggestedPattern={dialog.suggestedPattern}
          annotationBadges={dialog.annotationBadges}
          onDecide={d => { dialog.resolve(d); setDialog(null) }}
        />
      )}
      {dialog?.kind === 'elicitation' && (
        <ElicitationDialog
          payload={dialog.payload}
          onResolve={r => { dialog.resolve(r); setDialog(null) }}
        />
      )}
      {dialog?.kind === 'plugin-config' && (
        <PluginConfigDialog
          plugin={dialog.plugin}
          fields={dialog.fields}
          onSubmit={values => { dialog.resolve(values); setDialog(null) }}
          onCancel={() => { dialog.resolve(null); setDialog(null) }}
        />
      )}
      {dialog?.kind === 'model-picker' && (
        <ModelPicker
          providers={props.providers.listProviders()}
          onSelect={(providerId, model) => {
            session.providerId = providerId
            session.model = model
            setDialog(null)
          }}
          onAddProvider={() => { /* Phase 1: no-op stub; wizard lives in a follow-up */ setDialog(null) }}
          onRefresh={async (providerId) => props.providers.fetchRemoteModels(providerId)}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'config-editor' && (
        <ConfigEditor
          configPath={`${process.env.HOME ?? ''}/.nuka/config.yaml`}
          preview={JSON.stringify(props.config, null, 2)}
          onOpen={() => { props.onOpenEditor(); setDialog(null) }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'session-picker' && dialog.metas === 'loading' && (
        <Box borderStyle="round" borderColor="cyan" paddingX={1}>
          <Text color="cyan">Loading sessions…</Text>
        </Box>
      )}
      {dialog?.kind === 'session-picker' && dialog.metas !== 'loading' && (
        <SessionPicker
          sessions={dialog.metas}
          onSelect={async (id) => {
            setDialog(null)
            const resumed = await props.sessions.resume(id)
            setSession(resumed)
            stream.reset()
          }}
          onCancel={() => setDialog(null)}
        />
      )}

      <PromptInput
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        disabled={!!dialog}
        placeholder=""
        cwd={props.cwd}
        onAttachFile={p => { pendingAttachments.current.push(p) }}
      />
      <StatusBar
        model={session.model}
        cwd={props.cwd}
        gitBranch={props.gitBranch}
        contextUsed={contextUsed}
        contextMax={contextMax}
        cost={cost}
        mcpCount={mcpCount}
        mcpHealth={mcpHealth}
        autoMode="off"
        queueLength={session.queue.size()}
        mode={hintMode}
        sessionPluginCount={props.sessionPluginCount}
      />
    </Box>
  )
}
