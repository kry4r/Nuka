// src/tui/App.tsx
import React, { useCallback, useEffect, useState } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import { Welcome } from './Welcome/Welcome'
import { Messages } from './Messages/Messages'
import { PromptInput } from './PromptInput/PromptInput'
import { StatusBar } from './StatusBar/StatusBar'
import { PermissionDialog } from './dialogs/PermissionDialog'
import { ModelPicker } from './dialogs/ModelPicker'
import { ConfigEditor } from './dialogs/ConfigEditor'
import { SessionPicker } from './dialogs/SessionPicker'
import type { SessionMeta } from '../core/session/store'
import { pickTip } from './Welcome/tips'
import type { SessionManager } from '../core/session/manager'
import type { ProviderResolver } from '../core/provider/resolver'
import type { Config } from '../core/config/schema'
import type { AgentEvent } from '../core/agent/events'
import type { SlashRegistry } from '../slash/registry'
import type { Session } from '../core/session/types'
import type { PermissionCall, PermissionDecision } from '../core/permission/types'
import type { PermissionBridge } from '../core/permission/bridge'
import { computeCost } from '../core/session/telemetry'
import { useAgentStream } from './hooks/useAgentStream'

type Dialog =
  | {
      kind: 'permission'
      call: PermissionCall
      suggestedPattern?: string
      resolve: (d: PermissionDecision) => void
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
}

export function App(props: AppProps): React.JSX.Element {
  const { exit } = useApp()
  const [session, setSession] = useState<Session>(() => props.sessions.active()!)
  const [input, setInput] = useState('')
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [tip] = useState(() => pickTip(props.config.welcome?.tips))
  const [primedQuit, setPrimedQuit] = useState(false)

  useEffect(() => {
    props.permissionBridge.setHandler((payload, resolve) => {
      setDialog({ kind: 'permission', call: payload.call, suggestedPattern: payload.suggestedPattern, resolve })
    })
    return () => {
      props.permissionBridge.setHandler(null)
    }
  }, [props.permissionBridge])

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
    if (stream.running) {
      session.queue.push(raw) // /btw semantics: pressing enter while running queues
      return
    }
    await stream.send(raw)
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
  const contextUsed = session.totalUsage.inputTokens + session.totalUsage.outputTokens
  const contextMax = 200_000
  const pc = props.providers.getProviderConfig(session.providerId)
  const cost = pc ? computeCost(pc, session.model, session.totalUsage) : 0
  const hintMode: 'idle' | 'running' | 'awaiting-user' | 'primed-quit' =
    dialog ? 'awaiting-user' : stream.running ? 'running' : primedQuit ? 'primed-quit' : 'idle'

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" flexGrow={1}>
        {session.messages.length === 0
          ? <Welcome
              cwd={props.cwd}
              gitBranch={props.gitBranch}
              model={session.model}
              version={props.version}
              tip={tip}
            />
          : <Messages items={session.messages} streaming={streamingMsg} />}
      </Box>

      {dialog?.kind === 'permission' && (
        <PermissionDialog
          call={dialog.call}
          suggestedPattern={dialog.suggestedPattern}
          onDecide={d => { dialog.resolve(d); setDialog(null) }}
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
      />
      <StatusBar
        model={session.model}
        cwd={props.cwd}
        gitBranch={props.gitBranch}
        contextUsed={contextUsed}
        contextMax={contextMax}
        cost={cost}
        mcpCount={0}
        autoMode="off"
        queueLength={session.queue.size()}
        mode={hintMode}
      />
    </Box>
  )
}
