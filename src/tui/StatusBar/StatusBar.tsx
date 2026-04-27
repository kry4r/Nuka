// src/tui/StatusBar/StatusBar.tsx
import React from 'react'
import { Box, Text } from 'ink'
import { defaultPalette as P } from '../theme'
import {
  ModelSeg, CwdSeg, GitSeg, CtxSeg, CostSeg, McpSeg, AutoSeg, QueueSeg, SessionPluginSeg,
} from './Segments'
import { HintLine, type HintMode } from './HintLine'

export type StatusBarProps = {
  model: string
  cwd: string
  gitBranch: { branch: string; dirty: boolean } | null
  contextUsed: number
  contextMax: number
  cost: number
  mcpCount: number
  mcpHealth: 'ok' | 'degraded' | 'none'
  autoMode: 'off' | `on(${number})`
  queueLength: number
  mode: HintMode
  /** Number of session plugins loaded via --plugin-dir */
  sessionPluginCount?: number
  /** Phase 11 — segment names hidden via /status-bar. */
  hiddenSegments?: string[]
}

function Pipe(): React.JSX.Element {
  return <Text color={P.muted}> │ </Text>
}

function Label({ text, color }: { text: string; color: string }): React.JSX.Element {
  return (
    <Box width={9}>
      <Text color={color} bold>{text}</Text>
    </Box>
  )
}

export function StatusBar(p: StatusBarProps): React.JSX.Element {
  const hidden = new Set(p.hiddenSegments ?? [])
  const show = (name: string) => !hidden.has(name)

  // Pre-compute which segments will appear in each row; if a row has none,
  // skip rendering the row entirely so the bar collapses cleanly.
  const idShow = { model: show('model'), cwd: show('cwd'), git: show('git') && !!p.gitBranch }
  const rtShow = { ctx: show('ctx'), cost: show('cost'), mcp: show('mcp') }
  const stShow = {
    auto: show('auto') && p.autoMode !== 'off',
    queue: show('queue') && p.queueLength > 0,
    plugins: show('plugins') && (p.sessionPluginCount ?? 0) > 0,
  }
  const rowIdActive = idShow.model || idShow.cwd || idShow.git
  const rowRtActive = rtShow.ctx || rtShow.cost || rtShow.mcp
  const rowStActive = stShow.auto || stShow.queue || stShow.plugins

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={P.muted}
      borderTop
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      paddingX={1}
    >
      {rowIdActive && (
        <Box>
          <Label text="session" color={P.primary} />
          {idShow.model && <ModelSeg model={p.model} />}
          {idShow.model && idShow.cwd && <Pipe />}
          {idShow.cwd && <CwdSeg cwd={p.cwd} />}
          {idShow.git && <Pipe />}
          {idShow.git && p.gitBranch && <GitSeg {...p.gitBranch} />}
        </Box>
      )}

      {rowRtActive && (
        <Box>
          <Label text="runtime" color={P.accent} />
          {rtShow.ctx && <CtxSeg used={p.contextUsed} max={p.contextMax} />}
          {rtShow.ctx && rtShow.cost && <Pipe />}
          {rtShow.cost && <CostSeg cost={p.cost} />}
          {(rtShow.ctx || rtShow.cost) && rtShow.mcp && <Pipe />}
          {rtShow.mcp && <McpSeg count={p.mcpCount} health={p.mcpHealth} />}
        </Box>
      )}

      {rowStActive && (
        <Box>
          <Label text="state" color={P.warn} />
          {stShow.auto && <AutoSeg mode={p.autoMode} />}
          {stShow.auto && stShow.queue && <Pipe />}
          {stShow.queue && <QueueSeg n={p.queueLength} />}
          {(stShow.auto || stShow.queue) && stShow.plugins && <Pipe />}
          {stShow.plugins && <SessionPluginSeg count={p.sessionPluginCount!} />}
        </Box>
      )}

      {show('hint') && (
        <Box>
          <Label text="hint" color={P.muted} />
          <HintLine mode={p.mode} />
        </Box>
      )}
    </Box>
  )
}
