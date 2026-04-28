// src/tui/Tasks/BackgroundList.tsx
//
// Phase 12 M3 — Background section of the Tasks panel.
//
// Renders all tasks from TaskManager.list() (all states, all kinds).
// State icons:
//   ▶  running
//   ✓  completed
//   ✗  failed
//   ◉  killed
//   ☐  pending
//
// Overflow: items beyond `maxItems` are replaced with "  … +N more".

import React from 'react'
import { Box, Text } from 'ink'
import type { Task, TaskState } from '../../core/tasks/types'

const STATE_ICON: Record<TaskState, string> = {
  running: '▶',
  completed: '✓',
  failed: '✗',
  killed: '◉',
  pending: '☐',
}

const STATE_COLOR: Record<TaskState, string> = {
  running: 'cyan',
  completed: 'green',
  failed: 'red',
  killed: 'yellow',
  pending: 'gray',
}

export type BackgroundListProps = {
  tasks: Task[]
  maxItems: number
}

export function BackgroundList({ tasks, maxItems }: BackgroundListProps): React.JSX.Element | null {
  if (tasks.length === 0) return null

  const visible = tasks.slice(0, maxItems)
  const overflow = tasks.length - visible.length

  return (
    <Box flexDirection="column">
      <Text color="yellow" bold>Backgrounds</Text>
      {visible.map(task => (
        <Box key={task.id} flexDirection="row" gap={1}>
          <Text color={STATE_COLOR[task.state]}>{STATE_ICON[task.state]}</Text>
          <Text color={task.state === 'completed' || task.state === 'failed' || task.state === 'killed' ? 'gray' : 'white'}>
            {task.description}
          </Text>
        </Box>
      ))}
      {overflow > 0 && (
        <Text color="gray">  … +{overflow} more</Text>
      )}
    </Box>
  )
}
