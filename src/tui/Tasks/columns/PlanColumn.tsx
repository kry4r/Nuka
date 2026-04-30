// src/tui/Tasks/columns/PlanColumn.tsx
import * as React from 'react'
import { Box, Text } from 'ink'
import type { Row } from '../columnReducer'
import { useTheme } from '../../../core/theme/context'
import { defaultPalette } from '../../theme'

export function PlanColumn(props: { rows: Row[]; focused: boolean; selectedIndex?: number }): React.ReactNode {
  const theme = useTheme()
  const borderColor = props.focused ? (theme.colors.primary ?? defaultPalette.primary) : (theme.colors.fgMuted ?? defaultPalette.fgMuted)
  return (
    <Box flexDirection="column" minWidth={18} flexGrow={1} borderStyle="round" borderColor={borderColor}>
      <Text bold>Plan</Text>
      {props.rows.length === 0
        ? <Text dimColor>(no plan)</Text>
        : props.rows.map((r, i) => (
            <Text key={r.id} color={props.focused && props.selectedIndex === i ? (theme.colors.primary ?? defaultPalette.primary) : undefined}>{r.primary}</Text>
          ))
      }
    </Box>
  )
}
