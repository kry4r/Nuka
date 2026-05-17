// src/tui/Tasks/columns/BackgroundColumn.tsx
import * as React from 'react'
import { Box, Text } from 'ink'
import type { Row } from '../columnReducer'
import { useTheme } from '../../../core/theme/context'
import { defaultPalette } from '../../theme'

export function BackgroundColumn(props: { rows: Row[]; focused: boolean; selectedIndex?: number }): React.ReactNode {
  const theme = useTheme()
  const borderColor = props.focused ? (theme.colors.primary ?? defaultPalette.primary) : (theme.colors.fgMuted ?? defaultPalette.fgMuted)
  const runningColor = theme.colors.accentWarm ?? defaultPalette.accentWarm
  return (
    <Box flexDirection="column" minWidth={18} flexGrow={1} borderStyle="round" borderColor={borderColor}>
      <Text bold>Backgrounds</Text>
      {props.rows.length === 0
        ? <Text dimColor>(no background)</Text>
        : props.rows.map((r, i) => (
            <Box key={r.id} flexDirection="row" gap={1}>
              {r.status === 'running' && <Text color={runningColor}>▶</Text>}
              <Text color={props.focused && props.selectedIndex === i ? (theme.colors.primary ?? defaultPalette.primary) : undefined}>{r.primary}</Text>
            </Box>
          ))
      }
    </Box>
  )
}
