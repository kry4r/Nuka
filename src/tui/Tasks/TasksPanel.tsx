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
  /** Whether the Tasks frame currently owns keyboard focus (focus mode is
   *  deferred to Phase 13 — App.tsx always passes `false` in Phase 12). */
  focused?: boolean
}

export function TasksPanel({
  todoStore,
  messages,
  tasks,
  focused,
}: TasksPanelProps): React.JSX.Element | null {
  const planItems = todoStore.items
  const subagents = findInFlightSubagents(messages)
  const bgTasks = tasks

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

  const borderColor = focused ? P.primary : P.fgMuted
  const titleColor = focused ? P.primary : P.fgMuted

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      paddingX={1}
    >
      <Text color={titleColor} bold>Tasks  <Text color={P.fgMuted} dimColor>(Ctrl+T to collapse)</Text></Text>
      {hasplan && <PlanList store={todoStore} maxItems={planCap} />}
      {hasSubs && (
        <>
          {hasplan && <Text color={P.fgMuted}>─</Text>}
          <SubagentList messages={messages} maxItems={subCap} />
        </>
      )}
      {hasBgs && (
        <>
          {(hasplan || hasSubs) && <Text color={P.fgMuted}>─</Text>}
          <BackgroundList tasks={bgTasks} maxItems={bgCap} />
        </>
      )}
    </Box>
  )
}
