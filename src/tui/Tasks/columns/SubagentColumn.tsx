// src/tui/Tasks/columns/SubagentColumn.tsx
import * as React from 'react'
import { Box, Text } from 'ink'
import type { Row } from '../columnReducer'
import { useTheme } from '../../../core/theme/context'
import { defaultPalette } from '../../theme'

export function SubagentColumn(props: { rows: Row[]; focused: boolean; selectedIndex?: number }): React.ReactNode {
  const theme = useTheme()
  const borderColor = props.focused ? (theme.colors.primary ?? defaultPalette.primary) : (theme.colors.fgMuted ?? defaultPalette.fgMuted)
  const runningColor = theme.colors.accentWarm ?? defaultPalette.accentWarm
  const agentColors = [
    theme.colors.accentCool ?? defaultPalette.accentCool,
    theme.colors.accentInfo ?? defaultPalette.accentInfo,
    theme.colors.accentWarm ?? defaultPalette.accentWarm,
    theme.colors.primarySoft ?? defaultPalette.primarySoft,
    theme.colors.success ?? defaultPalette.success,
    theme.colors.warn ?? defaultPalette.warn,
  ]
  return (
    <Box flexDirection="column" minWidth={18} flexGrow={1} borderStyle="round" borderColor={borderColor}>
      <Text bold>Subagents</Text>
      {props.rows.length === 0
        ? <Text dimColor>(no subagent)</Text>
        : props.rows.map((r, i) => (
            <Box key={r.id} flexDirection="column">
              <Box flexDirection="row" gap={1}>
                {r.status === 'running' && <Text color={runningColor}>●</Text>}
                <Text color={props.focused && props.selectedIndex === i ? (theme.colors.primary ?? defaultPalette.primary) : colorForRow(r.colorKey, agentColors)}>{r.primary}</Text>
              </Box>
              {r.secondary.length > 0 && <Text color={theme.colors.fgMuted ?? defaultPalette.fgMuted} wrap="truncate-end">  {r.secondary}</Text>}
            </Box>
          ))
      }
    </Box>
  )
}

function colorForRow(colorKey: string | undefined, colors: string[]): string | undefined {
  const idx = colorKey?.match(/^agent-(\d+)$/)?.[1]
  if (idx === undefined) return undefined
  return colors[Number(idx) % colors.length]
}
