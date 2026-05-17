// src/tui/Stats/StatsView.tsx
// Phase 8 §4.2 — two-tab stats view.
//
// Tabs: Overview / Models
// Keys:
//   Tab   — cycle tab
//   r     — cycle range (all / 30d / 7d)
//   Esc   — call onExit

import React, { useState, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'
import { aggregate, type StatsResult, type StatsRange } from '../../core/stats/aggregate'
import { chart } from '../../core/stats/chart'
import { RangeTabs } from './RangeTabs'
import { useTerminalSize } from '../hooks/useTerminalSize'
import { useColors } from '../../core/theme/context'

type Tab = 'overview' | 'models'
const TABS: Tab[] = ['overview', 'models']
const RANGES: StatsRange[] = ['all', '30d', '7d']

// Phase 13 M1 — synchronous empty state eliminates the Loading… placeholder.
// StatsView initialises with zero-valued stats rather than `null` so the
// OverviewTab can render `(no data yet)` immediately without an intermediate
// async flash. aggregate() still runs and replaces this with real data when it
// resolves; but in test environments (and on fresh installs) the user never
// sees a transient "Loading…" string.
const EMPTY_STATS: StatsResult = {
  sessions: 0, tokens: 0, costUsd: 0,
  byModel: new Map(), activeDays: 0, streakDays: 0, peakHour: null,
}

export type StatsViewProps = {
  onExit: () => void
  /** Override $HOME for testing */
  home?: string
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}

function OverviewTab({ stats }: { stats: StatsResult }): React.JSX.Element {
  const colors = useColors()
  if (stats.tokens === 0 && stats.sessions === 0) {
    return <Text color={colors.fgMuted}>(no data yet)</Text>
  }
  const avgTok = stats.sessions > 0 ? Math.round(stats.tokens / stats.sessions) : 0
  const avgUsd = stats.sessions > 0 ? stats.costUsd / stats.sessions : 0
  const peakHr = stats.peakHour !== null ? `${String(stats.peakHour).padStart(2, '0')}:00` : '—'

  const rows: [string, string][] = [
    ['Sessions',      String(stats.sessions)],
    ['Total tokens',  fmtTokens(stats.tokens)],
    ['Total cost',    `$${stats.costUsd.toFixed(2)}`],
    ['Avg/session',   `${fmtTokens(avgTok)} tok / $${avgUsd.toFixed(2)}`],
    ['Active days',   String(stats.activeDays)],
    ['Streak',        `${stats.streakDays}d`],
    ['Peak hr',       peakHr],
  ]
  return (
    <Box flexDirection="column">
      {rows.map(([label, value]) => (
        <Box key={label}>
          <Text>{'  '}</Text>
          <Text color={colors.accentCool}>{label.padEnd(16)}</Text>
          <Text>{value}</Text>
        </Box>
      ))}
    </Box>
  )
}

function ModelsTab({ stats, chartWidth }: { stats: StatsResult; chartWidth: number }): React.JSX.Element {
  const lines = chart(stats.byModel, chartWidth)
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Box key={i}>
          <Text>{'  '}</Text>
          <Text>{line}</Text>
        </Box>
      ))}
    </Box>
  )
}

export function StatsView({ onExit, home }: StatsViewProps): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('overview')
  const [range, setRange] = useState<StatsRange>('all')
  const { columns } = useTerminalSize()
  const colors = useColors()
  // Chart width: clamp to [40, 72]. Subtract 8 cols of chrome — covers
  // SubmenuFrame border(2) + paddingX(2) + StatsView paddingX(2) + safety(2).
  const chartWidth = Math.min(72, Math.max(40, columns - 8))
  // Rule width: same idea but a tighter cap (was hardcoded 48).
  const ruleWidth = Math.min(48, Math.max(8, columns - 4))
  // Phase 13 M1: initialise to EMPTY_STATS (not null) so the component never
  // renders the "Loading…" placeholder — OverviewTab shows "(no data yet)"
  // synchronously and is then replaced by real data once aggregate() resolves.
  const [stats, setStats] = useState<StatsResult>(EMPTY_STATS)

  useEffect(() => {
    let cancelled = false
    // Reset to empty (not null) on range change — avoids Loading… flash.
    setStats(EMPTY_STATS)
    aggregate({ range, home }).then(s => {
      if (!cancelled) setStats(s)
    }).catch(() => {
      if (!cancelled) setStats({ sessions: 0, tokens: 0, costUsd: 0, byModel: new Map(), activeDays: 0, streakDays: 0, peakHour: null })
    })
    return () => { cancelled = true }
  }, [range, home])

  useInput((input, key) => {
    if (key.escape) { onExit(); return }
    if (key.tab || (key.ctrl && input === 'i')) {
      const idx = TABS.indexOf(tab)
      setTab(TABS[(idx + 1) % TABS.length]!)
      return
    }
    if (input === 'r') {
      const idx = RANGES.indexOf(range)
      setRange(RANGES[(idx + 1) % RANGES.length]!)
      return
    }
  })

  const tabLabels = TABS.map(t => {
    const label = t === 'overview' ? 'Overview' : 'Models'
    return tab === t ? `[ ${label} ]` : `  ${label}  `
  }).join('')

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={colors.accentCool} paddingX={1}>
      <Box>
        <Text bold color={colors.accentCool}>Stats  </Text>
        <Text>{tabLabels}</Text>
      </Box>
      <Text>{'─'.repeat(ruleWidth)}</Text>
      <RangeTabs active={range} />
      <Text> </Text>
      {tab === 'overview' ? <OverviewTab stats={stats} /> : <ModelsTab stats={stats} chartWidth={chartWidth} />}
      <Text> </Text>
      <Text color={colors.fgMuted}>Tab: switch tab · r: cycle range · Esc: close</Text>
    </Box>
  )
}
