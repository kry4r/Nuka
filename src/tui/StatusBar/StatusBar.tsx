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
}

/** Coloured pipe between segments inside one group. */
function Pipe(): React.JSX.Element {
  return <Text color={P.muted}> │ </Text>
}

/** Section label shown left-most on each row, colour-coded per category. */
function Label({ text, color }: { text: string; color: string }): React.JSX.Element {
  return (
    <Box width={9}>
      <Text color={color} bold>{text}</Text>
    </Box>
  )
}

export function StatusBar(p: StatusBarProps): React.JSX.Element {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={P.muted} borderTop borderBottom={false} borderLeft={false} borderRight={false} paddingX={1}>
      {/* Identity row — green */}
      <Box>
        <Label text="session" color={P.primary} />
        <ModelSeg model={p.model} /><Pipe />
        <CwdSeg cwd={p.cwd} />
        {p.gitBranch && (<><Pipe /><GitSeg {...p.gitBranch} /></>)}
      </Box>

      {/* Runtime row — accent (cost colour) */}
      <Box>
        <Label text="runtime" color={P.accent} />
        <CtxSeg used={p.contextUsed} max={p.contextMax} /><Pipe />
        <CostSeg cost={p.cost} /><Pipe />
        <McpSeg count={p.mcpCount} health={p.mcpHealth} />
      </Box>

      {/* State row — yellow when something is active, muted when idle */}
      {(p.autoMode !== 'off' || p.queueLength > 0 || (p.sessionPluginCount ?? 0) > 0) && (
        <Box>
          <Label text="state" color={P.warn} />
          <AutoSeg mode={p.autoMode} />
          {p.queueLength > 0 && (<><Pipe /><QueueSeg n={p.queueLength} /></>)}
          {(p.sessionPluginCount ?? 0) > 0 && (
            <><Pipe /><SessionPluginSeg count={p.sessionPluginCount!} /></>
          )}
        </Box>
      )}

      {/* Hint row — muted */}
      <Box>
        <Label text="hint" color={P.muted} />
        <HintLine mode={p.mode} />
      </Box>
    </Box>
  )
}
