// src/tui/Submenu/TasksSubmenu.tsx
//
// Phase 13 M4 — Tasks focus submenu (read-only detail view).
//
// Shown when the user presses Enter from Tasks focus mode. Renders the full
// detail for the item at `focusItem` in the flat ordering:
//   Plan items first, then Subagents (in-flight), then Backgrounds.
//
// Read-only. Esc to close is handled by App.tsx (dispatch 'reset').

import React from 'react'
import { Box, Text } from 'ink'
import type { TodoState } from '../../core/tools/todoWrite'
import type { Task } from '../../core/tasks/types'
import type { Message } from '../../core/message/types'
import { findInFlightSubagents } from '../Tasks/SubagentList'
import { defaultPalette as P } from '../theme'

export type TasksSubmenuProps = {
  /** Index of the focused item in the flat (plan → subs → bgs) list. */
  focusItem: number
  todoStore: TodoState
  messages: readonly Message[]
  tasks: Task[]
}

export function TasksSubmenu({ focusItem, todoStore, messages, tasks }: TasksSubmenuProps): React.JSX.Element {
  const planItems = todoStore.items
  const subagents = findInFlightSubagents(messages)
  const bgTasks = tasks

  const total = planItems.length + subagents.length + bgTasks.length

  if (total === 0) {
    return (
      <Box paddingX={1}>
        <Text color={P.fgMuted}>No tasks.</Text>
      </Box>
    )
  }

  const idx = Math.max(0, Math.min(total - 1, focusItem))

  // Plan item
  if (idx < planItems.length) {
    const item = planItems[idx]!
    const STATUS_ICON: Record<string, string> = { completed: '✓', in_progress: '▶', pending: '☐' }
    const STATUS_COLOR: Record<string, string> = { completed: 'green', in_progress: 'cyan', pending: 'gray' }
    return (
      <Box flexDirection="column" paddingX={1} gap={1}>
        <Box flexDirection="row" gap={1}>
          <Text color="yellow" bold>Plan item {idx + 1} of {planItems.length}</Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          <Text color={STATUS_COLOR[item.status] ?? 'gray'}>{STATUS_ICON[item.status] ?? '☐'}</Text>
          <Text color="white" bold>{item.title}</Text>
        </Box>
        <Box>
          <Text color={P.fgMuted}>Status: </Text>
          <Text color={STATUS_COLOR[item.status] ?? 'gray'}>{item.status.replace('_', ' ')}</Text>
        </Box>
        <Box>
          <Text color={P.fgMuted} dimColor>Esc to close</Text>
        </Box>
      </Box>
    )
  }

  // Subagent
  const subIdx = idx - planItems.length
  if (subIdx < subagents.length) {
    const sub = subagents[subIdx]!
    return (
      <Box flexDirection="column" paddingX={1} gap={1}>
        <Box>
          <Text color="yellow" bold>In-flight subagent {subIdx + 1} of {subagents.length}</Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          <Text color="cyan">▶</Text>
          <Text color="white" bold>{sub.label}</Text>
        </Box>
        <Box>
          <Text color={P.fgMuted}>ID: </Text>
          <Text color="gray">{sub.id}</Text>
        </Box>
        <Box>
          <Text color={P.fgMuted} dimColor>Esc to close</Text>
        </Box>
      </Box>
    )
  }

  // Background task
  const bgIdx = idx - planItems.length - subagents.length
  const task = bgTasks[bgIdx]
  if (!task) {
    return (
      <Box paddingX={1}>
        <Text color={P.fgMuted}>Item not found.</Text>
      </Box>
    )
  }

  const STATE_ICON: Record<string, string> = { running: '▶', completed: '✓', failed: '✗', killed: '◉', pending: '☐' }
  const STATE_COLOR: Record<string, string> = { running: 'cyan', completed: 'green', failed: 'red', killed: 'yellow', pending: 'gray' }

  return (
    <Box flexDirection="column" paddingX={1} gap={1}>
      <Box>
        <Text color="yellow" bold>Background task {bgIdx + 1} of {bgTasks.length}</Text>
      </Box>
      <Box flexDirection="row" gap={1}>
        <Text color={STATE_COLOR[task.state] ?? 'gray'}>{STATE_ICON[task.state] ?? '☐'}</Text>
        <Text color="white" bold>{task.description}</Text>
      </Box>
      <Box>
        <Text color={P.fgMuted}>State: </Text>
        <Text color={STATE_COLOR[task.state] ?? 'gray'}>{task.state}</Text>
      </Box>
      {task.outputFile && (
        <Box flexDirection="column">
          <Text color={P.fgMuted}>Output file:</Text>
          <Text color="gray">{task.outputFile}</Text>
        </Box>
      )}
      <Box>
        <Text color={P.fgMuted} dimColor>Esc to close</Text>
      </Box>
    </Box>
  )
}
