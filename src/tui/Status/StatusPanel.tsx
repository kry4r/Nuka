// src/tui/Status/StatusPanel.tsx
//
// Phase 12 §4.5 — the unified Status zone. Replaces the prior
// StatusBar + Hud + StatusLine triad. Renders six fixed segments,
// each with a stable id (mode/model/cwd/context/cost-time/counts);
// `config.statusBar.hidden` filters by id and `statusBar.layout`
// selects between three densities:
//   - dense   (default): six rows, one per segment
//   - compact: two rows, fold pairs
//   - oneline: single line, ' · ' separated
//
// Narrow-terminal degradation (<80 cols): dense -> compact,
// compact -> oneline, oneline unchanged. Automatic, not configurable.
//
// A 7th optional row renders the legacy `config.statusLine`
// format-string (id `status-line`) for users who depended on the
// custom format. Hideable via `statusBar.hidden`.

import React, { useEffect, useState, useRef } from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../../core/theme/context'
import { defaultPalette } from '../theme'
import { useTerminalSize } from '../hooks/useTerminalSize'
import type { StatusLineConfig } from '../../core/config/schema'
import type { TaskManager } from '../../core/tasks/manager'
import { execFirstLine, template, type StatusLineCtx } from './statusLine'

export type StatusMode = 'idle' | 'running' | 'awaiting-user' | 'primed-quit'
export type StatusLayout = 'dense' | 'compact' | 'oneline'

export type StatusPanelProps = {
  mode: StatusMode
  model: string
  providerId: string
  cwd: string
  gitBranch: { branch: string; dirty: boolean } | null
  contextUsed: number
  contextMax: number
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
  /** Optional legacy statusLine config, rendered as a 7th row. */
  statusLineConfig?: StatusLineConfig
  /** Session start timestamp (ms). Used to compute elapsed wall time. */
  startedAt: number
}

const NARROW_THRESHOLD = 80

function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  const v = n / 1000
  return (Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)) + 'k'
}

function modeBadge(mode: StatusMode): string {
  switch (mode) {
    case 'idle': return '⬢ idle'
    case 'running': return '⬢ running'
    case 'awaiting-user': return '⬢ awaiting'
    case 'primed-quit': return '⬢ primed-quit'
  }
}

function fmtElapsed(startedAt: number): string {
  const ms = Math.max(0, Date.now() - startedAt)
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const remSec = sec % 60
  if (min < 60) return `${min}m${remSec.toString().padStart(2, '0')}s`
  const hr = Math.floor(min / 60)
  const remMin = min % 60
  return `${hr}h${remMin.toString().padStart(2, '0')}m`
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

  const { columns } = useTerminalSize()
  const layout = autoDegrade(props.layout, columns)

  const hidden = new Set(props.hiddenSegments ?? [])

  // Re-render once a second so elapsed time stays live.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

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
        setCmdOut(out)
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

  const segments: Array<{ id: string; render: () => React.JSX.Element }> = [
    {
      id: 'mode',
      render: () => <Text color={accent} bold>{modeBadge(props.mode)}</Text>,
    },
    {
      id: 'model',
      render: () => <Text color={muted}>{props.model} · {props.providerId}</Text>,
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
        <Text color={ctxColor}>
          {progressBar(props.contextUsed, props.contextMax)}  {fmtTokens(props.contextUsed)}/{fmtTokens(props.contextMax)}
        </Text>
      ),
    },
    {
      id: 'cost-time',
      render: () => (
        <Text color={accent}>${props.cost.toFixed(4)}  ⏱ {fmtElapsed(props.startedAt)}</Text>
      ),
    },
    {
      id: 'counts',
      render: () => {
        const plugins = props.pluginCount
          + (props.sessionPluginCount > 0 ? props.sessionPluginCount : 0)
        const bg = backgroundCount(props.taskManager)
        return (
          <Text color={muted}>⚙ {plugins} plugins · {props.agentInFlight} agents · {bg} background</Text>
        )
      },
    },
  ]
  const visible = segments.filter(s => !hidden.has(s.id))
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
    const tplOut = template(props.statusLineConfig?.format, ctx)
    const display = cmdOut !== null ? `${tplOut} ${cmdOut}` : tplOut
    return <Text color={muted}>{display}</Text>
  }

  if (visible.length === 0 && !showStatusLineRow) return null

  // ---- Render by layout ----
  if (layout === 'dense') {
    return (
      <Box flexDirection="column" paddingX={1}>
        {visible.map(s => (
          <Box key={s.id}>{s.render()}</Box>
        ))}
        {showStatusLineRow && <Box>{renderStatusLineRow()}</Box>}
      </Box>
    )
  }

  if (layout === 'compact') {
    // Fold pairs: row 1 = mode/model/cwd/context, row 2 = cost-time/counts
    const row1Ids = new Set(['mode', 'model', 'cwd', 'context'])
    const row1 = visible.filter(s => row1Ids.has(s.id))
    const row2 = visible.filter(s => !row1Ids.has(s.id))
    const sep = <Text color={muted}> · </Text>
    return (
      <Box flexDirection="column" paddingX={1}>
        {row1.length > 0 && (
          <Box>
            {row1.map((s, i) => (
              <React.Fragment key={s.id}>
                {i > 0 && sep}
                {s.render()}
              </React.Fragment>
            ))}
          </Box>
        )}
        {row2.length > 0 && (
          <Box>
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
    <Box paddingX={1}>
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
