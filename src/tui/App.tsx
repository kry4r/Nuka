// src/tui/App.tsx
import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Welcome } from './Welcome/Welcome'
import { Messages } from './Messages/Messages'
import { Conversation } from './Conversation/Conversation'
import { PromptInput } from './PromptInput/PromptInput'
import { StatusPanel } from './Status/StatusPanel'
import { SubmenuFrame } from './Submenu/SubmenuFrame'
import { PermissionDialog } from './dialogs/PermissionDialog'
import { PluginConfigDialog } from './dialogs/PluginConfigDialog'
import { ModelPicker } from './dialogs/ModelPicker'
import { ConfigSubmenu } from './Submenu/config/ConfigSubmenu'
import { saveConfigPatch } from '../core/config/save'
import { SessionPicker } from './dialogs/SessionPicker'
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
import { ThemeProvider } from '../core/theme/context'
import { resolveTheme } from '../core/theme/themes'
import { StatsView } from './Stats/StatsView'
import { DoctorReport } from './Doctor/DoctorReport'
import { MessageSelector } from './Rewind/MessageSelector'
import { Wizard } from './Onboarding/Wizard'
import { saveWizardPatch } from '../core/onboarding/save'
import os from 'node:os'
import { SlashCard } from './SlashCard/SlashCard'
import type { PermissionBridge } from '../core/permission/bridge'
import type { ToolRegistry } from '../core/tools/registry'
import type { TaskManager } from '../core/tasks/manager'
import { computeCost } from '../core/session/telemetry'
import { useAgentStream } from './hooks/useAgentStream'
import { runBangShell } from './bangShell'
import { makeUserMessage } from '../core/message/factories'
import { DISPATCH_AGENT_TOOL_NAME } from '../core/agents/dispatchTool'
import type { TodoState } from '../core/tools/todoWrite'
import { TasksPanel, flattenedTasksLength } from './Tasks/TasksPanel'
import { TasksSubmenu } from './Submenu/TasksSubmenu'
import { findInFlightSubagents } from './Tasks/SubagentList'

/**
 * Scan messages (newest first) for the last assistant `dispatch_agent`
 * tool_use call id. Returns undefined if no such call exists.
 * Exported for tests.
 */
export function findLatestDispatchAgentCallId(messages: readonly import('../core/message/types').Message[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m || m.role !== 'assistant') continue
    for (let j = m.content.length - 1; j >= 0; j--) {
      const b = m.content[j]
      if (b && b.type === 'tool_use' && b.name === DISPATCH_AGENT_TOOL_NAME) {
        return b.id
      }
    }
  }
  return undefined
}

/**
 * Phase 12 §4.2 — submenu descriptors. Tagged union covering every overlay
 * UI: full submenus take over the lower three zones (Tasks/Prompt/Status);
 * inline submenus replace only the Prompt slot so the user keeps live
 * Tasks/Status context while making the decision.
 */
export type SubmenuDescriptor =
  // full submenus — take over Tasks/Prompt/Status slots
  | { kind: 'config' }
  | { kind: 'model-picker' }
  | { kind: 'session-picker'; metas: SessionMeta[] | 'loading' }
  | { kind: 'onboarding-wizard' }
  | { kind: 'stats' }
  | { kind: 'doctor'; report: import('../core/doctor/run').DoctorReport }
  | { kind: 'message-selector'; messages: import('../core/message/types').AssistantMessage[] }
  // inline submenus — take over only Prompt slot
  | {
      kind: 'permission'
      call: PermissionCall
      suggestedPattern?: string
      annotationBadges?: import('../core/permission/bridge').AnnotationBadge[]
      resolve: (d: PermissionDecision) => void
    }
  | {
      kind: 'plugin-config'
      plugin: LoadedPlugin
      fields: PluginUserConfigField[]
      resolve: (result: Record<string, unknown> | null) => void
    }
  // Phase 13 M4 — tasks focus mode submenu (full)
  | { kind: 'tasks'; focusItem: number }

const INLINE_SUBMENU_KINDS = new Set<SubmenuDescriptor['kind']>([
  'permission',
  'plugin-config',
])

export function isInlineSubmenu(s: SubmenuDescriptor): boolean {
  return INLINE_SUBMENU_KINDS.has(s.kind)
}

/**
 * Phase 12 §4.2 — single UIState discriminated union. Replaces the
 * earlier scattered dialog + slash-active flags. Esc always returns
 * to `{kind:'normal'}` from any non-normal state.
 */
export type UIState =
  | { kind: 'normal' }
  | { kind: 'tasks-collapsed' }
  | { kind: 'slash'; mode: 'list' | 'arg-hint' }
  | { kind: 'submenu'; submenu: SubmenuDescriptor }
  // Phase 13 M4 — Tasks panel focus mode with cursor
  | { kind: 'tasks-focused'; cursor: number }

export type UIAction =
  | { type: 'reset' }
  | { type: 'open-submenu'; submenu: SubmenuDescriptor }
  | { type: 'update-submenu'; submenu: SubmenuDescriptor }
  | { type: 'slash-set'; active: boolean }
  | { type: 'tasks-toggle' }
  // Phase 13 M4 actions
  | { type: 'tasks-focus-enter' }
  | { type: 'tasks-focus-cursor'; delta: -1 | 1; total: number }
  | { type: 'tasks-focus-open' }

export function uiReducer(state: UIState, action: UIAction): UIState {
  // Phase 13 M2.5 — every branch must return the same state reference when
  // no logical transition occurs, otherwise useReducer can't bail out and
  // any inline-arrow callback feeding it triggers an infinite render loop.
  switch (action.type) {
    case 'reset':
      if (state.kind === 'normal') return state
      return { kind: 'normal' }
    case 'open-submenu':
      return { kind: 'submenu', submenu: action.submenu }
    case 'update-submenu':
      // Only updates the descriptor when already in a submenu state
      // (e.g. session-picker `loading` -> resolved metas).
      if (state.kind !== 'submenu') return state
      return { kind: 'submenu', submenu: action.submenu }
    case 'slash-set':
      if (action.active) {
        // Already in slash — no transition.
        if (state.kind === 'slash') return state
        if (state.kind === 'normal') return { kind: 'slash', mode: 'list' }
        // submenu / tasks-collapsed — don't preempt.
        return state
      }
      if (state.kind === 'slash') return { kind: 'normal' }
      return state
    case 'tasks-toggle':
      if (state.kind === 'normal') return { kind: 'tasks-collapsed' }
      if (state.kind === 'tasks-collapsed') return { kind: 'normal' }
      return state
    case 'tasks-focus-enter':
      // Only transition from normal → tasks-focused. Idempotent: no-op otherwise.
      if (state.kind !== 'normal') return state
      return { kind: 'tasks-focused', cursor: 0 }
    case 'tasks-focus-cursor': {
      // Only meaningful in tasks-focused state.
      if (state.kind !== 'tasks-focused') return state
      const next = Math.max(0, Math.min(action.total - 1, state.cursor + action.delta))
      // Idempotent: return same ref if cursor doesn't change.
      if (next === state.cursor) return state
      return { kind: 'tasks-focused', cursor: next }
    }
    case 'tasks-focus-open':
      // Only meaningful in tasks-focused state.
      if (state.kind !== 'tasks-focused') return state
      return { kind: 'submenu', submenu: { kind: 'tasks', focusItem: state.cursor } }
    default:
      return state
  }
}

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
  tools?: ToolRegistry
  /** Number of session plugins loaded via --plugin-dir (shown in status bar) */
  sessionPluginCount?: number
  /** Phase 7 §5.2 cost tracker — surfaced through SlashContext for /cost and HUD. */
  costTracker?: import('../core/cost/tracker').CostTracker
  /** Number of plugins loaded total (for HUD). */
  pluginCount?: number
  /** Number of agents currently in flight (for HUD). */
  agentInFlight?: number
  /** Phase 10 §4.3 — singleton task manager surfaced via SlashContext + HUD. */
  taskManager?: TaskManager
  /** Phase 12 M3 — todo store from createTodoStore(); mutated in-place by TodoWrite tool. */
  todoStore?: TodoState
  /** Phase 12 M4 — read-only list of loaded plugins for ConfigSubmenu PluginsForm. */
  loadedPlugins?: { name: string; description?: string }[]
  /** Phase 12 M4 — read-only list of loaded skills for ConfigSubmenu SkillsForm. */
  loadedSkills?: { name: string; description?: string }[]
  /** Phase 13 M2 — updates from ~/.nuka/updates.json */
  updates?: import('../core/updates/load').UpdateEntry[]
  /** Phase 13 M2 — recent sessions from ~/.nuka/sessions/ */
  recent?: import('../core/session/recent').RecentEntry[]
}

export function App(props: AppProps): React.JSX.Element {
  const { exit } = useApp()
  const [session, setSession] = useState<Session>(() => props.sessions.active()!)
  const [input, setInput] = useState('')
  // Phase 12 §4.2 — single discriminated UIState replaces the prior
  // dialog + slash-active flags.
  const [uiState, dispatchUI] = useReducer(uiReducer, { kind: 'normal' } as UIState)
  // Phase 13 M2.5 — stable callback so PromptInput's useEffect doesn't refire
  // on every parent render (inline arrow had a new identity each pass).
  const handleSlashActiveChange = useCallback((active: boolean) => {
    dispatchUI({ type: 'slash-set', active })
  }, [])
  const [tip] = useState(() => pickTip(props.config.welcome?.tips))
  const [primedQuit, setPrimedQuit] = useState(false)
  // Bumped whenever we mutate session.messages directly so React re-renders.
  const [, setMessageTick] = useState(0)
  // Phase 12 M3 — tick drives re-renders of TasksPanel whose data sources
  // (todoStore, taskManager) mutate in place. Bumped on agent events and
  // on TaskManager state changes.
  const [tasksTick, setTasksTick] = useState(0)
  const bumpTasksTick = useCallback(() => setTasksTick(t => t + 1), [])
  const bumpMessages = useCallback(() => {
    setMessageTick(t => t + 1)
    // Also refresh tasks panel so in-flight subagent list stays current.
    setTasksTick(t => t + 1)
  }, [])

  // Subscribe to TaskManager changes to keep Tasks panel reactive.
  useEffect(() => {
    if (!props.taskManager) return
    return props.taskManager.on('change', bumpTasksTick)
  }, [props.taskManager, bumpTasksTick])

  // Phase 12 M5 — SlashCard cursor (driven by PromptInput keystrokes).
  const [slashCursor, setSlashCursor] = useState(0)
  const pendingAttachments = useRef<string[]>([])

  useEffect(() => {
    props.permissionBridge.setHandler((payload, resolve) => {
      dispatchUI({
        type: 'open-submenu',
        submenu: {
          kind: 'permission',
          call: payload.call,
          suggestedPattern: payload.suggestedPattern,
          annotationBadges: payload.annotationBadges,
          resolve,
        },
      })
    })
    props.permissionBridge.setPluginConfigHandler((payload, resolve) => {
      dispatchUI({
        type: 'open-submenu',
        submenu: {
          kind: 'plugin-config',
          plugin: payload.plugin,
          fields: payload.fields,
          resolve,
        },
      })
    })
    return () => {
      props.permissionBridge.setHandler(null)
      props.permissionBridge.setPluginConfigHandler(null)
    }
  }, [props.permissionBridge])

  // Resets UIState back to normal — used by every dialog onCancel/onClose.
  const closeSubmenu = useCallback(() => dispatchUI({ type: 'reset' }), [])

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
        costTracker: props.costTracker,
        taskManager: props.taskManager,
      })
      if (res.type === 'exit') { props.onExit(); exit() }
      else if (res.type === 'dialog') {
        if (res.dialog.kind === 'session-picker') {
          dispatchUI({
            type: 'open-submenu',
            submenu: { kind: 'session-picker', metas: 'loading' },
          })
          const metas = await props.sessions.listPersisted()
          dispatchUI({
            type: 'update-submenu',
            submenu: { kind: 'session-picker', metas },
          })
        } else {
          dispatchUI({
            type: 'open-submenu',
            submenu: res.dialog as SubmenuDescriptor,
          })
        }
      }
      else if (res.type === 'effect') await handleSlashEffect(res.effect)
      else if (res.type === 'text') {
        // Render the slash output as an inline assistant-styled message so
        // the user can see what /status-bar, /vim, /tasks, etc. returned.
        session.messages.push({
          role: 'assistant',
          content: [{ type: 'text', text: `[/${parsed.name}]\n${res.text}` }],
          id: `slash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          ts: Date.now(),
        })
        bumpMessages()
      }
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

  const [expandedAgentCallIds, setExpandedAgentCallIds] = useState<Set<string>>(() => new Set())

  useInput((inputKey, key) => {
    if (key.escape) {
      // Phase 12 §4.2 — Esc always returns to normal from any non-normal
      // UIState. Inline submenus (permission/plugin-config) own their own
      // Esc handler which resolves the pending decision; we don't preempt
      // those here. Stream-running cancel still wins over UIState reset.
      if (stream.running) { stream.cancel(); return }
      if (uiState.kind === 'submenu' && isInlineSubmenu(uiState.submenu)) {
        // Let the inline dialog's own useInput run.
        return
      }
      if (uiState.kind !== 'normal') {
        dispatchUI({ type: 'reset' })
        return
      }
      if (primedQuit) { props.onExit(); exit() }
      else { setPrimedQuit(true) }
      return
    }
    // Phase 13 M4 — Tab enters Tasks focus mode when Tasks panel is non-empty;
    // also exits focus mode when already focused.
    if (key.tab) {
      if (uiState.kind === 'tasks-focused') {
        dispatchUI({ type: 'reset' })
        return
      }
      if (uiState.kind === 'normal') {
        // Only enter if Tasks panel has items to navigate.
        const total = flattenedTasksLength({
          todoStore: props.todoStore,
          messages: session.messages,
          tasks: props.taskManager ? props.taskManager.list() : [],
        })
        if (total > 0) {
          dispatchUI({ type: 'tasks-focus-enter' })
          return
        }
      }
      return
    }
    // Phase 13 M4 — Tasks focus mode key handling.
    if (uiState.kind === 'tasks-focused') {
      const total = flattenedTasksLength({
        todoStore: props.todoStore,
        messages: session.messages,
        tasks: props.taskManager ? props.taskManager.list() : [],
      })
      if (inputKey === 'j' || key.downArrow) {
        dispatchUI({ type: 'tasks-focus-cursor', delta: 1, total })
        return
      }
      if (inputKey === 'k' || key.upArrow) {
        dispatchUI({ type: 'tasks-focus-cursor', delta: -1, total })
        return
      }
      if (key.return) {
        dispatchUI({ type: 'tasks-focus-open' })
        return
      }
      return
    }
    // Phase 12 §4.2 — Ctrl+T toggles the Tasks panel between expanded
    // and the collapsed summary row. The actual Tasks panel ships in M3;
    // M2 just wires the state transition so harness tests can assert it.
    if (key.ctrl && inputKey === 't') {
      dispatchUI({ type: 'tasks-toggle' })
      return
    }
    // Ctrl+A: toggle expansion of the most-recent dispatch_agent call.
    if (key.ctrl && inputKey === 'a') {
      const latestId = findLatestDispatchAgentCallId(session.messages)
      if (latestId) {
        setExpandedAgentCallIds(prev => {
          const next = new Set(prev)
          if (next.has(latestId)) next.delete(latestId)
          else next.add(latestId)
          return next
        })
      }
    }
  })

  const streamingMsg = null // Phase 1 renders via messages[]; streaming text is appended via runAgent pushing to session.messages
  const justCompacted = stream.events.some(e => e.type === 'auto_compacted')
  const contextUsed = session.totalUsage.inputTokens + session.totalUsage.outputTokens
  const contextMax = props.config.compact?.contextWindow ?? 200_000
  const pc = props.providers.getProviderConfig(session.providerId)
  const cost = pc ? computeCost(pc, session.model, session.totalUsage) : 0
  const hintMode: 'idle' | 'running' | 'awaiting-user' | 'primed-quit' =
    uiState.kind === 'submenu' ? 'awaiting-user'
      : stream.running ? 'running'
      : primedQuit ? 'primed-quit'
      : 'idle'

  const activeTheme = resolveTheme((props.config.theme as any)?.name ?? 'default-dark')

  // Phase 12 §4.3 — derive zone visibility from UIState.
  const inSubmenu = uiState.kind === 'submenu'
  const submenu = inSubmenu ? uiState.submenu : null
  const submenuInline = submenu ? isInlineSubmenu(submenu) : false
  const submenuFull = inSubmenu && !submenuInline
  const slashActive = uiState.kind === 'slash'
  const tasksCollapsed = uiState.kind === 'tasks-collapsed'

  // Tasks panel is hidden during slash/full-submenu and (for now) while
  // empty — Phase 12 M3 plumbs real Plan/Subagent/Background data; until
  // then the expanded panel is intentionally a stub-only frame that
  // collapses on Ctrl+T. Inline submenu keeps Tasks visible per §4.3.
  const tasksVisible = !slashActive && !submenuFull
  // Per spec §4.3 the Prompt stays shown (raised) during slash; the
  // SlashSuggest dropdown still lives inside PromptInput in M2 (replaced
  // by SlashCard in M5). Inline submenus replace the Prompt; full
  // submenus take the whole lower stack.
  const promptVisible = !submenuFull && !submenuInline
  // Status zone is hidden by the slash card (M5 will move SlashCard into
  // the Status slot) and by full submenus.
  const statusVisible = !submenuFull && !slashActive
  // Welcome stays OUTSIDE the Conversation frame when there are no
  // messages — keeps the centered avocado logo at full canvas (§4.4 note).
  const showWelcomeRaw = session.messages.length === 0
  // Phase 12 §4.9 — focus-ring rule: only the frame currently owning
  // keyboard focus renders its border with `primary`; every other frame
  // uses `fgMuted`. The Conversation frame is never the keyboard target
  // in Phase 12 (Tasks focus mode is deferred to Phase 13), so it is
  // always unfocused. Prompt is the focus owner in normal/tasks-collapsed
  // states; SlashCard takes focus in slash state; submenus own focus
  // when a submenu is open. Phase 13 M4 — Tasks panel owns focus in
  // tasks-focused state.
  const promptFocused = uiState.kind === 'normal' || uiState.kind === 'tasks-collapsed'
  const tasksFocused = uiState.kind === 'tasks-focused'
  const tasksCursor = uiState.kind === 'tasks-focused' ? uiState.cursor : undefined

  return (
    <ThemeProvider theme={activeTheme}>
    <Box flexDirection="column">
      {/* Conversation zone */}
      <Box flexDirection="column" flexGrow={1}>
        {justCompacted && (
          <Text color="gray" dimColor>✻ context compacted — older turns summarized</Text>
        )}
        {showWelcomeRaw ? (
          <Welcome
            cwd={props.cwd}
            gitBranch={props.gitBranch}
            model={session.model}
            version={props.version}
            tip={tip}
            updates={props.updates}
            recent={props.recent}
          />
        ) : (
          <Conversation focused={false}>
            <Messages
              items={session.messages}
              streaming={streamingMsg}
              expandedAgentCallIds={expandedAgentCallIds}
              resolveToolSource={props.tools ? (n) => props.tools!.find(n)?.source : undefined}
              resolveToolAnnotations={props.tools ? (n) => props.tools!.find(n)?.annotations : undefined}
            />
          </Conversation>
        )}
      </Box>

      {/* Tasks zone — M3: full TasksPanel when expanded, summary row when collapsed.
          Phase 13 M4: tasks-focused state passes focused/cursor to TasksPanel. */}
      {tasksVisible && !tasksCollapsed && props.todoStore && (
        <TasksPanel
          todoStore={props.todoStore}
          messages={session.messages}
          tasks={props.taskManager ? props.taskManager.list() : []}
          tick={tasksTick}
          collapsed={false}
          focused={tasksFocused}
          cursor={tasksCursor}
        />
      )}
      {tasksVisible && tasksCollapsed && (
        <Box
          borderStyle="round"
          borderColor={activeTheme.colors.fgMuted}
          paddingX={1}
        >
          <Text color={activeTheme.colors.fgMuted}>
            Tasks ▸  Plan {props.todoStore ? props.todoStore.items.length : 0} · {props.taskManager ? props.taskManager.list().length : 0} backgrounds   (Ctrl+T to expand)
          </Text>
        </Box>
      )}

      {/* Prompt zone — replaced by inline submenu when active. */}
      {submenuInline && submenu?.kind === 'permission' && (
        <SubmenuFrame mode="inline" title="Permission" focused>
          <PermissionDialog
            call={submenu.call}
            suggestedPattern={submenu.suggestedPattern}
            annotationBadges={submenu.annotationBadges}
            onDecide={d => { submenu.resolve(d); closeSubmenu() }}
          />
        </SubmenuFrame>
      )}
      {submenuInline && submenu?.kind === 'plugin-config' && (
        <SubmenuFrame mode="inline" title={`Plugin · ${submenu.plugin.manifest.name}`} focused>
          <PluginConfigDialog
            plugin={submenu.plugin}
            fields={submenu.fields}
            onSubmit={values => { submenu.resolve(values); closeSubmenu() }}
            onCancel={() => { submenu.resolve(null); closeSubmenu() }}
          />
        </SubmenuFrame>
      )}
      {promptVisible && (
        <PromptInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          disabled={inSubmenu}
          focused={promptFocused}
          placeholder=""
          cwd={props.cwd}
          onAttachFile={p => { pendingAttachments.current.push(p) }}
          vim={props.config.vim?.enabled === true}
          slash={props.slash}
          onSlashActiveChange={handleSlashActiveChange}
          onSlashCursorChange={setSlashCursor}
        />
      )}
      {/* Phase 12 §4.8 — SlashCard takes over the Status slot when slash is active. */}
      {slashActive && props.slash && (
        <SlashCard
          value={input}
          registry={props.slash}
          selectedIndex={slashCursor}
          focused={true}
        />
      )}

      {/* Full submenus — replace Tasks/Prompt/Status entirely. */}
      {submenuFull && submenu?.kind === 'model-picker' && (
        <SubmenuFrame mode="full" title="Model picker" focused>
          <ModelPicker
            providers={props.providers.listProviders()}
            onSelect={(providerId, model) => {
              session.providerId = providerId
              session.model = model
              closeSubmenu()
            }}
            onAddProvider={() => dispatchUI({ type: 'open-submenu', submenu: { kind: 'onboarding-wizard' } })}
            onRefresh={async (providerId) => props.providers.fetchRemoteModels(providerId)}
            onCancel={closeSubmenu}
          />
        </SubmenuFrame>
      )}
      {submenuFull && submenu?.kind === 'config' && (
        <SubmenuFrame mode="full" title="Config" focused>
          <ConfigSubmenu
            config={props.config}
            onSave={async (mutate) => {
              await saveConfigPatch(os.homedir(), (obj) => {
                mutate(obj)
                // Mirror back to the in-memory config so the live Status
                // panel etc. immediately reflect the saved values without
                // needing a full app reload.
                mutate(props.config as unknown as Record<string, unknown>)
              })
              bumpMessages()
            }}
            onOpenEditor={() => { props.onOpenEditor(); closeSubmenu() }}
            loadedPlugins={props.loadedPlugins}
            loadedSkills={props.loadedSkills}
          />
        </SubmenuFrame>
      )}
      {submenuFull && submenu?.kind === 'stats' && (
        <SubmenuFrame mode="full" title="Stats" focused>
          <StatsView onExit={closeSubmenu} />
        </SubmenuFrame>
      )}
      {submenuFull && submenu?.kind === 'doctor' && (
        <SubmenuFrame mode="full" title="Doctor" focused>
          <DoctorReport report={submenu.report} onClose={closeSubmenu} />
        </SubmenuFrame>
      )}
      {submenuFull && submenu?.kind === 'onboarding-wizard' && (
        <SubmenuFrame mode="full" title="Onboarding" focused>
          <Wizard
            onDone={async (patch) => {
              try { await saveWizardPatch(os.homedir(), patch) } catch { /* ignore */ }
              closeSubmenu()
            }}
            onCancel={closeSubmenu}
          />
        </SubmenuFrame>
      )}
      {submenuFull && submenu?.kind === 'message-selector' && (
        <SubmenuFrame mode="full" title="Rewind to message" focused>
          <MessageSelector
            messages={submenu.messages}
            onSelect={async (messageId) => {
              closeSubmenu()
              try {
                await props.sessions.truncateAfter(messageId)
              } catch {
                // ignore — message may have been removed already
              }
            }}
            onCancel={closeSubmenu}
          />
        </SubmenuFrame>
      )}
      {submenuFull && submenu?.kind === 'session-picker' && submenu.metas === 'loading' && (
        <SubmenuFrame mode="full" title="Sessions" focused>
          <Box paddingX={1}>
            <Text color="cyan">Loading sessions…</Text>
          </Box>
        </SubmenuFrame>
      )}
      {submenuFull && submenu?.kind === 'session-picker' && submenu.metas !== 'loading' && (
        <SubmenuFrame mode="full" title="Sessions" focused>
          <SessionPicker
            sessions={submenu.metas}
            onSelect={async (id) => {
              closeSubmenu()
              const resumed = await props.sessions.resume(id)
              setSession(resumed)
              stream.reset()
            }}
            onCancel={closeSubmenu}
          />
        </SubmenuFrame>
      )}
      {/* Phase 13 M4 — Tasks focus submenu */}
      {submenuFull && submenu?.kind === 'tasks' && props.todoStore && (
        <SubmenuFrame mode="full" title="Tasks" focused>
          <TasksSubmenu
            focusItem={submenu.focusItem}
            todoStore={props.todoStore}
            messages={session.messages}
            tasks={props.taskManager ? props.taskManager.list() : []}
          />
        </SubmenuFrame>
      )}

      {/* Status zone */}
      {statusVisible && (
        <StatusPanel
          mode={hintMode}
          model={session.model}
          providerId={session.providerId || '—'}
          cwd={props.cwd}
          gitBranch={props.gitBranch}
          contextUsed={contextUsed}
          contextMax={contextMax}
          inputTokens={session.totalUsage.inputTokens}
          outputTokens={session.totalUsage.outputTokens}
          cost={cost}
          pluginCount={props.pluginCount ?? 0}
          sessionPluginCount={props.sessionPluginCount ?? 0}
          agentInFlight={props.agentInFlight ?? 0}
          taskManager={props.taskManager}
          hiddenSegments={props.config.statusBar?.hidden ?? []}
          layout={props.config.statusBar?.layout ?? 'dense'}
          iconMode={props.config.statusBar?.iconMode ?? 'icon'}
          statusLineConfig={props.config.statusLine}
          startedAt={session.createdAt}
        />
      )}
    </Box>
    </ThemeProvider>
  )
}
