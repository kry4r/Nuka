// src/tui/Tasks/PlanList.tsx
//
// Phase 12 M3 — Plan section of the Tasks panel.
//
// Renders todo items from a TodoState (created by createTodoStore in
// todoWrite.ts). Only shows `pending`, `in_progress`, and `completed` items.
// Icons:
//   ✓  completed
//   ▶  in_progress
//   ☐  pending
//
// Overflow: items beyond `maxItems` are replaced with "  … +N more".

import React from 'react'
import { Box, Text } from 'ink'
import type { TodoState, Todo } from '../../core/tools/todoWrite'
import { useTheme } from '../../core/theme/context'
import { defaultPalette as P } from '../theme'

const STATUS_ICON: Record<Todo['status'], string> = {
  completed: '✓',
  in_progress: '▶',
  pending: '☐',
}

export type PlanListProps = {
  store: TodoState
  maxItems: number
}

export function PlanList({ store, maxItems }: PlanListProps): React.JSX.Element | null {
  const { colors } = useTheme()
  const items = store.items
  if (items.length === 0) return null

  const visible = items.slice(0, maxItems)
  const overflow = items.length - visible.length

  const STATUS_COLOR: Record<Todo['status'], string> = {
    completed: colors.success ?? P.success,
    in_progress: colors.accentCool ?? P.accentCool,
    pending: colors.fgMuted ?? P.fgMuted,
  }
  const fgColor = colors.fg ?? P.fg
  const fgMuted = colors.fgMuted ?? P.fgMuted
  const titleColor = colors.accentWarm ?? P.accentWarm

  return (
    <Box flexDirection="column">
      <Text color={titleColor} bold>Plan</Text>
      {visible.map((item, i) => (
        <Box key={i} flexDirection="row" gap={1}>
          <Text color={STATUS_COLOR[item.status]}>{STATUS_ICON[item.status]}</Text>
          <Text color={item.status === 'completed' ? fgMuted : fgColor}>{item.title}</Text>
        </Box>
      ))}
      {overflow > 0 && (
        <Text color={fgMuted}>  … +{overflow} more</Text>
      )}
    </Box>
  )
}
