// src/tui/Status/StatusPanel.tsx
//
// Claude-status inspired statusline: one calm row by default, space-separated
// fields, terse git indicators, and a compact context bar. The old layout
// modes remain as preferences but no mode renders the prior two-column block.
//
// A 7th optional row renders the legacy `config.statusLine`
// format-string (id `status-line`) for users who depended on the
// custom format. Hideable via `statusBar.hidden`.

import React, { useEffect, useState, useRef } from 'react'
import { Box, Text, useStdout } from 'ink'
import { useTheme } from '../../core/theme/context'
import { stringWidth, truncateByWidth } from '../../core/stringWidth'
import { defaultPalette } from '../theme'
import type { StatusLineConfig } from '../../core/config/schema'
import type { SessionGoal } from '../../core/session/types'
import type { TaskManager } from '../../core/tasks/manager'
import { execFirstLine, template, type StatusLineCtx } from './statusLine'

/** Strip CR/LF from a status output so embedded newlines never blow the row layout. */
function stripNewlines(s: string): string {
  return String(s).replace(/[\r\n]+/g, ' ').trim()
}

export type StatusMode = 'idle' | 'running' | 'awaiting-user'
export type StatusLayout = 'dense' | 'compact' | 'oneline'
export type IconMode = 'icon' | 'text'

export type StatusPanelProps = {
  mode: StatusMode
  model: string
  providerId: string
  providerName?: string
  /** Reasoning effort (low/medium/high), undefined when unset. */
  effort?: 'low' | 'medium' | 'high'
  cwd: string
  gitBranch: { branch: string; dirty: boolean } | null
  contextUsed: number
  contextMax: number
  /** Input tokens (for expanded context row). */
  inputTokens?: number
  /** Output tokens (for expanded context row). */
  outputTokens?: number
  /** USD cost. */
  cost: number
  pluginCount: number
  /** Number of session-only plugins (loaded via --plugin-dir). */
  sessionPluginCount: number
  agentInFlight: number
  taskManager?: TaskManager
  /** Segment ids to hide. */
  hiddenSegments: string[]
  /** Layout density. */
  layout: StatusLayout
  /** Icon vs text mode. */
  iconMode?: IconMode
  /** Optional legacy statusLine config, rendered as a 7th row. */
  statusLineConfig?: StatusLineConfig
  /**
   * Session start timestamp (ms). Kept for backward compatibility
   * but no longer used to render elapsed time (time tracking removed
   * in Phase 13 M3).
   */
  startedAt?: number
  /**
   * Iter DDDD — true when the active session is in plan mode
   * (`session.mode === 'plan'`). Renders the `[PLAN MODE]` badge
   * segment so the user has a visible cue that Write/Edit/Bash are
   * gated by PermissionChecker until ExitPlanMode is called. The badge
   * is hidden when false/undefined (idle path stays clean).
   */
  planMode?: boolean
  /** Active thread goal, when set through /goal or restored from session meta. */
  goal?: Pick<SessionGoal, 'objective' | 'status'>
}

function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  const v = n / 1000
  return (Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)) + 'k'
}

/**
 * §4.2.3 — mode badge.
 * Idle mode is intentionally omitted to match claude-status' quiet baseline.
 * Non-idle mode still renders as '⬢ running' or '[running]'.
 */
function modeBadge(mode: StatusMode, iconMode: IconMode): string {
  const label = mode === 'awaiting-user' ? 'awaiting' : mode
  if (iconMode === 'icon') {
    return `⬢ ${label}`
  }
  return `[${label}]`
}

function shortenCwd(cwd: string, maxColumns = 42): string {
  // Truncate from the left so the leaf directory stays visible.
  const home = process.env.HOME
  const display = home && cwd.startsWith(home) ? '~' + cwd.slice(home.length) : cwd
  return truncateLeftByWidth(display, maxColumns)
}

function truncateLeftByWidth(text: string, maxColumns: number): string {
  if (stringWidth(text) <= maxColumns) return text
  const budget = Math.max(0, maxColumns - stringWidth('…'))
  let out = ''
  let used = 0
  const segments = Array.from(new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text), part => part.segment)
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i]!
    const width = stringWidth(segment)
    if (used + width > budget) break
    out = segment + out
    used += width
  }
  return `…${out}`
}

function progressBar(used: number, max: number): string {
  if (max <= 0) return '░'.repeat(10)
  const pct = Math.max(0, Math.min(1, used / max))
  const filled = Math.floor(pct * 10)
  return '█'.repeat(filled) + '░'.repeat(10 - filled)
}

function formatProviderModel(provider: string, model: string, maxColumns: number, effort?: string): string {
  const suffix = effort ? ` ${effort}` : ''
  const separator = ' · '
  const suffixWidth = stringWidth(separator) + stringWidth(suffix)
  const contentBudget = Math.max(12, maxColumns - suffixWidth)
  const modelBudget = Math.min(
    Math.max(10, Math.floor(contentBudget * 0.48)),
    Math.max(10, contentBudget - 8),
  )
  const providerBudget = Math.max(8, contentBudget - modelBudget)
  return `${truncateByWidth(provider, providerBudget)}${separator}${truncateByWidth(model, modelBudget)}${suffix}`
}

function backgroundCount(tm?: TaskManager): number {
  if (!tm) return 0
  return tm.list().filter(t => t.state === 'running' || t.state === 'pending').length
}

function goalLabel(goal: Pick<SessionGoal, 'objective' | 'status'>): string {
  const prefix = goal.status === 'active' ? 'goal' : goal.status
  return `${prefix}: ${goal.objective}`
}

type StatusPart = {
  id: string
  text: string
  compactText?: string
  minimalText?: string
  color: string
  bold?: boolean
}

type RenderedStatusPart = {
  id: string
  text: string
  color: string
  bold?: boolean
  node: React.JSX.Element
}

type LabelMode = 'full' | 'compact' | 'minimal'

function statusLineWidth(parts: readonly RenderedStatusPart[]): number {
  return parts.reduce((total, part, index) => (
    total + stringWidth(part.text) + (index > 0 ? 1 : 0)
  ), 0)
}

function materializeStatusParts(parts: readonly StatusPart[], mode: LabelMode): RenderedStatusPart[] {
  return parts
    .map((part): RenderedStatusPart | null => {
      const text = mode === 'minimal'
        ? part.minimalText ?? part.compactText ?? part.text
        : mode === 'compact'
          ? part.compactText ?? part.text
          : part.text
      if (text.length === 0) return null
      return {
        id: part.id,
        text,
        color: part.color,
        bold: part.bold,
        node: <Text color={part.color} bold={part.bold}>{text}</Text>,
      }
    })
    .filter((part): part is RenderedStatusPart => part !== null)
}

function fitStatusLine(parts: readonly StatusPart[], columns: number): RenderedStatusPart[] {
  if (parts.length === 0) return []
  for (const mode of ['full', 'compact', 'minimal'] as const) {
    const candidate = materializeStatusParts(parts, mode)
    if (statusLineWidth(candidate) <= columns) return candidate
  }

  const dropPriority = ['cost', 'counts', 'git', 'cwd', 'mode', 'plan', 'goal']
  let out = materializeStatusParts(parts, 'minimal')
  for (const id of dropPriority) {
    if (statusLineWidth(out) <= columns) break
    const next = out.filter(part => part.id !== id)
    if (next.length !== out.length) out = next
  }
  if (statusLineWidth(out) <= columns) return out

  const truncated = out.map(part => {
    if (part.id !== 'model' && part.id !== 'context') return part
    const reserveForOthers = out
      .filter(p => p.id !== part.id)
      .reduce((total, p) => total + stringWidth(p.text) + 1, 0)
    const budget = Math.max(part.id === 'context' ? 10 : 12, columns - reserveForOthers)
    const text = truncateByWidth(part.text, budget)
    return {
      ...part,
      text,
      node: <Text color={part.color} bold={part.bold}>{text}</Text>,
    }
  })
  if (statusLineWidth(truncated) <= columns) return truncated

  return out
}

export function StatusPanel(props: StatusPanelProps): React.JSX.Element | null {
  const theme = useTheme()
  const tColors = theme.colors
  const muted = tColors.fgMuted ?? defaultPalette.fgMuted
  const accent = tColors.primary ?? defaultPalette.primary
  const warn = tColors.warn ?? defaultPalette.warn
  const error = tColors.error ?? defaultPalette.error
  const success = tColors.success ?? defaultPalette.success

  const { stdout } = useStdout()
  const columns = stdout?.columns ?? 80
  const contentColumns = Math.max(1, columns - 2)
  const iconMode: IconMode = props.iconMode ?? 'icon'

  const hidden = new Set(props.hiddenSegments ?? [])

  // Background task count refresh when TaskManager fires `change`.
  const [, setBgTick] = useState(0)
  useEffect(() => {
    if (!props.taskManager) return
    return props.taskManager.on('change', () => setBgTick(t => t + 1))
  }, [props.taskManager])

  // Optional statusLine command output.
  const [cmdOut, setCmdOut] = useState<string | null>(null)
  const cmdErrLogged = useRef(false)
  useEffect(() => {
    const cmd = props.statusLineConfig?.command
    // P2 #40 — reset the error-logging guard whenever the command itself
    // changes so a fresh failure on a new command logs once.
    cmdErrLogged.current = false
    if (!cmd) {
      setCmdOut(null)
      return
    }
    const interval = props.statusLineConfig?.intervalMs ?? 5000
    let cancelled = false
    const run = async () => {
      try {
        const out = await execFirstLine(cmd)
        if (cancelled) return
        if (out === '?' && !cmdErrLogged.current) {
          cmdErrLogged.current = true
          process.stderr.write(`[statusline] command error: ${cmd}\n`)
        }
        // P1 #28 — strip embedded CR/LF so multi-line command output
        // doesn't break the status row layout.
        setCmdOut(stripNewlines(out))
      } catch {
        if (!cancelled) setCmdOut('?')
      }
    }
    void run()
    const id = setInterval(run, interval)
    return () => { cancelled = true; clearInterval(id) }
  }, [props.statusLineConfig?.command, props.statusLineConfig?.intervalMs])

  // ---- Compute segment text (id-keyed) ----
  const ctxPct = props.contextMax > 0 ? props.contextUsed / props.contextMax : 0
  const ctxColor = ctxPct >= 0.8 ? error : ctxPct >= 0.6 ? warn : success
  const dirtyMark = props.gitBranch?.dirty ? '●' : ''
  const branchText = props.gitBranch?.branch
    ? `${props.gitBranch.branch}${dirtyMark}`
    : null
  const cwdBudget = contentColumns < 60 ? Math.max(16, Math.floor(contentColumns * 0.42)) : 42
  const providerLabel = (props.providerName?.trim() || props.providerId || '—').trim()

  // Also accept 'cost-time' in hidden set for backward compat (maps to 'cost').
  const effectiveHidden = new Set<string>()
  for (const h of hidden) {
    effectiveHidden.add(h === 'cost-time' ? 'cost' : h)
  }

  const visibleIds = ['mode', 'plan', 'cwd', 'model', 'context', 'cost', 'counts', 'goal']
    .filter(id => !effectiveHidden.has(id))
  const showStatusLineRow = !!props.statusLineConfig && !hidden.has('status-line')

  // Compute status-line text once (template only — command output appended separately).
  const renderStatusLineRow = (): React.JSX.Element => {
    const ctx: StatusLineCtx = {
      provider: providerLabel,
      model: props.model,
      ctxPct: ctxPct * 100,
      cost: props.cost,
      plugins: props.pluginCount,
      tasks: backgroundCount(props.taskManager),
      branch: props.gitBranch?.branch ?? null,
    }
    // P1 #28 — strip CR/LF from both template output and command output
    // before composing the status line.
    const tplOut = stripNewlines(template(props.statusLineConfig?.format, ctx))
    const display = cmdOut !== null ? `${tplOut} ${cmdOut}` : tplOut
    return <Text color={muted}>{display}</Text>
  }

  const has = (id: string): boolean => visibleIds.includes(id)
  const plugins = props.pluginCount + (props.sessionPluginCount > 0 ? props.sessionPluginCount : 0)
  const bg = backgroundCount(props.taskManager)
  const hasCounts = plugins > 0 || props.agentInFlight > 0 || bg > 0
  const countText = [
    plugins > 0 ? `${plugins} plugins` : null,
    props.agentInFlight > 0 ? `${props.agentInFlight} agents` : null,
    bg > 0 ? `${bg} bg` : null,
  ].filter((x): x is string => x !== null).join(' ')
  const contextTitle = props.contextMax > 0
    ? `${fmtTokens(props.contextUsed)}/${fmtTokens(props.contextMax)}`
    : ''
  const contextPressure =
    ctxPct >= 0.9 ? 'compact now'
      : ctxPct >= 0.8 ? 'compact soon'
      : null
  const contextText = [
    `∴ context: ${progressBar(props.contextUsed, props.contextMax)} ${Math.floor(ctxPct * 100)}%`,
    contextTitle.length > 0 ? contextTitle : null,
    contextPressure,
  ].filter((x): x is string => x !== null).join(' ')
  const contextCompactText = [
    `∴ context: ${progressBar(props.contextUsed, props.contextMax)} ${Math.floor(ctxPct * 100)}%`,
    contextPressure,
  ].filter((x): x is string => x !== null).join(' ')
  const contextMinimalText = [
    `∴ context: ${Math.floor(ctxPct * 100)}%`,
    contextPressure,
  ].filter((x): x is string => x !== null).join(' ')
  const envParts: StatusPart[] = []
  const detailParts: StatusPart[] = []

  const modeText = modeBadge(props.mode, iconMode)
  if (has('mode') && props.mode !== 'idle') detailParts.push({ id: 'mode', text: modeText, compactText: modeText, minimalText: modeText, color: accent })
  if (has('plan') && props.planMode) detailParts.push({ id: 'plan', text: '[PLAN MODE]', compactText: '[PLAN MODE]', minimalText: '[PLAN MODE]', color: warn, bold: true })
  if (has('model')) {
    detailParts.push({
      id: 'model',
      text: formatProviderModel(providerLabel, props.model, Math.max(22, Math.floor(contentColumns * 0.58)), props.effort),
      compactText: formatProviderModel(providerLabel, props.model, Math.max(20, Math.floor(contentColumns * 0.5)), props.effort),
      minimalText: formatProviderModel(providerLabel, props.model, Math.max(18, Math.floor(contentColumns * 0.44)), props.effort),
      color: muted,
    })
  }
  if (has('goal') && props.goal && props.goal.status !== 'complete') {
    const goalBudget = Math.max(32, Math.floor(contentColumns * 0.42))
    const text = truncateByWidth(goalLabel(props.goal), goalBudget)
    const compactText = truncateByWidth(goalLabel(props.goal), Math.max(28, Math.floor(contentColumns * 0.36)))
    const color = props.goal.status === 'blocked' ? warn : muted
    detailParts.push({ id: 'goal', text, compactText, minimalText: compactText, color })
  }
  if (has('cwd')) {
    const cwdText = shortenCwd(props.cwd, cwdBudget)
    envParts.push({ id: 'cwd', text: cwdText, compactText: shortenCwd(props.cwd, Math.max(12, Math.floor(contentColumns * 0.38))), minimalText: shortenCwd(props.cwd, Math.max(12, Math.floor(contentColumns * 0.28))), color: accent })
  }
  if (has('cwd') && branchText) envParts.push({ id: 'git', text: branchText, compactText: branchText, minimalText: branchText, color: props.gitBranch?.dirty ? warn : muted })
  if (has('cost') && props.cost > 0) {
    const text = `$${props.cost.toFixed(4)}`
    detailParts.push({ id: 'cost', text, compactText: text, minimalText: text, color: muted })
  }
  if (has('counts') && hasCounts) detailParts.push({ id: 'counts', text: countText, compactText: countText, minimalText: countText, color: muted })
  if (has('context')) {
    envParts.push({
      id: 'context',
      text: contextText,
      compactText: contextCompactText,
      minimalText: contextMinimalText,
      color: ctxColor,
    })
  }

  if (envParts.length === 0 && detailParts.length === 0 && !showStatusLineRow) return null

  const envLine = fitStatusLine(envParts, contentColumns)
  const detailLine = fitStatusLine(detailParts, contentColumns)

  return (
    <Box flexDirection="column" paddingX={1} flexShrink={0}>
      {envLine.length > 0 && <Box height={1} overflow="hidden">
        {envLine.map((s, i) => (
          <Box key={s.id} marginLeft={i > 0 ? 1 : 0} flexShrink={0}>
            {s.node}
          </Box>
        ))}
      </Box>}
      {detailLine.length > 0 && <Box height={1} overflow="hidden">
        {detailLine.map((s, i) => (
          <Box key={s.id} marginLeft={i > 0 ? 1 : 0} flexShrink={0}>
            {s.node}
          </Box>
        ))}
      </Box>}
      {showStatusLineRow && <Box height={1} overflow="hidden">{renderStatusLineRow()}</Box>}
    </Box>
  )
}
