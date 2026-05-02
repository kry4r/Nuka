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
import { useTheme } from '../../core/theme/context'
import { defaultPalette as P } from '../theme'

const STATE_ICON: Record<TaskState, string> = {
  running: '▶',
  completed: '✓',
  failed: '✗',
  killed: '◉',
  pending: '☐',
  idle: '◌',
  shutdown_requested: '◎',
}

export type BackgroundListProps = {
  tasks: Task[]
  maxItems: number
}

export function BackgroundList({ tasks, maxItems }: BackgroundListProps): React.JSX.Element | null {
  const { colors } = useTheme()
  if (tasks.length === 0) return null

  const visible = tasks.slice(0, maxItems)
  const overflow = tasks.length - visible.length

  const STATE_COLOR: Record<TaskState, string> = {
    running: colors.accentCool ?? P.accentCool,
    completed: colors.success ?? P.success,
    failed: colors.error ?? P.error,
    killed: colors.warn ?? P.warn,
    pending: colors.fgMuted ?? P.fgMuted,
    idle: colors.accentCool ?? P.accentCool,
    shutdown_requested: colors.warn ?? P.warn,
  }
  const titleColor = colors.accentWarm ?? P.accentWarm
  const fgColor = colors.fg ?? P.fg
  const fgMuted = colors.fgMuted ?? P.fgMuted

  return (
    <Box flexDirection="column">
      <Text color={titleColor} bold>Backgrounds</Text>
      {visible.map(task => (
        <Box key={task.id} flexDirection="row" gap={1}>
          <Text color={STATE_COLOR[task.state]}>{STATE_ICON[task.state]}</Text>
          <Text color={task.state === 'completed' || task.state === 'failed' || task.state === 'killed' ? fgMuted : fgColor}>
            {task.description}
          </Text>
        </Box>
      ))}
      {overflow > 0 && (
        <Text color={fgMuted}>  … +{overflow} more</Text>
      )}
    </Box>
  )
}
