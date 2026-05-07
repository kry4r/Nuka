// src/tui/Tasks/TasksPanel.tsx
//
// Phase 12 M3 — Tasks panel (expanded view).
//
// Three sections rendered in order: Plan → Subagents → Backgrounds.
// - Hidden entirely (zero height) if all three sections are empty.
// - Section heading only shown if that section has items.
// - 12-row total cap across all sections. Overflow distributed evenly
//   among non-empty sections; each section shows at least 1 row if non-empty.
//
// Ctrl+T (wired in App.tsx) toggles between the collapsed summary row
// (rendered by App.tsx itself) and this expanded panel.
//
// Reactivity: `tick` prop (bumped by App.tsx on every agent event or
// TaskManager change) drives re-renders since TodoState and TaskManager
// mutate in place.

import React from 'react'
import { Box, Text } from 'ink'
import type { TodoState } from '../../core/tools/todoWrite'
import type { Task } from '../../core/tasks/types'
import type { Message } from '../../core/message/types'
import { PlanList } from './PlanList'
import { SubagentList } from './SubagentList'
import { BackgroundList } from './BackgroundList'
import { findInFlightSubagents } from './SubagentList'
import { defaultPalette as P } from '../theme'
import { useTheme } from '../../core/theme/context'
import { useTerminalSize } from '../hooks/useTerminalSize'

// 12 visible item rows total. Distribute by section count.
const TOTAL_CAP = 12

function distributeRows(
  hasplan: boolean,
  hasSubs: boolean,
  hasBgs: boolean,
  planTotal: number,
  subTotal: number,
  bgTotal: number,
): { planCap: number; subCap: number; bgCap: number } {
  const activeSections = [hasplan, hasSubs, hasBgs].filter(Boolean).length
  if (activeSections === 0) return { planCap: 0, subCap: 0, bgCap: 0 }

  // Each section gets an equal share of the cap.
  // Sections with fewer items than their share donate leftover to others.
  const base = Math.floor(TOTAL_CAP / activeSections)
  let remaining = TOTAL_CAP

  // First pass: assign min(base, sectionTotal) rows.
  let planCap = hasplan ? Math.min(base, planTotal) : 0
  let subCap = hasSubs ? Math.min(base, subTotal) : 0
  let bgCap = hasBgs ? Math.min(base, bgTotal) : 0

  // Second pass: redistribute leftover rows to sections that can use more.
  remaining -= planCap + subCap + bgCap
  if (remaining > 0 && hasplan && planTotal > planCap) {
    const extra = Math.min(remaining, planTotal - planCap)
    planCap += extra
    remaining -= extra
  }
  if (remaining > 0 && hasSubs && subTotal > subCap) {
    const extra = Math.min(remaining, subTotal - subCap)
    subCap += extra
    remaining -= extra
  }
  if (remaining > 0 && hasBgs && bgTotal > bgCap) {
    const extra = Math.min(remaining, bgTotal - bgCap)
    bgCap += extra
    remaining -= extra
  }

  return { planCap, subCap, bgCap }
}

export type TasksPanelProps = {
  todoStore: TodoState
  messages: readonly Message[]
  tasks: Task[]
  /** Bumped externally to trigger re-render (since stores mutate in place). */
  tick: number
  /** Whether the panel is currently collapsed (show summary row instead). */
  collapsed: boolean
  /** Whether the Tasks frame currently owns keyboard focus. */
  focused?: boolean
  /** Phase 13 M4 — cursor row index when Tasks panel is in focus mode.
   *  Items are indexed: Plan items first, then Subagents, then Backgrounds. */
  cursor?: number
}

/**
 * Phase 13 M4 — compute total number of items shown in the Tasks panel
 * (Plan items + in-flight subagents + background tasks). Used by App.tsx
 * to clamp the focus cursor.
 *
 * Accepts a subset of TasksPanelProps (todoStore may be undefined for
 * cases where the panel isn't mounted).
 */
export function flattenedTasksLength(props: {
  todoStore?: TodoState
  messages: readonly Message[]
  tasks: Task[]
}): number {
  const planCount = props.todoStore ? props.todoStore.items.length : 0
  const subCount = findInFlightSubagents(props.messages).length
  const bgCount = props.tasks.length
  return planCount + subCount + bgCount
}

export function TasksPanel({
  todoStore,
  messages,
  tasks,
  focused,
  cursor,
}: TasksPanelProps): React.JSX.Element | null {
  const theme = useTheme()
  const { columns } = useTerminalSize()
  const planItems = todoStore.items
  const subagents = findInFlightSubagents(messages)
  const bgTasks = tasks

  // Outer box width: pin to terminal columns minus a small chrome budget
  // (border+padding+1-col safety) so flexShrink children have a bound.
  const boxWidth = Math.max(20, columns - 4)
  // Inside the bordered Box: border (2) + paddingX (2) = 4 cols of chrome.
  // Each row also reserves an icon (1) + gap (1) before the text Box.
  // Per-row text width budget = boxWidth - 4 (chrome) - 2 (icon+gap).
  const rowTextCap = Math.max(1, boxWidth - 6)

  const hasplan = planItems.length > 0
  const hasSubs = subagents.length > 0
  const hasBgs = bgTasks.length > 0

  // All-empty → hide entirely.
  if (!hasplan && !hasSubs && !hasBgs) return null

  const { planCap, subCap, bgCap } = distributeRows(
    hasplan,
    hasSubs,
    hasBgs,
    planItems.length,
    subagents.length,
    bgTasks.length,
  )

  const borderColor = focused ? theme.colors.primary : P.fgMuted
  const titleColor = focused ? theme.colors.primary : P.fgMuted

  // Phase 13 M4 — build flat list of cursor-aware row items.
  // Items indexed: Plan (0..planItems.length-1), Subagents, Backgrounds.
  const planOffset = 0
  const subOffset = planItems.length
  const bgOffset = planItems.length + subagents.length

  // Phase 14b — palette-driven status colors (replaces hard-coded ANSI names).
  const c = theme.colors
  const PLAN_STATUS_COLOR: Record<string, string> = {
    completed: c.success ?? P.success,
    in_progress: c.accentCool ?? P.accentCool,
    pending: c.fgMuted ?? P.fgMuted,
  }
  const BG_STATE_COLOR: Record<string, string> = {
    running: c.accentCool ?? P.accentCool,
    completed: c.success ?? P.success,
    failed: c.error ?? P.error,
    killed: c.warn ?? P.warn,
    pending: c.fgMuted ?? P.fgMuted,
    idle: c.accentCool ?? P.accentCool,
    shutdown_requested: c.warn ?? P.warn,
  }
  const fgColor      = c.fg ?? P.fg
  const fgMutedColor = c.fgMuted ?? P.fgMuted
  const subAccent    = c.accentCool ?? P.accentCool
  const sectionTitle = c.accentWarm ?? P.accentWarm

  const renderPlanRow = (item: TodoState['items'][number], idx: number): React.JSX.Element => {
    const absIdx = planOffset + idx
    const isCursor = focused && cursor !== undefined && absIdx === cursor
    const STATUS_ICON: Record<string, string> = { completed: '✓', in_progress: '▶', pending: '☐' }
    return (
      <Box key={idx} flexDirection="row" gap={1} backgroundColor={isCursor ? theme.colors.primaryDeep : undefined}>
        <Text color={PLAN_STATUS_COLOR[item.status] ?? fgMutedColor}>{STATUS_ICON[item.status] ?? '☐'}</Text>
        <Box flexShrink={1} width={rowTextCap}>
          <Text color={item.status === 'completed' ? fgMutedColor : fgColor} inverse={isCursor} wrap="truncate-end">{item.title}</Text>
        </Box>
      </Box>
    )
  }

  const renderSubRow = (sub: ReturnType<typeof findInFlightSubagents>[number], idx: number): React.JSX.Element => {
    const absIdx = subOffset + idx
    const isCursor = focused && cursor !== undefined && absIdx === cursor
    return (
      <Box key={sub.id} flexDirection="row" gap={1} backgroundColor={isCursor ? theme.colors.primaryDeep : undefined}>
        <Text color={subAccent}>▶</Text>
        <Box flexShrink={1} width={rowTextCap}>
          <Text color={fgColor} inverse={isCursor} wrap="truncate-end">{sub.label}</Text>
        </Box>
      </Box>
    )
  }

  const renderBgRow = (task: Task, idx: number): React.JSX.Element => {
    const absIdx = bgOffset + idx
    const isCursor = focused && cursor !== undefined && absIdx === cursor
    const STATE_ICON: Record<string, string> = { running: '▶', completed: '✓', failed: '✗', killed: '◉', pending: '☐' }
    const dimmed = task.state === 'completed' || task.state === 'failed' || task.state === 'killed'
    return (
      <Box key={task.id} flexDirection="row" gap={1} backgroundColor={isCursor ? theme.colors.primaryDeep : undefined}>
        <Text color={BG_STATE_COLOR[task.state] ?? fgMutedColor}>{STATE_ICON[task.state] ?? '☐'}</Text>
        <Box flexShrink={1} width={rowTextCap}>
          <Text color={dimmed ? fgMutedColor : fgColor} inverse={isCursor} wrap="truncate-end">{task.description}</Text>
        </Box>
      </Box>
    )
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      paddingX={1}
      width={boxWidth}
    >
      <Text color={titleColor} bold>Tasks  <Text color={fgMutedColor} dimColor>{focused ? '(↑↓/jk: move  ⏎: detail  Tab: exit)' : '(Ctrl+T to collapse)'}</Text></Text>
      {hasplan && (
        <Box flexDirection="column">
          <Text color={sectionTitle} bold>Plan</Text>
          {planItems.slice(0, planCap).map((item, i) => renderPlanRow(item, i))}
          {planItems.length - Math.min(planCap, planItems.length) > 0 && (
            <Text color={fgMutedColor}>  … +{planItems.length - planCap} more</Text>
          )}
        </Box>
      )}
      {hasSubs && (
        <>
          {hasplan && <Text color={fgMutedColor}>─</Text>}
          <Box flexDirection="column">
            <Text color={sectionTitle} bold>Subagents</Text>
            {subagents.slice(0, subCap).map((sub, i) => renderSubRow(sub, i))}
            {subagents.length - Math.min(subCap, subagents.length) > 0 && (
              <Text color={fgMutedColor}>  … +{subagents.length - subCap} more</Text>
            )}
          </Box>
        </>
      )}
      {hasBgs && (
        <>
          {(hasplan || hasSubs) && <Text color={fgMutedColor}>─</Text>}
          <Box flexDirection="column">
            <Text color={sectionTitle} bold>Backgrounds</Text>
            {bgTasks.slice(0, bgCap).map((task, i) => renderBgRow(task, i))}
            {bgTasks.length - Math.min(bgCap, bgTasks.length) > 0 && (
              <Text color={fgMutedColor}>  … +{bgTasks.length - bgCap} more</Text>
            )}
          </Box>
        </>
      )}
    </Box>
  )
}
