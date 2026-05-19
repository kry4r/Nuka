// src/tui/Status/StatusPanel.tsx
//
// Phase 13 §4.2 — unified Status zone with two-column dense layout,
// icon/text mode, expanded context row, and no time tracking.
//
// Dense layout: two columns separated by │
//   left  = [mode, model, cwd]
//   right = [context, cost, counts]
//
// Compact layout: two rows
//   row1 = mode/model/cwd/context  · -separated
//   row2 = cost/counts             · -separated
//
// Oneline layout: single line, all segments · -separated.
//
// iconMode: 'icon' (default) uses glyphs ⬢/▰▱/⚙ etc.
//           'text' uses plain labels [idle]/context:/cost: etc.
//
// Narrow-terminal degradation (<80 cols): dense -> compact,
// compact -> oneline. Automatic.
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

const NARROW_THRESHOLD = 80

function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  const v = n / 1000
  return (Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)) + 'k'
}

/**
 * §4.2.3 — mode badge.
 * icon mode: '⬢ idle' / '⬢ running' etc.
 * text mode: '[idle]' / '[running]' etc.
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
  return cwd.length > 40 ? '…' + cwd.slice(cwd.length - 39) : cwd
}

function progressBar(used: number, max: number): string {
  if (max <= 0) return '▱'.repeat(8)
  const pct = Math.max(0, Math.min(1, used / max))
  const filled = Math.round(pct * 8)
  return '▰'.repeat(filled) + '▱'.repeat(8 - filled)
}

function backgroundCount(tm?: TaskManager): number {
  if (!tm) return 0
  return tm.list().filter(t => t.state === 'running' || t.state === 'pending').length
}

function autoDegrade(layout: StatusLayout, columns: number): StatusLayout {
  if (columns >= NARROW_THRESHOLD) return layout
  if (layout === 'dense') return 'compact'
  if (layout === 'compact') return 'oneline'
  return 'oneline'
}

export function StatusPanel(props: StatusPanelProps): React.JSX.Element | null {
  const theme = useTheme()
  const tColors = theme.colors
  const muted = tColors.fgMuted ?? defaultPalette.fgMuted
  const accent = tColors.primary ?? defaultPalette.primary
  const warn = tColors.warn ?? defaultPalette.warn
  const error = tColors.error ?? defaultPalette.error

  const { stdout } = useStdout()
  const columns = stdout?.columns ?? 80
  const layout = autoDegrade(props.layout, columns)
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
  const ctxColor = ctxPct > 0.95 ? error : ctxPct > 0.8 ? warn : muted
  const dirtyMark = props.gitBranch?.dirty ? '●' : ''
  const branchText = props.gitBranch
    ? `${shortenCwd(props.cwd)}  ${props.gitBranch.branch}${dirtyMark}`
    : shortenCwd(props.cwd)

  // Build context line: <bar>  <used>k/<max>k · <pct>% · in:<n>k out:<n>k
  // The 8-char block-fill bar is retained in both icon and text modes per spec §3.
  // In text mode a "context: " prefix is prepended; in icon mode the bar leads.
  const renderContextText = (): string => {
    const bar = progressBar(props.contextUsed, props.contextMax)
    const usedFmt = fmtTokens(props.contextUsed)
    const maxFmt = fmtTokens(props.contextMax)
    const pctFmt = `${Math.round(ctxPct * 100)}%`
    const inTok = props.inputTokens ?? 0
    const outTok = props.outputTokens ?? 0

    if (iconMode === 'icon') {
      return `${bar}  ${usedFmt}/${maxFmt} · ${pctFmt} · in:${fmtTokens(inTok)} out:${fmtTokens(outTok)}`
    }
    // text mode: same bar + data but with a label prefix
    return `context: ${bar}  ${usedFmt}/${maxFmt} · ${pctFmt} · in:${fmtTokens(inTok)} out:${fmtTokens(outTok)}`
  }

  // §4.2.3 counts segment
  const renderCountsText = (): string => {
    const plugins = props.pluginCount
      + (props.sessionPluginCount > 0 ? props.sessionPluginCount : 0)
    const bg = backgroundCount(props.taskManager)
    if (iconMode === 'icon') {
      return `⚙ ${plugins} plugins · ${props.agentInFlight} agents · ${bg} background`
    }
    return `plugins:${plugins} · agents:${props.agentInFlight} · bg:${bg}`
  }

  // P0 #11 — In dense layout the left column is roughly half the width,
  // and the model row also carries provider + optional effort. Pre-truncate
  // the model name so the dense row never wraps.
  // Budget: ~one third of the terminal minus a small allowance for borders
  // and the " · provider" suffix.
  const modelSuffixBudget = props.providerId.length
    + (props.effort ? ` · effort:${props.effort}`.length : 0)
    + 3 // " · " separator before provider.
  const modelBudget = Math.max(8, Math.floor(columns / 3) - modelSuffixBudget)
  const displayModel = layout !== 'oneline'
    ? truncateByWidth(props.model, modelBudget)
    : props.model

  const segments: Array<{ id: string; render: () => React.JSX.Element }> = [
    {
      id: 'mode',
      render: () => <Text color={accent} bold>{modeBadge(props.mode, iconMode)}</Text>,
    },
  ]

  // Iter DDDD — plan-mode badge. Only injected when `planMode === true`
  // so the segment list (and column/row layout maths) stays untouched
  // for the common "normal mode" path. Coloured with `warn` to match
  // the existing dirty-git marker (visually loud, semantically a hint
  // that an enforcement gate is active). Inserted right after `mode`
  // so it appears next to the existing status badge in every layout.
  if (props.planMode) {
    segments.push({
      id: 'plan',
      render: () => <Text color={warn} bold>[PLAN MODE]</Text>,
    })
  }

  segments.push(
    {
      id: 'model',
      render: () => (
        <Text color={muted}>
          {displayModel} · {props.providerId}
          {props.effort ? ` · effort:${props.effort}` : ''}
        </Text>
      ),
    },
    {
      id: 'cwd',
      render: () => (
        <Text color={props.gitBranch?.dirty ? warn : muted}>{branchText}</Text>
      ),
    },
    {
      id: 'context',
      render: () => (
        <Text color={ctxColor}>{renderContextText()}</Text>
      ),
    },
    {
      id: 'cost',
      render: () => {
        if (iconMode === 'icon') {
          return <Text color={accent}>${props.cost.toFixed(4)}</Text>
        }
        return <Text color={accent}>cost:${props.cost.toFixed(4)}</Text>
      },
    },
    {
      id: 'counts',
      render: () => (
        <Text color={muted}>{renderCountsText()}</Text>
      ),
    },
  )

  // Also accept 'cost-time' in hidden set for backward compat (maps to 'cost').
  const effectiveHidden = new Set<string>()
  for (const h of hidden) {
    effectiveHidden.add(h === 'cost-time' ? 'cost' : h)
  }

  const visible = segments.filter(s => !effectiveHidden.has(s.id))
  const showStatusLineRow = !!props.statusLineConfig && !hidden.has('status-line')

  // Compute status-line text once (template only — command output appended separately).
  const renderStatusLineRow = (): React.JSX.Element => {
    const ctx: StatusLineCtx = {
      provider: props.providerId,
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

  if (visible.length === 0 && !showStatusLineRow) return null

  // ---- Render by layout ----

  if (layout === 'dense') {
    // Two-column layout: left=[mode,plan,model,cwd], right=[context,cost,counts]
    // Iter DDDD — `plan` slots into the left column right after `mode`
    // so the badge is visually adjacent to the existing status badge.
    const leftIds = new Set(['mode', 'plan', 'model', 'cwd'])
    const rightIds = new Set(['context', 'cost', 'counts'])
    const leftCol = visible.filter(s => leftIds.has(s.id))
    const rightCol = visible.filter(s => rightIds.has(s.id))

    // If both columns have content, render them side by side.
    if (leftCol.length > 0 && rightCol.length > 0) {
      return (
        <Box flexDirection="column" paddingX={1} flexShrink={0}>
          <Box flexDirection="row">
            <Box flexDirection="column" flexBasis="50%" flexShrink={1}>
              {leftCol.map(s => (
                <Box key={s.id}>{s.render()}</Box>
              ))}
            </Box>
            <Box flexShrink={0}>
              <Text color={muted}> │ </Text>
            </Box>
            <Box flexDirection="column" flexBasis="50%" flexShrink={1}>
              {rightCol.map(s => (
                <Box key={s.id}>{s.render()}</Box>
              ))}
            </Box>
          </Box>
          {showStatusLineRow && <Box>{renderStatusLineRow()}</Box>}
        </Box>
      )
    }
    // Degenerate: only one side has visible segments — fall back to single column.
    return (
      <Box flexDirection="column" paddingX={1} flexShrink={0}>
        {visible.map(s => (
          <Box key={s.id}>{s.render()}</Box>
        ))}
        {showStatusLineRow && <Box>{renderStatusLineRow()}</Box>}
      </Box>
    )
  }

  if (layout === 'compact') {
    // Fold: row1 = mode/plan/model/cwd/context, row2 = cost/counts
    // Iter DDDD — `plan` rides with the mode/model row so a narrow
    // terminal still surfaces the badge above the fold.
    const row1Ids = new Set(['mode', 'plan', 'model', 'cwd', 'context'])
    const row1 = visible.filter(s => row1Ids.has(s.id))
    const row2 = visible.filter(s => !row1Ids.has(s.id))
    const sep = <Text color={muted}> · </Text>
    return (
      <Box flexDirection="column" paddingX={1} flexShrink={0}>
        {row1.length > 0 && (
          <Box flexWrap="wrap" width="100%">
            {row1.map((s, i) => (
              <React.Fragment key={s.id}>
                {i > 0 && sep}
                {s.render()}
              </React.Fragment>
            ))}
          </Box>
        )}
        {row2.length > 0 && (
          <Box flexWrap="wrap" width="100%">
            {row2.map((s, i) => (
              <React.Fragment key={s.id}>
                {i > 0 && sep}
                {s.render()}
              </React.Fragment>
            ))}
          </Box>
        )}
        {showStatusLineRow && <Box>{renderStatusLineRow()}</Box>}
      </Box>
    )
  }

  // oneline
  const sep = <Text color={muted}> · </Text>
  return (
    <Box paddingX={1} flexWrap="wrap" width="100%" flexShrink={0}>
      {visible.map((s, i) => (
        <React.Fragment key={s.id}>
          {i > 0 && sep}
          {s.render()}
        </React.Fragment>
      ))}
      {showStatusLineRow && (
        <>
          {visible.length > 0 && sep}
          {renderStatusLineRow()}
        </>
      )}
    </Box>
  )
}
