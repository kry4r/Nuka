// src/tui/App.tsx
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Welcome } from './Welcome/Welcome'
import { Messages } from './Messages/Messages'
import { PromptInput } from './PromptInput/PromptInput'
import { useIdlePoke } from './hooks/useIdlePoke'
import { useAwayRecap } from './hooks/useAwayRecap'
import { AwaySummaryCard } from './Recap/AwaySummaryCard'
import { CronMissedBanner } from './Status/CronMissedBanner'
import { CostBanner } from './Status/CostBanner'
import { isCostDisplayEnabled } from '../core/cost/displayEnabled'
import { EmergencyTipBanner } from './Status/EmergencyTipBanner'
import { StatusPanel } from './Status/StatusPanel'
import { SubmenuFrame } from './Submenu/SubmenuFrame'
import { PermissionDialog } from './dialogs/PermissionDialog'
import { PluginConfigDialog } from './dialogs/PluginConfigDialog'
import { ModelPicker } from './dialogs/ModelPicker'
import { EffortPicker } from './dialogs/EffortPicker'
import { SettingsSubmenu } from './Submenu/settings/SettingsSubmenu'
import { recentAssistantMessages } from '../slash/rewind'
import { saveConfigPatch } from '../core/config/save'
import { appendMessage } from '../core/session/session'
import { SessionPicker } from './dialogs/SessionPicker'
import type { SessionMeta, SessionStore } from '../core/session/store'
import { SessionList } from './History/SessionList'
import { HistoryStore } from '../core/session/history/store'
import type { HistoryListEntry, SessionId } from '../core/session/history/types'
import type { LoadedPlugin, PluginUserConfigField } from '../core/plugin/manifest'
import type { SessionManager } from '../core/session/manager'
import type { ProviderResolver } from '../core/provider/resolver'
import type { Config } from '../core/config/schema'
import type { AgentEvent } from '../core/agent/events'
import type { ImageContentBlock } from '../core/message/types'
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
import type { PlanModeState } from '../core/planMode/planModeState'
import { computeCost } from '../core/session/telemetry'
import { useAgentStream } from './hooks/useAgentStream'
import { runBangShell } from './bangShell'
import { makeUserMessage } from '../core/message/factories'
import { DISPATCH_AGENT_TOOL_NAME } from '../core/agents/dispatchTool'
import type { TodoState } from '../core/tools/todoWrite'
import { TasksPanel, flattenedTasksLength } from './Tasks/TasksPanel'
import { TasksSubmenu } from './Submenu/TasksSubmenu'
import { findInFlightSubagents } from './Tasks/SubagentList'
import { MonitorSubmenuWrapper } from './Monitor/MonitorSubmenu'
import { HarnessSubmenu } from './Submenu/harness/HarnessSubmenu'
// Phase 14b — new 5-column Tasks panel
import { TasksPanelNew } from './Tasks/TasksPanelNew'
import { useTasksColumns } from './Tasks/useTasksColumns'
import { focusReducer, initialFocus } from './Tasks/focusReducer'
import { eventBus } from '../core/events/bus'
import { useTerminalSize } from './hooks/useTerminalSize'
import { truncateByWidth } from '../core/stringWidth'
import { defaultPalette as P } from './theme'

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
  | { kind: 'settings' }
  | { kind: 'model-picker' }
  | { kind: 'effort-picker' }
  | { kind: 'session-picker'; metas: SessionMeta[] | 'loading' }
  // B4 — full session history browser (replaces session-picker for /history).
  | { kind: 'history-list'; entries: HistoryListEntry[] | 'loading' }
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
      variant?: import('../core/permission/bridge').PermissionVariant
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
  // Phase 14b — monitor dashboard
  | { kind: 'monitor' }
  // Phase 14d — harness control submenu (opened by /harness with no args)
  | { kind: 'harness-submenu' }

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
  // Bug fix #18: clamp the focused cursor when the live total shrinks
  // (e.g. a subagent finishes and rolls off the panel). When `total` is 0
  // we exit focus mode entirely.
  | { type: 'tasks-clamp'; total: number }

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
    case 'tasks-clamp': {
      // Only meaningful in tasks-focused state.
      if (state.kind !== 'tasks-focused') return state
      // Total dropped to 0 → exit focus mode entirely.
      if (action.total <= 0) return { kind: 'normal' }
      const max = action.total - 1
      if (state.cursor <= max) return state
      return { kind: 'tasks-focused', cursor: max }
    }
    default:
      return state
  }
}

function WorkingIndicator(props: { model: string; queued: number }): React.JSX.Element {
  const suffix = props.queued > 0 ? ` · ${props.queued} queued` : ''
  return (
    <Box paddingX={1}>
      <Text color={P.accentCool} bold>working</Text>
      <Text color={P.fgMuted}> · {truncateByWidth(props.model, 48)}{suffix}</Text>
    </Box>
  )
}

function ErrorIndicator(props: { message: string }): React.JSX.Element {
  return (
    <Box paddingX={1}>
      <Text color={P.error} bold>error</Text>
      <Text color={P.fgMuted}> · {truncateByWidth(props.message.replace(/[\r\n]+/g, ' '), 80)}</Text>
    </Box>
  )
}

function isPageUpInput(input: string, key: Record<string, unknown>): boolean {
  return key.pageUp === true || input === '\u001B[5~'
}

function isPageDownInput(input: string, key: Record<string, unknown>): boolean {
  return key.pageDown === true || input === '\u001B[6~'
}

function isHomeInput(input: string, key: Record<string, unknown>): boolean {
  return key.home === true || input === '\u001B[H' || input === '\u001B[1~'
}

function isEndInput(input: string, key: Record<string, unknown>): boolean {
  return key.end === true || input === '\u001B[F' || input === '\u001B[4~'
}

function syncSessionSelectionFromConfig(session: Session, config: Config): void {
  const activeProviderId = config.active?.providerId ?? ''
  const activeProvider = config.providers.find(p => p.id === activeProviderId)
  if (!activeProviderId || !activeProvider) return

  const providerChanged = session.providerId !== activeProviderId
  session.providerId = activeProviderId

  const configuredModel = activeProvider.selectedModel ?? activeProvider.models?.[0] ?? ''
  if (providerChanged || !session.model || (configuredModel && session.model !== configuredModel)) {
    session.model = configuredModel
  }
}

export type AppProps = {
  sessions: SessionManager
  /**
   * B4 — optional persistent session store. When present, the `/history`
   * dialog can list and delete past sessions. Absent when
   * NUKA_SESSION_PERSIST is unset; the `/history` slash short-circuits
   * before the dialog opens in that case.
   */
  store?: SessionStore
  slash: SlashRegistry
  providers: ProviderResolver
  config: Config
  runAgent: (
    input: { text: string; images?: readonly ImageContentBlock[] },
    session: Session,
    signal: AbortSignal,
  ) => AsyncIterable<AgentEvent>
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
  /**
   * 2026-05-18 — in-process hook registry forwarded into SlashContext so
   * `/task run` can thread it into LocalAgentSpec for lifecycle fires.
   * Optional — absent in legacy tests / programmatic embeds.
   */
  hookRegistry?: import('../core/hooks/registry').HookRegistry
  /** Phase 12 M3 — todo store from createTodoStore(); mutated in-place by TodoWrite tool. */
  todoStore?: TodoState
  /** Phase 12 M4 — read-only list of loaded plugins for SettingsSubmenu PluginsForm. */
  loadedPlugins?: { name: string; description?: string }[]
  /** Phase 12 M4 — read-only list of loaded skills for SettingsSubmenu SkillsForm. */
  loadedSkills?: { name: string; description?: string }[]
  /** Phase 13 M2 — updates from ~/.nuka/updates.json */
  updates?: import('../core/updates/load').UpdateEntry[]
  /** Phase 13 M2 — recent sessions from ~/.nuka/sessions/ */
  recent?: import('../core/session/recent').RecentEntry[]
  /** Phase 14d — harness state machine (so /harness submenu can read/mutate it). */
  harness?: import('../core/harness/state').HarnessStateMachine
  /** Phase D2 — pre-resolved emergency tip from config.notices.emergency. */
  emergencyTip?: import('../core/notices/emergencyTip').EmergencyTip | null
  /**
   * P1 #5 — pre-formatted missed-cron-task notice resolved in cli.tsx
   * after `bootCronRehydrate`. Renders as a warning-colored bordered
   * row beneath the Welcome banner; `null`/omitted suppresses the slot.
   * Replaces the prior `console.warn` that raced the ink renderer.
   */
  cronMissed?: import('../core/notices/cronMissed').CronMissedNotice | null
  /**
   * Iter DDDD — shared PlanModeState constructed in cli.tsx. When
   * provided, the StatusPanel subscribes via App and shows a
   * `[PLAN MODE]` badge while the agent is in plan mode. The prop is
   * optional so tests that render `<App>` without the state still work
   * (the badge simply never appears).
   */
  planModeState?: PlanModeState
  /**
   * Iter MMMM — production-side `IdleAwaySummaryHook` constructed in
   * cli.tsx (only when a provider is configured). When provided, every
   * keystroke / submit in PromptInput pulses `idleHook.poke()` so the
   * awaySummary watcher correctly detects "user returned" after the
   * configured threshold. Optional — tests pass nothing and the
   * useIdlePoke hook degrades to a no-op.
   *
   * Iter NNNN — also subscribes a TUI banner to the recap event stream.
   * When the model returns a recap on `onReturn`, the banner renders
   * above the prompt and auto-dismisses on the next user input.
   */
  idleHook?: {
    poke: () => void
    onRecapResult?: (
      listener: (event: import('../core/awaySummary/idleHook').AwayRecapEvent) => void,
    ) => () => void
  }
  /**
   * Resolver capability bundle for non-file prompt references (diff /
   * staged / git / commit / url / image). Optional — when omitted,
   * `handleSubmit` lazily constructs the default real-fs / git-CLI /
   * fetch deps via `buildDefaultResolverDeps()`. Tests inject stubs so
   * no real fs / network / git calls fire.
   */
  resolverDeps?: import('../promptContextReferences/resolver').PromptResolverDeps
}

type ManualCompactState =
  | { status: 'running' }
  | { status: 'done' }
  | { status: 'failed'; message: string }

export function App(props: AppProps): React.JSX.Element {
  const { exit } = useApp()
  const [session, setSession] = useState<Session>(() => props.sessions.active()!)
  const [input, setInput] = useState('')
  const [messageScrollOffset, setMessageScrollOffset] = useState(0)
  const [manualCompact, setManualCompact] = useState<ManualCompactState | null>(null)
  // Iter MMMM — stable poke callback wired into PromptInput.onUserInput.
  // When props.idleHook is undefined (no provider configured, or under
  // test) `pokeIdle` is a no-op, so PromptInput needs no special-casing.
  const pokeIdle = useIdlePoke(props.idleHook)
  // Iter NNNN — subscribe to typed recap events from the idle hook. When
  // a recap arrives (model finished summarizing the away window), the
  // banner renders above the prompt. Dismissal is wired into the same
  // keystroke pulse that pokes the watcher: as soon as the user hits a
  // key, the banner clears AND the idle-away window resets, so the
  // user gets a clean prompt on first input.
  const { recap: awayRecap, dismiss: dismissAwayRecap } = useAwayRecap(props.idleHook ?? null)
  const handleUserInput = useCallback(() => {
    pokeIdle()
    dismissAwayRecap()
  }, [pokeIdle, dismissAwayRecap])
  // Phase 12 §4.2 — single discriminated UIState replaces the prior
  // dialog + slash-active flags.
  const [uiState, dispatchUI] = useReducer(uiReducer, { kind: 'normal' } as UIState)
  // Phase 13 M2.5 — stable callback so PromptInput's useEffect doesn't refire
  // on every parent render (inline arrow had a new identity each pass).
  const handleSlashActiveChange = useCallback((active: boolean) => {
    dispatchUI({ type: 'slash-set', active })
  }, [])
  // Timestamp of the most-recent Esc that landed in normal+idle state. A
  // second Esc within 2s opens the rewind submenu (#8). Replaces the old
  // double-Esc-quits gesture; explicit exit still works via Q / :q / /exit.
  const lastEscRef = useRef<number>(0)
  // Bumped whenever we mutate session.messages directly so React re-renders.
  const [, setMessageTick] = useState(0)
  // Phase 12 M3 — tick drives re-renders of TasksPanel whose data sources
  // (todoStore, taskManager) mutate in place. Bumped on agent events and
  // on TaskManager state changes.
  const [tasksTick, setTasksTick] = useState(0)
  const bumpTasksTick = useCallback(() => setTasksTick(t => t + 1), [])
  const bumpMessages = useCallback(() => {
    setMessageTick(t => t + 1)
    setMessageScrollOffset(0)
    // Also refresh tasks panel so in-flight subagent list stays current.
    setTasksTick(t => t + 1)
  }, [])

  const appendAssistantNotice = useCallback((text: string, idPrefix = 'notice') => {
    appendMessage(session, {
      role: 'assistant',
      content: [{ type: 'text', text }],
      id: `${idPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: Date.now(),
    })
    bumpMessages()
  }, [session, bumpMessages])

  // Subscribe to TaskManager changes to keep Tasks panel reactive.
  useEffect(() => {
    if (!props.taskManager) return
    return props.taskManager.on('change', bumpTasksTick)
  }, [props.taskManager, bumpTasksTick])

  // Iter DDDD — re-render whenever PlanModeState flips so the
  // `[PLAN MODE]` badge in StatusPanel reacts to enter/exit/reset.
  // We don't track a local `mode` state because cli.tsx's listener
  // already mutates `session.mode` in place; we only need a tick to
  // make React notice the mutation. Reusing `setMessageTick` keeps the
  // wiring minimal (one extra bump per plan-mode event is cheap).
  const [, setPlanModeTick] = useState(0)
  useEffect(() => {
    const state = props.planModeState
    if (!state) return
    return state.subscribe(() => setPlanModeTick(t => t + 1))
  }, [props.planModeState])

  // Phase 14b — 5-column tasks panel state driven by eventBus
  const columnsState = useTasksColumns(eventBus)
  // Phase 14b review fix: prefer new panel when it has data; legacy panel is mutually exclusive.
  const useColumnsPanel = Object.values(columnsState).some(c => c.rows.length > 0)
  const [tasksFocus14b, setTasksFocus14b] = useState(() => initialFocus())
  const { columns: terminalCols, rows: terminalRows } = useTerminalSize()

  // Phase 12 M5 — SlashCard cursor (driven by PromptInput keystrokes).
  const [slashCursor, setSlashCursor] = useState(0)
  const pendingAttachments = useRef<string[]>([])
  // Non-file mention tokens accepted via PromptInput.onAttachReference.
  // Drained at submit and resolved through `inlineReferencesIntoText`.
  const pendingReferences = useRef<import('../promptContextReferences/types').PromptReferenceToken[]>([])

  useEffect(() => {
    props.permissionBridge.setHandler((payload, resolve) => {
      dispatchUI({
        type: 'open-submenu',
        submenu: {
          kind: 'permission',
          call: payload.call,
          suggestedPattern: payload.suggestedPattern,
          annotationBadges: payload.annotationBadges,
          variant: payload.variant,
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

  const runner = (
    i: { text: string; images?: readonly ImageContentBlock[] },
    signal: AbortSignal,
  ): AsyncIterable<AgentEvent> => props.runAgent(i, session, signal)
  const stream = useAgentStream({ runAgent: runner })

  const handleSlashEffect = useCallback(async (effect: { kind: string }) => {
    if (effect.kind === 'clear-screen') {
      stream.reset()
      setManualCompact(null)
    } else if (effect.kind === 'new-session') {
      const next = props.sessions.new()
      next.providerId = session.providerId
      next.model = session.model
      setSession(next)
      stream.reset()
      setManualCompact(null)
    } else if (effect.kind === 'fork-session') {
      const next = props.sessions.fork()
      setSession(next)
      stream.reset()
      setManualCompact(null)
    } else if (effect.kind === 'compact') {
      setManualCompact({ status: 'running' })
      try {
        await props.compactSession(session)
        setManualCompact({ status: 'done' })
        bumpMessages()
      } catch (error) {
        setManualCompact({
          status: 'failed',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }, [session, props, stream, bumpMessages])

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
        hookRegistry: props.hookRegistry,
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
        } else if (res.dialog.kind === 'history-list') {
          // B4 — /history. The slash command already verified persistence is
          // enabled before returning this dialog, so `props.store` should
          // be present. Guard anyway for the test-harness case.
          if (!props.store) {
            return
          }
          dispatchUI({
            type: 'open-submenu',
            submenu: { kind: 'history-list', entries: 'loading' },
          })
          const history = new HistoryStore({ store: props.store })
          const entries = await history.list()
          dispatchUI({
            type: 'update-submenu',
            submenu: { kind: 'history-list', entries },
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
        appendMessage(session, {
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
      appendMessage(session, makeUserMessage({ text }))
      bumpMessages()
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

    // Non-file mention references (diff / staged / git / commit / url
    // / image) — drained AFTER file attachments so resolved blocks
    // appear above the user's prompt but below any inlined file
    // contents. The resolver bundle is injected via props for tests;
    // production lazily wires the default fs / git / fetch deps.
    //
    // Image references additionally produce structured
    // `ImageContentBlock[]` that ride on the user-message `content`
    // channel via `stream.send(text, { images })` — base64 / URL
    // payloads never live on the text prompt.
    let pendingImages: readonly ImageContentBlock[] = []
    const referenceTokens = pendingReferences.current.splice(0)
    if (referenceTokens.length > 0) {
      const { inlineReferencesIntoText } = await import(
        '../promptContextReferences/inlineReferences'
      )
      const deps =
        props.resolverDeps ??
        (await import('../promptContextReferences/deps')).buildDefaultResolverDeps()
      const result = await inlineReferencesIntoText({
        raw: text,
        tokens: referenceTokens,
        deps,
      })
      text = result.text
      pendingImages = result.images
    }

    if (stream.isRunningNow()) {
      // Queued path stays text-only: there is no place to stash the
      // structured image attachment alongside a queued prompt today, so
      // dropping silently is the least surprising behaviour. The user
      // can re-attach after the active turn finishes.
      session.queue.push(text)
      return
    }
    const sendResult = await stream.send(text, pendingImages.length > 0 ? { images: pendingImages } : undefined)
    if (!sendResult.ok && !sendResult.busy) {
      appendAssistantNotice(`[error]\n${sendResult.error.message}`, 'agent-error')
    }
  }, [props, session, stream, handleSlashEffect, exit, appendAssistantNotice])

  const [expandedAgentCallIds, setExpandedAgentCallIds] = useState<Set<string>>(() => new Set())

  // Bug fix #18: live count of focusable Tasks rows. When a subagent finishes
  // and rolls off the panel mid-focus, dispatch a clamp so cursor never
  // points past the last item (or exits focus mode if the panel empties).
  // Recomputed on every render the panel could change — tasksTick is bumped
  // on agent events, taskManager change subscription, and todo writes.
  const flattenedTotal = useMemo(
    () => flattenedTasksLength({
      todoStore: props.todoStore,
      messages: session.messages,
      tasks: props.taskManager ? props.taskManager.list() : [],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.todoStore, props.todoStore?.items.length, session.messages, props.taskManager, tasksTick],
  )
  useEffect(() => {
    if (uiState.kind !== 'tasks-focused') return
    if (uiState.cursor >= flattenedTotal) {
      dispatchUI({ type: 'tasks-clamp', total: flattenedTotal })
    }
  }, [flattenedTotal, uiState])

  useInput((inputKey, key) => {
    if (key.escape) {
      // Esc always returns to normal from any non-normal UIState. Inline
      // submenus (permission/plugin-config) own their own Esc handler; we
      // don't preempt those. Stream-running cancel wins over UIState reset.
      if (stream.running) { stream.cancel(); return }
      if (uiState.kind === 'submenu' && isInlineSubmenu(uiState.submenu)) {
        // Let the inline dialog's own useInput run.
        return
      }
      if (uiState.kind !== 'normal') {
        dispatchUI({ type: 'reset' })
        lastEscRef.current = 0
        return
      }
      // Already normal + idle: a second Esc within 2s opens the rewind
      // submenu (#8). The first Esc just primes the timer.
      const now = Date.now()
      if (now - lastEscRef.current < 2000) {
        lastEscRef.current = 0
        const recent = recentAssistantMessages(session.messages, 10)
        if (recent.length === 0) return
        dispatchUI({
          type: 'open-submenu',
          submenu: { kind: 'message-selector', messages: recent },
        })
        return
      }
      lastEscRef.current = now
      return
    }
    if (uiState.kind === 'normal' && !stream.running) {
      const maxOffset = Math.max(0, session.messages.length - 1)
      if (isPageUpInput(inputKey, key)) {
        setMessageScrollOffset(v => Math.min(maxOffset, v + Math.max(5, Math.floor(conversationAvailableRows / 2))))
        return
      }
      if (isPageDownInput(inputKey, key)) {
        setMessageScrollOffset(v => Math.max(0, v - Math.max(5, Math.floor(conversationAvailableRows / 2))))
        return
      }
      if (isHomeInput(inputKey, key)) {
        setMessageScrollOffset(maxOffset)
        return
      }
      if (isEndInput(inputKey, key)) {
        setMessageScrollOffset(0)
        return
      }
    }
    // Phase 13 M4 — Tab enters Tasks focus mode when Tasks panel is non-empty;
    // also exits focus mode when already focused.
    // Bug fix #38: when slash card is active, Tab is owned by the slash
    // suggestion completion — bail out early so the Tasks-focus dispatch
    // doesn't race with PromptInput's Tab handler.
    if (key.tab) {
      if (uiState.kind === 'slash') return
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
    // Phase 14b — 5-column panel keyboard: Tab/j/k/Enter/Esc through focusReducer.
    // Only active when in normal UI state (not submenu, not slash).
    if (uiState.kind === 'normal') {
      if (key.tab && !key.shift) {
        setTasksFocus14b(f => focusReducer(f, { type: 'tab' }))
      } else if (key.tab && key.shift) {
        setTasksFocus14b(f => focusReducer(f, { type: 'shift-tab' }))
      } else if ((inputKey === 'j' || key.downArrow) && tasksFocus14b.kind === 'tasks-column') {
        setTasksFocus14b(f => focusReducer(f, { type: 'down' }))
      } else if ((inputKey === 'k' || key.upArrow) && tasksFocus14b.kind === 'tasks-column') {
        setTasksFocus14b(f => focusReducer(f, { type: 'up' }))
      } else if (key.return && tasksFocus14b.kind === 'tasks-column') {
        const col = columnsState[tasksFocus14b.column]
        const row = col.rows[tasksFocus14b.selectedIndex]
        if (row) setTasksFocus14b(f => focusReducer(f, { type: 'enter', rowId: row.id }))
      }
    }
    if (key.escape && tasksFocus14b.kind !== 'prompt') {
      setTasksFocus14b(f => focusReducer(f, { type: 'esc' }))
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

  // Mid-stream assistant text is mirrored on the hook's `streamingAssistant`
  // and rendered live via Messages' non-Static streaming row. Once the loop
  // appends the final AssistantMessage to session.messages, the hook clears
  // streamingAssistant so the static row replaces the live one seamlessly.
  const streamingMsg = stream.streamingAssistant
  const lastErrorEvent = (() => {
    for (let i = stream.events.length - 1; i >= 0; i--) {
      const ev = stream.events[i]
      if (ev?.type === 'error') return ev.error
    }
    return null
  })()
  const justCompacted = stream.events.some(e => e.type === 'auto_compacted')
  // contextUsed = the most recent assistant turn's `inputTokens` — that
  // represents the actual size of the current context window, NOT the
  // running total across the session. (Cumulative totals are still shown
  // via the in:/out: segment as session-wide stats.)
  const contextUsed = (() => {
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const m = session.messages[i]
      if (m && m.role === 'assistant' && m.usage) {
        return m.usage.inputTokens
      }
    }
    return 0
  })()
  const contextMax = props.config.compact?.contextWindow ?? 200_000
  const pc = props.providers.getProviderConfig(session.providerId)
  const providerDisplayName = pc?.name?.trim() || session.providerId || '—'
  const cost = pc ? computeCost(pc, session.model, session.totalUsage) : 0
  const hintMode: 'idle' | 'running' | 'awaiting-user' =
    uiState.kind === 'submenu' ? 'awaiting-user'
      : stream.running ? 'running'
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
  // Status zone is hidden by full submenus only — the slash card now sits
  // above the prompt (instead of replacing the status slot), so status
  // stays visible while the user is typing a slash command.
  const statusVisible = !submenuFull
  // Welcome lives outside the Static stream when no messages exist (so it
  // can re-render as cwd/branch/model change), then flips INTO the Static
  // stream as the first item the moment the first message lands — that way
  // it scrolls upward with subsequent messages instead of being toggled off.
  // Full submenus (e.g. /settings) are rendered later in the tree on top of
  // the conversation zone, so we don't need to gate Welcome on submenu state.
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

  // Bug fix #39: the prologue Welcome is a relatively heavy element (logo,
  // updates panel, recent panel) — memoize it so it isn't rebuilt on every
  // App render (which fires on every keystroke). gitBranch is destructured
  // because it's an object whose identity may change per render.
  const branchName = props.gitBranch?.branch
  const branchDirty = props.gitBranch?.dirty
  // Persistent EmergencyTip banner — moved out of the Welcome hero so it
  // survives the Static-stream flush that scrolls Welcome out of view once
  // the first message lands. Renders in the BOTTOM slot (above
  // CronMissedBanner) until the auto-dismiss rule fires. Mirrors the
  // CronMissed fix from Turn 13.
  const emergencyTip = props.emergencyTip ?? null
  // Persistent CronMissed banner — moved out of the Welcome hero so it
  // survives the Static-stream flush that scrolls Welcome out of view once
  // the first message lands. Renders in the BOTTOM slot (next to
  // AwaySummaryCard) until the auto-dismiss rule fires (see
  // `cronBannerDismissed` below).
  const cronMissed = props.cronMissed ?? null
  // Auto-dismiss: once any message exists in the session the user has had
  // (at minimum) one full turn of context — they've seen the banner, the
  // notice is now nagging rather than informing. Cron tasks will fire on
  // their next scheduled window regardless of dismissal, so a single-turn
  // exposure window is acceptable. Manual dismiss is intentionally NOT
  // wired — the BOTTOM slot is already crowded with PromptInput / SlashCard
  // / StatusPanel / AwaySummaryCard keyboard ownership and stealing a key
  // for cron dismissal would conflict with several of those.
  const cronBannerDismissed = session.messages.length > 0
  // EmergencyTip uses the same auto-dismiss policy as CronMissed: once any
  // turn lands the tip has been seen and further re-renders are nagging.
  const emergencyTipDismissed = session.messages.length > 0
  // B1 — env-opt-in real-time cost row. Gate resolves once per render so
  // toggling NUKA_COST_DISPLAY mid-session takes effect on the next paint
  // without forcing a remount.
  const costDisplayOn = isCostDisplayEnabled()
  const prologueNode = useMemo(
    () => (
      <Welcome
        cwd={props.cwd}
        gitBranch={props.gitBranch}
        model={session.model}
        version={props.version}
        updates={props.updates}
        recent={props.recent}
      />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.cwd, branchName, branchDirty, session.model, props.version, props.updates, props.recent],
  )

  // Bug fix #9: compute a row budget so Messages can clamp its own height
  // and stop shoving the prompt off-screen on small terminals. Reserved
  // rows budget = status (~3) + tasks summary when collapsed (~3) + bordered
  // prompt input (~4) + safety margin (~4). The Messages component falls
  // back to its old TAIL_N=50 behavior if availableRows is omitted, so this
  // change is opt-in.
  const RESERVED_ROWS = 14
  const conversationAvailableRows = Math.max(8, terminalRows - RESERVED_ROWS)

  return (
    <ThemeProvider theme={activeTheme}>
    {/* Anchor the prompt + status to the bottom of the terminal: the outer
        column is forced to full terminal height, the conversation zone
        absorbs the leftover space via flexGrow=1, and every other zone
        keeps its natural height (flexShrink=0). */}
    <Box flexDirection="column" height={terminalRows}>
      {/* Conversation zone — soft layout region (no frame). Welcome rides
          in the live conversation only while the session is empty. Once real
          turns exist, Messages keeps recent turns in the live viewport instead
          of sending old content through Ink <Static> scrollback.
          Bug fix #9: overflow="hidden" so children that overflow the flex
          region are clipped, never pushing the bottom-anchored Prompt zone
          off-screen. Messages clamps the live tail via availableRows. */}
      <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden" minHeight={0}>
        {manualCompact?.status === 'running' && (
          <Text color={activeTheme.colors.fgMuted} dimColor>compact: running</Text>
        )}
        {manualCompact?.status === 'done' && (
          <Text color={activeTheme.colors.fgMuted} dimColor>compact: done</Text>
        )}
        {manualCompact?.status === 'failed' && (
          <Text color={activeTheme.colors.error}>compact: failed — {manualCompact.message}</Text>
        )}
        {justCompacted && (
          <Text color={activeTheme.colors.fgMuted} dimColor>✻ context compacted — older turns summarized</Text>
        )}
        <Messages
          items={session.messages}
          streaming={streamingMsg}
          scrollOffset={messageScrollOffset}
          expandedAgentCallIds={expandedAgentCallIds}
          resolveToolSource={props.tools ? (n) => props.tools!.find(n)?.source : undefined}
          resolveToolAnnotations={props.tools ? (n) => props.tools!.find(n)?.annotations : undefined}
          availableRows={conversationAvailableRows}
          prologue={prologueNode}
        />
      </Box>

      {/* BOTTOM slot — Tasks + inline submenus + slash card + prompt + status
          group, all wrapped in flexShrink={0} so a long conversation never
          pushes them off-screen. When a full-screen submenu is active it
          replaces this group entirely (rendered as a sibling below). */}
      {!submenuFull && (
      <Box flexDirection="column" flexShrink={0}>
      {/* Tasks zone — M3: full TasksPanel when expanded, summary row when collapsed.
          Phase 13 M4: tasks-focused state passes focused/cursor to TasksPanel.
          Phase 14b review fix: hidden when new panel has data (mutually exclusive). */}
      {tasksVisible && !tasksCollapsed && !useColumnsPanel && props.todoStore && (
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
          flexShrink={0}
        >
          <Text color={activeTheme.colors.fgMuted} wrap="truncate-end">
            Tasks ▸  Plan {props.todoStore ? props.todoStore.items.length : 0} · {props.taskManager ? props.taskManager.list().length : 0} backgrounds   (Ctrl+T to expand)
          </Text>
        </Box>
      )}
      {/* Phase 14b — 5-column Tasks panel (eventBus-driven, shown when data exists) */}
      {tasksVisible && !tasksCollapsed && useColumnsPanel && (
        <TasksPanelNew
          state={columnsState}
          focus={tasksFocus14b}
          cols={terminalCols}
        />
      )}

      {/* Prompt zone — replaced by inline submenu when active. */}
      {submenuInline && submenu?.kind === 'permission' && (
        <SubmenuFrame mode="inline" title="Permission" focused>
          <PermissionDialog
            call={submenu.call}
            suggestedPattern={submenu.suggestedPattern}
            annotationBadges={submenu.annotationBadges}
            variant={submenu.variant}
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
      {/* Iter NNNN — Away-summary recap banner. Renders above the slash
          card + prompt input whenever the idleHook has surfaced a recap
          and no inline submenu is in the way (the permission / plugin
          config dialogs own the inline slot and shouldn't be preempted).
          Auto-dismisses on the first user keystroke via `handleUserInput`
          (see useAwayRecap.dismiss + onUserInput plumbing). */}
      {awayRecap !== null && !submenuInline && promptVisible && (
        <AwaySummaryCard
          text={awayRecap.text}
          idleMs={awayRecap.idleMs}
          onDismiss={dismissAwayRecap}
        />
      )}
      {/* Persistent EmergencyTip banner. Mirrors the CronMissedBanner
          fix from Turn 13 — was previously rendered inside the Welcome
          hero (which scrolls out of view via the Static stream once the
          first message lands). Lives in the BOTTOM slot above
          CronMissedBanner with the same gating + auto-dismiss policy
          (single-turn exposure window). */}
      {!submenuInline && promptVisible && (
        <EmergencyTipBanner tip={emergencyTip} dismissed={emergencyTipDismissed} />
      )}
      {/* Persistent CronMissed banner. Was previously rendered inside the
          Welcome hero, but Welcome rides the Static stream and scrolls
          out of view as soon as the first message lands — so the user
          would never see missed-task warnings during their second turn.
          Lives in the BOTTOM slot (above SlashCard / PromptInput) so it
          stays visible across renders. Auto-dismisses once the session
          accumulates at least one message (see `cronBannerDismissed`).
          Gated like AwaySummaryCard: hidden while an inline submenu owns
          the prompt slot so it doesn't fight the dialog for vertical space. */}
      {/* B1 — env-opt-in CostBanner row. Sits between EmergencyTip and
          CronMissed in source order; null when NUKA_COST_DISPLAY!=1, when
          props.costTracker is absent, or when the active session has no
          recorded turns. The legacy `<StatusPanel cost=... />` below still
          renders for non-opted users — the banner is additive. */}
      {!submenuInline && promptVisible && (
        <CostBanner
          enabled={costDisplayOn}
          tracker={props.costTracker}
          sessionId={session.id}
          model={session.model}
        />
      )}
      {!submenuInline && promptVisible && (
        <CronMissedBanner notice={cronMissed} dismissed={cronBannerDismissed} />
      )}
      {!submenuInline && promptVisible && stream.running && (
        <WorkingIndicator
          model={`${providerDisplayName} · ${session.model}`}
          queued={session.queue.size()}
        />
      )}
      {!submenuInline && promptVisible && !stream.running && lastErrorEvent !== null && (
        <ErrorIndicator message={lastErrorEvent.message} />
      )}
      {/* SlashCard expands UPWARD above the prompt — it sits BEFORE PromptInput
          in source order so the suggestion list stacks above the input box. */}
      {slashActive && props.slash && promptVisible && (
        <SlashCard
          value={input}
          registry={props.slash}
          selectedIndex={slashCursor}
          focused={true}
        />
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
          onAttachReference={t => { pendingReferences.current.push(t) }}
          vim={props.config.vim?.enabled === true}
          slash={props.slash}
          onSlashActiveChange={handleSlashActiveChange}
          onSlashCursorChange={setSlashCursor}
          onUserInput={handleUserInput}
        />
      )}

      {/* Status zone — last child of the BOTTOM slot. */}
      {statusVisible && (
        <StatusPanel
          mode={hintMode}
          model={session.model}
          providerId={session.providerId || '—'}
          providerName={providerDisplayName}
          effort={props.config.effort}
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
          planMode={session.mode === 'plan'}
        />
      )}
      </Box>
      )}

      {/* Full submenus — replace Tasks/Prompt/Status entirely. */}
      {submenuFull && submenu?.kind === 'model-picker' && (
        <SubmenuFrame mode="full" title="Model picker" focused>
          <ModelPicker
            providers={props.providers.listProviders()}
            activeProviderId={session.providerId}
            activeModel={session.model}
            onSave={async (mutate) => {
              await saveConfigPatch(os.homedir(), (obj) => {
                mutate(obj)
                mutate(props.config as unknown as Record<string, unknown>)
              })
              props.providers.refreshConfig(props.config)
              syncSessionSelectionFromConfig(session, props.config)
              bumpMessages()
            }}
            onSelect={(providerId, model) => {
              session.providerId = providerId
              session.model = model
              closeSubmenu()
            }}
            onAddProvider={() => dispatchUI({ type: 'open-submenu', submenu: { kind: 'onboarding-wizard' } })}
            onFetchRemote={async (providerId) => props.providers.fetchRemoteModels(providerId)}
            onCancel={closeSubmenu}
          />
        </SubmenuFrame>
      )}
      {submenuFull && submenu?.kind === 'effort-picker' && (
        <SubmenuFrame mode="full" title="Reasoning effort" focused>
          <EffortPicker
            current={props.config.effort}
            onSelect={async (level) => {
              try {
                await saveConfigPatch(os.homedir(), (obj) => {
                  obj.effort = level
                })
                ;(props.config as unknown as { effort?: 'low' | 'medium' | 'high' }).effort = level
              } catch (err) {
                const e = err as NodeJS.ErrnoException
                const text = `[/effort] save failed: [${e?.code ?? 'ERR'}] ${(err as Error).message ?? ''}`
                appendMessage(session, {
                  role: 'assistant',
                  content: [{ type: 'text', text }],
                  id: `effort-err-${Date.now()}`,
                  ts: Date.now(),
                })
              }
              bumpMessages()
              closeSubmenu()
            }}
            onCancel={closeSubmenu}
          />
        </SubmenuFrame>
      )}
      {submenuFull && submenu?.kind === 'settings' && (
        <SubmenuFrame mode="full" title="Settings" focused>
          <SettingsSubmenu
            config={props.config}
            onSave={async (mutate) => {
              try {
                await saveConfigPatch(os.homedir(), (obj) => {
                  mutate(obj)
                  // Mirror back to the in-memory config so the live Status
                  // panel etc. immediately reflect the saved values without
                  // needing a full app reload.
                  mutate(props.config as unknown as Record<string, unknown>)
                })
                props.providers.refreshConfig(props.config)
                syncSessionSelectionFromConfig(session, props.config)
                bumpMessages()
              } catch (err) {
                // Phase 13 — gracefully surface I/O errors (ENOSPC, EACCES,
                // EROFS) so the TUI doesn't crash. Zod validation failures
                // are still re-thrown so forms can flash the offending field.
                const e = err as NodeJS.ErrnoException
                if (e?.code) {
                  const text = `[/settings] save failed: [${e.code}] ${e.message}`
                  appendMessage(session, {
                    role: 'assistant',
                    content: [{ type: 'text', text }],
                    id: `cfg-err-${Date.now()}`,
                    ts: Date.now(),
                  })
                  bumpMessages()
                  return
                }
                throw err
              }
            }}
            onOpenEditor={() => { props.onOpenEditor(); closeSubmenu() }}
            onClose={closeSubmenu}
            onRequestExternalPicker={(kind) => dispatchUI({ type: 'open-submenu', submenu: { kind } })}
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
              try {
                await saveWizardPatch(os.homedir(), patch)
                const { loadConfig } = await import('../core/config/load')
                const nextConfig = await loadConfig({ home: os.homedir(), cwd: props.cwd })
                Object.assign(props.config as unknown as Record<string, unknown>, nextConfig)
                props.providers.refreshConfig(props.config)
                session.providerId = nextConfig.active.providerId
                const activeProvider = nextConfig.providers.find(p => p.id === nextConfig.active.providerId)
                session.model = activeProvider?.selectedModel ?? activeProvider?.models?.[0] ?? session.model
                bumpMessages()
              } catch (err) {
                // Surface failures (zod validation, FS errors, etc.) as an
                // assistant message instead of silently swallowing them.
                const e = err as NodeJS.ErrnoException
                const tag = e?.code ? `[${e.code}] ` : ''
                const text = `[/onboarding] save failed: ${tag}${(err as Error).message ?? String(err)}`
                appendMessage(session, {
                  role: 'assistant',
                  content: [{ type: 'text', text }],
                  id: `onboarding-err-${Date.now()}`,
                  ts: Date.now(),
                })
                bumpMessages()
              }
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
            <Text color={activeTheme.colors.accentCool}>Loading sessions…</Text>
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
      {/* B4 — /history full-screen browser */}
      {submenuFull && submenu?.kind === 'history-list' && (
        <SubmenuFrame mode="full" title="History" focused>
          <SessionList
            entries={submenu.entries === 'loading' ? [] : submenu.entries}
            loading={submenu.entries === 'loading'}
            onResume={async (id: SessionId) => {
              closeSubmenu()
              const resumed = await props.sessions.resume(id)
              setSession(resumed)
              stream.reset()
            }}
            onDelete={async (id: SessionId) => {
              if (!props.store) return
              const history = new HistoryStore({ store: props.store })
              await history.delete(id)
              // re-load list
              dispatchUI({ type: 'update-submenu', submenu: { kind: 'history-list', entries: 'loading' } })
              const entries = await history.list()
              dispatchUI({ type: 'update-submenu', submenu: { kind: 'history-list', entries } })
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

      {/* Phase 14b — Monitor dashboard submenu */}
      {submenuFull && submenu?.kind === 'monitor' && (
        <MonitorSubmenuWrapper onClose={closeSubmenu} />
      )}

      {/* Phase 14d — Harness control submenu (opened by `/harness` with no args).
          The component owns its own SubmenuFrame chrome, so we render it bare here. */}
      {submenuFull && submenu?.kind === 'harness-submenu' && props.harness && (
        <HarnessSubmenu
          snapshot={(() => {
            const snap = props.harness!.snapshot()
            return {
              mode: snap.mode,
              // Stage may be null before triage runs; default to 'brainstorm' so
              // the read-only Stage row always has a label. Real refusals on
              // a manual transition will surface via the error flash.
              stage: snap.currentStage ?? 'brainstorm',
              sessionId: snap.sessionId,
            }
          })()}
          availableStages={['brainstorm', 'spec', 'plan', 'search', 'implement', 'review', 'recap']}
          onSetMode={(mode) => {
            props.harness!.setMode(mode)
            // Force re-render so the submenu (which reads via snapshot prop)
            // reflects the new mode immediately.
            bumpMessages()
          }}
          onTransition={async (to) => {
            await props.harness!.transition(to, 'manual')
            bumpMessages()
          }}
          onRetriage={() => {
            // Simpler path per spec: append a hint asking the user to invoke
            // `/triage <hint>` themselves. Routing into the existing triage
            // flow would require additional plumbing not in scope.
            appendMessage(session, {
              role: 'assistant',
              content: [{
                type: 'text',
                text: '[/harness] To re-classify the task, run `/triage <hint describing the task>`.',
              }],
              id: `harness-retriage-hint-${Date.now()}`,
              ts: Date.now(),
            })
            bumpMessages()
          }}
          onClose={closeSubmenu}
        />
      )}
    </Box>
    </ThemeProvider>
  )
}
