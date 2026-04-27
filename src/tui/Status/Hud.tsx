// src/tui/Status/Hud.tsx
//
// Phase 7 spec §5.5 status HUD. Renders one bottom row in the format:
//
//   [provider/model]  ctx 12.4% (24.8k/200k)   ▲in 1.2k ▼out 0.4k   $0.0721   plugins 3 · agents 2 in-flight   git:main
//
// The cost tracker is optional; if not provided we render `$--` and skip
// the per-token-cost calculation (graceful degrade until M2 lands on main).

import React from 'react'
import { Box, Text } from 'ink'
import { defaultPalette } from '../theme'
import { useTheme } from '../../core/theme/context'
import { useUsage, type UsageSource } from './useUsage'
import type { TaskManager } from '../../core/tasks/manager'

export type CostTrackerLike = {
  current(sessionId: string): { inputTokens?: number; outputTokens?: number; usd?: number } | null
} | undefined

export type HudProps = {
  providerId: string
  model: string
  sessionId: string
  contextUsed: number
  contextMax: number
  inputTokens: number
  outputTokens: number
  pluginCount: number
  agentInFlight: number
  gitBranch: string | null
  /** Optional cost tracker (M2). If absent, the dollar field renders `$--`. */
  costTracker?: CostTrackerLike
  /** Re-render trigger (e.g. agent event tick). */
  tick?: unknown
  /** Phase 10 §4.3 — when set, render `tasks N` while N>0. */
  taskManager?: TaskManager
}

function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  const v = n / 1000
  // Whole-thousand values render without a trailing `.0` (e.g. 200000 → "200k").
  return (Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)) + 'k'
}

function fmtUsd(usd: number | undefined): string {
  if (usd === undefined) return '$--'
  return '$' + usd.toFixed(4)
}

class HudErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: string },
  { error: Error | null }
> {
  override state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  override render() {
    if (this.state.error) return <Text color={defaultPalette.error}>{this.props.fallback}</Text>
    return this.props.children
  }
}

export function Hud(props: HudProps): React.JSX.Element {
  // Prefer theme context colors; fall back to the static default palette so
  // legacy tests (mounted without a ThemeProvider) continue to pass.
  const theme = useTheme()

  // Phase 10 §4.3 — re-render on task state changes so `tasks N` stays live.
  const [taskTick, setTaskTick] = React.useState(0)
  React.useEffect(() => {
    if (!props.taskManager) return
    return props.taskManager.on('change', () => setTaskTick(t => t + 1))
  }, [props.taskManager])
  void taskTick

  const runningTasks = props.taskManager
    ? props.taskManager.list().filter(t => t.state === 'running').length
    : 0
  const P = {
    primary: theme.colors.accent,
    muted: theme.colors.muted,
    warn: theme.colors.warn,
    error: theme.colors.error,
  }

  const source: UsageSource = () => {
    let usd: number | undefined = undefined
    try {
      const agg = props.costTracker?.current(props.sessionId)
      if (agg && typeof agg.usd === 'number') usd = agg.usd
    } catch {
      // ignore — fall back to undefined
    }
    return {
      inputTokens: props.inputTokens,
      outputTokens: props.outputTokens,
      contextUsed: props.contextUsed,
      contextMax: props.contextMax,
      costUsd: usd,
    }
  }
  const snap = useUsage(source, props.tick)
  const ctxPct = props.contextMax > 0 ? (snap.contextUsed / props.contextMax) * 100 : 0
  const ctxColor = ctxPct > 95 ? P.error : ctxPct > 80 ? P.warn : P.muted
  const branch = props.gitBranch ?? 'no-git'

  // Render as a single inline Text node so under narrow terminals the
  // segments simply wrap onto the next line rather than getting clipped
  // to fixed columns by flex layout.
  return (
    <HudErrorBoundary fallback="[hud render error]">
      <Box paddingX={1}>
        <Text>
          <Text color={P.primary}>[{props.providerId}/{props.model}]</Text>
          {'  '}
          <Text color={ctxColor}>
            ctx {ctxPct.toFixed(1)}% ({fmtTokens(snap.contextUsed)}/{fmtTokens(props.contextMax)})
          </Text>
          {'   '}
          <Text color={P.muted}>▲in {fmtTokens(snap.inputTokens)} ▼out {fmtTokens(snap.outputTokens)}</Text>
          {'   '}
          <Text color={P.primary}>{fmtUsd(snap.costUsd)}</Text>
          {'   '}
          <Text color={P.muted}>plugins {props.pluginCount} · agents {props.agentInFlight} in-flight</Text>
          {runningTasks > 0 && (
            <>
              {'   '}
              <Text color={P.primary}>tasks {runningTasks}</Text>
            </>
          )}
          {'   '}
          <Text color={P.muted}>git:{branch}</Text>
        </Text>
      </Box>
    </HudErrorBoundary>
  )
}
