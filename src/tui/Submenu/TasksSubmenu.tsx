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
import { useColors } from '../../core/theme/context'
import { useTerminalSize } from '../hooks/useTerminalSize'

export type TasksSubmenuProps = {
  /** Index of the focused item in the flat (plan → subs → bgs) list. */
  focusItem: number
  todoStore: TodoState
  messages: readonly Message[]
  tasks: Task[]
}

export function TasksSubmenu({ focusItem, todoStore, messages, tasks }: TasksSubmenuProps): React.JSX.Element {
  const colors = useColors()
  const { columns } = useTerminalSize()
  // Reserve enclosing frame chrome (border 2 + paddingX 2 + a little slack).
  const innerWidth = Math.max(20, columns - 6)

  // Theme-bound color maps. Plan-item / subagent / background icons use the
  // semantic palette so themes (e.g. high-contrast / solarized) flow through
  // instead of being pinned to hardcoded ANSI names.
  const STATUS_ICON: Record<string, string> = { completed: '✓', in_progress: '▶', pending: '☐' }
  const STATUS_COLOR: Record<string, string> = {
    completed: colors.success,
    in_progress: colors.accentCool,
    pending: colors.fgMuted,
  }

  const planItems = todoStore.items
  const subagents = findInFlightSubagents(messages)
  const bgTasks = tasks

  const total = planItems.length + subagents.length + bgTasks.length

  if (total === 0) {
    return (
      <Box paddingX={1}>
        <Text color={colors.fgMuted}>No tasks.</Text>
      </Box>
    )
  }

  const idx = Math.max(0, Math.min(total - 1, focusItem))

  // Plan item
  if (idx < planItems.length) {
    const item = planItems[idx]!
    return (
      <Box flexDirection="column" paddingX={1} gap={1} width={innerWidth}>
        <Box flexDirection="row" gap={1}>
          <Text color={colors.warn} bold>Plan item {idx + 1} of {planItems.length}</Text>
        </Box>
        <Box flexDirection="row" gap={1} width={innerWidth - 2}>
          <Text color={STATUS_COLOR[item.status] ?? colors.fgMuted}>{STATUS_ICON[item.status] ?? '☐'}</Text>
          <Text color={colors.fg} bold wrap="truncate-end">{item.title}</Text>
        </Box>
        <Box>
          <Text color={colors.fgMuted}>Status: </Text>
          <Text color={STATUS_COLOR[item.status] ?? colors.fgMuted}>{item.status.replace('_', ' ')}</Text>
        </Box>
        <Box>
          <Text color={colors.fgMuted} dimColor>Esc to close</Text>
        </Box>
      </Box>
    )
  }

  // Subagent
  const subIdx = idx - planItems.length
  if (subIdx < subagents.length) {
    const sub = subagents[subIdx]!
    return (
      <Box flexDirection="column" paddingX={1} gap={1} width={innerWidth}>
        <Box>
          <Text color={colors.warn} bold>In-flight subagent {subIdx + 1} of {subagents.length}</Text>
        </Box>
        <Box flexDirection="row" gap={1} width={innerWidth - 2}>
          <Text color={colors.accentCool}>▶</Text>
          <Text color={colors.fg} bold wrap="truncate-end">{sub.label}</Text>
        </Box>
        <Box>
          <Text color={colors.fgMuted}>ID: </Text>
          <Text color={colors.fgMuted} wrap="truncate-middle">{sub.id}</Text>
        </Box>
        <Box>
          <Text color={colors.fgMuted} dimColor>Esc to close</Text>
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
        <Text color={colors.fgMuted}>Item not found.</Text>
      </Box>
    )
  }

  const STATE_ICON: Record<string, string> = { running: '▶', completed: '✓', failed: '✗', killed: '◉', pending: '☐' }
  const STATE_COLOR: Record<string, string> = {
    running: colors.accentCool,
    completed: colors.success,
    failed: colors.error,
    killed: colors.warn,
    pending: colors.fgMuted,
  }

  return (
    <Box flexDirection="column" paddingX={1} gap={1} width={innerWidth}>
      <Box>
        <Text color={colors.warn} bold>Background task {bgIdx + 1} of {bgTasks.length}</Text>
      </Box>
      <Box flexDirection="row" gap={1} width={innerWidth - 2}>
        <Text color={STATE_COLOR[task.state] ?? colors.fgMuted}>{STATE_ICON[task.state] ?? '☐'}</Text>
        <Text color={colors.fg} bold wrap="truncate-end">{task.description}</Text>
      </Box>
      <Box>
        <Text color={colors.fgMuted}>State: </Text>
        <Text color={STATE_COLOR[task.state] ?? colors.fgMuted}>{task.state}</Text>
      </Box>
      {task.outputFile && (
        <Box flexDirection="column" width={innerWidth - 2}>
          <Text color={colors.fgMuted}>Output file:</Text>
          <Text color={colors.fgMuted} wrap="truncate-middle">{task.outputFile}</Text>
        </Box>
      )}
      <Box>
        <Text color={colors.fgMuted} dimColor>Esc to close</Text>
      </Box>
    </Box>
  )
}
