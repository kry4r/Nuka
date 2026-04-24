// src/tui/StatusBar/StatusBar.tsx
import React from 'react'
import { Box } from 'ink'
import {
  ModelSeg, CwdSeg, GitSeg, CtxSeg, CostSeg, McpSeg, AutoSeg, QueueSeg, Sep,
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
}

export function StatusBar(p: StatusBarProps): React.JSX.Element {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <ModelSeg model={p.model} /><Sep />
        <CwdSeg cwd={p.cwd} /><Sep />
        {p.gitBranch && (<><GitSeg {...p.gitBranch} /><Sep /></>)}
        <CtxSeg used={p.contextUsed} max={p.contextMax} /><Sep />
        <CostSeg cost={p.cost} />
      </Box>
      <Box>
        <McpSeg count={p.mcpCount} health={p.mcpHealth} /><Sep />
        <AutoSeg mode={p.autoMode} />
        {p.queueLength > 0 && <><Sep /><QueueSeg n={p.queueLength} /></>}
        <Box flexGrow={1} />
        <HintLine mode={p.mode} />
      </Box>
    </Box>
  )
}
