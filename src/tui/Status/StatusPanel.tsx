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
import { truncateByWidth } from '../../core/stringWidth'
import { defaultPalette } from '../theme'
import type { StatusLineConfig } from '../../core/config/schema'
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

function shortenCwd(cwd: string): string {
  // Truncate from the left so the leaf directory stays visible.
  const home = process.env.HOME
  const display = home && cwd.startsWith(home) ? '~' + cwd.slice(home.length) : cwd
  return display.length > 42 ? '…' + display.slice(display.length - 41) : display
}

function progressBar(used: number, max: number): string {
  if (max <= 0) return '░'.repeat(10)
  const pct = Math.max(0, Math.min(1, used / max))
  const filled = Math.floor(pct * 10)
  return '█'.repeat(filled) + '░'.repeat(10 - filled)
}

function backgroundCount(tm?: TaskManager): number {
  if (!tm) return 0
  return tm.list().filter(t => t.state === 'running' || t.state === 'pending').length
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
  const providerLabel = (props.providerName?.trim() || props.providerId || '—').trim()
  const providerModel = `${providerLabel}/${truncateByWidth(props.model, Math.max(12, Math.floor(columns * 0.24)))}`

  // Also accept 'cost-time' in hidden set for backward compat (maps to 'cost').
  const effectiveHidden = new Set<string>()
  for (const h of hidden) {
    effectiveHidden.add(h === 'cost-time' ? 'cost' : h)
  }

  const visibleIds = ['mode', 'plan', 'cwd', 'model', 'context', 'cost', 'counts']
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
  const parts: Array<{ id: string; node: React.JSX.Element }> = []

  if (has('mode') && props.mode !== 'idle') parts.push({ id: 'mode', node: <Text color={accent}>{modeBadge(props.mode, iconMode)}</Text> })
  if (has('plan') && props.planMode) parts.push({ id: 'plan', node: <Text color={warn} bold>[PLAN MODE]</Text> })
  if (has('cwd')) parts.push({ id: 'cwd', node: <Text color={accent}>{shortenCwd(props.cwd)}</Text> })
  if (has('cwd') && branchText) parts.push({ id: 'git', node: <Text color={props.gitBranch?.dirty ? warn : muted}>{branchText}</Text> })
  if (has('model')) {
    parts.push({
      id: 'model',
      node: <Text color={muted}>{providerModel}{props.effort ? ` ${props.effort}` : ''}</Text>,
    })
  }
  if (has('cost') && props.cost > 0) parts.push({ id: 'cost', node: <Text color={muted}>${props.cost.toFixed(4)}</Text> })
  if (has('counts') && hasCounts) parts.push({ id: 'counts', node: <Text color={muted}>{countText}</Text> })
  if (has('context')) {
    parts.push({
      id: 'context',
      node: (
        <>
          <Text color={muted}>∴ </Text>
          <Text color={muted}>context: </Text>
          <Text color={ctxColor}>{progressBar(props.contextUsed, props.contextMax)} {Math.floor(ctxPct * 100)}%</Text>
          {contextTitle.length > 0 && <Text color={muted}> {contextTitle}</Text>}
        </>
      ),
    })
  }

  if (parts.length === 0 && !showStatusLineRow) return null

  if (props.layout === 'compact' && columns < 72 && parts.length > 3) {
    const first = parts.filter(p => p.id === 'mode' || p.id === 'plan' || p.id === 'cwd' || p.id === 'git')
    const second = parts.filter(p => !first.includes(p))
    return (
      <Box flexDirection="column" paddingX={1} flexShrink={0}>
        {first.length > 0 && (
          <Box height={1} overflow="hidden">
            {first.map((s, i) => (
              <Box key={s.id} marginLeft={i > 0 ? 1 : 0} flexShrink={s.id === 'cwd' ? 1 : 0}>
                {s.node}
              </Box>
            ))}
          </Box>
        )}
        {second.length > 0 && (
          <Box height={1} overflow="hidden">
            {second.map((s, i) => (
              <Box key={s.id} marginLeft={i > 0 ? 1 : 0} flexShrink={s.id === 'cwd' || s.id === 'model' ? 1 : 0}>
                {s.node}
              </Box>
            ))}
          </Box>
        )}
        {showStatusLineRow && <Box>{renderStatusLineRow()}</Box>}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" paddingX={1} flexShrink={0}>
      <Box height={1} overflow="hidden">
        {parts.map((s, i) => (
          <Box key={s.id} marginLeft={i > 0 ? 1 : 0} flexShrink={s.id === 'cwd' || s.id === 'model' ? 1 : 0}>
            {s.node}
          </Box>
        ))}
      </Box>
      {showStatusLineRow && <Box height={1} overflow="hidden">{renderStatusLineRow()}</Box>}
    </Box>
  )
}
