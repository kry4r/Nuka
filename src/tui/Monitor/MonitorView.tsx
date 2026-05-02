// src/tui/Monitor/MonitorView.tsx
//
// Phase 14b — Full-screen monitor dashboard with DAG / Timeline / Tokens tabs.
import * as React from 'react'
import { Box, Text, useInput } from 'ink'
import { DagView } from './DagView'
import { TimelineView } from './TimelineView'
import { TokensView } from './TokensView'
import type { TimelineLane } from './bucketTimeline'
import { useTheme } from '../../core/theme/context'
import { defaultPalette } from '../theme'
import { useTerminalSize } from '../hooks/useTerminalSize'

type Tab = 'dag' | 'timeline' | 'tokens'

const TAB_ORDER: readonly Tab[] = ['dag', 'timeline', 'tokens']

export type MonitorViewProps = {
  events: Array<{ t: number; topic: TimelineLane }>
  dagNodes: Array<{ id: string; agentName: string; status: string; parents: string[] }>
  agentUsage?: Array<{ agentName: string; inputTokens: number; outputTokens: number }>
  cols?: number
  onClose?: () => void
}

export function MonitorView(p: MonitorViewProps): React.ReactNode {
  const theme = useTheme()
  const fgMutedColor = theme.colors.fgMuted ?? defaultPalette.fgMuted
  const warnColor = theme.colors.warn ?? defaultPalette.warn
  const [tab, setTab] = React.useState<Tab>('dag')
  const term = useTerminalSize()
  const cols = p.cols ?? term.columns

  useInput((_input, key) => {
    if (key.tab) {
      setTab(prev => {
        const idx = TAB_ORDER.indexOf(prev)
        return TAB_ORDER[(idx + 1) % TAB_ORDER.length] ?? 'dag'
      })
      return
    }
    if (key.escape) {
      p.onClose?.()
    }
  })

  if (cols < 80) return <Text color={warnColor}>Terminal too narrow ({cols} cols) — Monitor needs ≥ 80.</Text>
  return (
    <Box flexDirection="column">
      <Box>
        <Text bold inverse={tab === 'dag'}> DAG </Text>
        <Text bold inverse={tab === 'timeline'}> Timeline </Text>
        <Text bold inverse={tab === 'tokens'}> Tokens </Text>
        <Text color={fgMutedColor}>  [Tab] cycle · [Esc] close</Text>
      </Box>
      {tab === 'dag'      && <DagView nodes={p.dagNodes} />}
      {tab === 'timeline' && <TimelineView events={p.events} />}
      {tab === 'tokens'   && <TokensView usage={p.agentUsage ?? []} />}
    </Box>
  )
}
