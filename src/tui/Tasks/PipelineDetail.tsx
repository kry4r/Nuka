// src/tui/Tasks/PipelineDetail.tsx
import * as React from 'react'
import { Box, Text } from 'ink'
import { dagLayout } from './dagLayout'
import { useTheme } from '../../core/theme/context'
import { defaultPalette } from '../theme'

type Node = { id: string; agentName: string; status: string; parents: string[] }

export function PipelineDetail(p: { pipelineId: string; nodes: Node[] }): React.ReactNode {
  const theme = useTheme()
  const primaryColor = theme.colors.primary ?? defaultPalette.primary
  const placed = React.useMemo(() => {
    try { return dagLayout(p.nodes.map(n => ({ id: n.id, parents: n.parents }))) }
    catch { return null }
  }, [p.nodes])
  if (!placed) return <Text color="yellow">Cycle detected — pipeline corrupt</Text>
  const maxLevel = Math.max(...placed.map(n => n.level))
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={primaryColor}>
      <Text bold>Pipeline {p.pipelineId}</Text>
      {Array.from({ length: maxLevel + 1 }, (_, lv) => (
        <Box key={lv} flexDirection="row">
          {placed.filter(n => n.level === lv).map(pn => {
            const node = p.nodes.find(n => n.id === pn.id)!
            const symbol = node.status === 'completed' ? '✓' : node.status === 'running' ? '▶' : node.status === 'failed' ? '✗' : '○'
            return (
              <Box key={pn.id} marginRight={2} borderStyle="single" padding={0}>
                <Text>{symbol} {node.agentName}</Text>
              </Box>
            )
          })}
        </Box>
      ))}
    </Box>
  )
}
