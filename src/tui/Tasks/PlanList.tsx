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

const STATUS_ICON: Record<Todo['status'], string> = {
  completed: '✓',
  in_progress: '▶',
  pending: '☐',
}

const STATUS_COLOR: Record<Todo['status'], string> = {
  completed: 'green',
  in_progress: 'cyan',
  pending: 'gray',
}

export type PlanListProps = {
  store: TodoState
  maxItems: number
}

export function PlanList({ store, maxItems }: PlanListProps): React.JSX.Element | null {
  const items = store.items
  if (items.length === 0) return null

  const visible = items.slice(0, maxItems)
  const overflow = items.length - visible.length

  return (
    <Box flexDirection="column">
      <Text color="yellow" bold>Plan</Text>
      {visible.map((item, i) => (
        <Box key={i} flexDirection="row" gap={1}>
          <Text color={STATUS_COLOR[item.status]}>{STATUS_ICON[item.status]}</Text>
          <Text color={item.status === 'completed' ? 'gray' : 'white'}>{item.title}</Text>
        </Box>
      ))}
      {overflow > 0 && (
        <Text color="gray">  … +{overflow} more</Text>
      )}
    </Box>
  )
}
