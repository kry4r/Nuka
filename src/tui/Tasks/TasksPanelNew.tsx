// src/tui/Tasks/TasksPanelNew.tsx
//
// Phase 14b — New 5-column Tasks panel powered by columnReducer + focusReducer.
// Kept as TasksPanelNew to avoid breaking the existing TasksPanel (legacy API).
// App.tsx wires this in Task 13 (keyboard wiring).
import * as React from 'react'
import { Box, Text } from 'ink'
import { truncateByWidth } from '../../core/stringWidth'
import type { ColumnKind, ColumnsState, Row } from './columnReducer'
import type { FocusState } from './focusReducer'

// Wide layout shows one digest line plus a row for each active work lane.
// Below this threshold we keep only the focused lane detail.
const WIDE_THRESHOLD = 110
const COLUMN_ORDER: ColumnKind[] = ['plan', 'subagent', 'pipeline', 'background', 'message']
const COLUMN_LABELS: Record<ColumnKind, string> = {
  plan: 'plan',
  subagent: 'sub',
  pipeline: 'pipe',
  background: 'bg',
  message: 'msg',
}

export function TasksPanelNew(props: { state: ColumnsState; focus: FocusState; cols: number }): React.ReactNode {
  const focusedCol = props.focus.kind === 'tasks-column' ? props.focus.column : undefined
  const selectedIndex = props.focus.kind === 'tasks-column' ? props.focus.selectedIndex : undefined

  const active = focusedCol ?? 'plan'
  const activeIndex = COLUMN_ORDER.indexOf(active)
  const counts = countRows(props.state)
  const summary = buildTaskSummary(counts, active, activeIndex, props.cols)
  const detailLines = props.cols < WIDE_THRESHOLD
    ? buildFocusedTaskLines(props.state, active, selectedIndex, props.cols)
    : buildWideTaskLines(props.state, active, selectedIndex, props.cols)

  return (
    <Box flexDirection="column" flexShrink={0}>
      <Text>{summary}</Text>
      {detailLines.map(line => (
        <Text key={line} wrap="truncate-end">{line}</Text>
      ))}
    </Box>
  )
}

function countRows(state: ColumnsState): Record<ColumnKind, number> {
  return {
    plan: state.plan.rows.length,
    subagent: state.subagent.rows.length,
    pipeline: state.pipeline.rows.length,
    background: state.background.rows.length,
    message: state.message.rows.length,
  }
}

function buildTaskSummary(
  counts: { plan: number; subagent: number; pipeline: number; background: number; message: number },
  active: ColumnKind,
  activeIndex: number,
  cols: number,
): string {
  const focus = COLUMN_LABELS[active]
  const summary = `Tasks: plan ${counts.plan} · sub ${counts.subagent} · pipe ${counts.pipeline} · bg ${counts.background} · msg ${counts.message} · focus ${focus} ${activeIndex + 1}/5`
  return truncateByWidth(summary, Math.max(20, cols))
}

function buildWideTaskLines(
  state: ColumnsState,
  active: ColumnKind,
  selectedIndex: number | undefined,
  cols: number,
): string[] {
  const lines = COLUMN_ORDER.flatMap(column => {
    const rows = state[column].rows
    if (rows.length === 0) return []
    const rowIndex = column === active ? clampIndex(selectedIndex, rows.length) : 0
    const extra = rows.length > 1 ? ` (+${rows.length - 1})` : ''
    return [formatTaskLine(column, rows[rowIndex]!, column === active, extra, cols)]
  })
  return lines.length > 0 ? lines : [truncateByWidth('detail - (none)', Math.max(20, cols))]
}

function buildFocusedTaskLines(
  state: ColumnsState,
  active: ColumnKind,
  selectedIndex: number | undefined,
  cols: number,
): string[] {
  const rows = state[active].rows
  if (rows.length === 0) return [truncateByWidth(`${COLUMN_LABELS[active]} - (none)`, Math.max(20, cols))]
  const rowIndex = clampIndex(selectedIndex, rows.length)
  const extra = rows.length > 1 ? ` (${rowIndex + 1}/${rows.length})` : ''
  return [formatTaskLine(active, rows[rowIndex]!, true, extra, cols)]
}

function formatTaskLine(
  column: ColumnKind,
  row: Row,
  active: boolean,
  suffix: string,
  cols: number,
): string {
  const marker = active ? '>' : '-'
  const status = row.status.length > 0 ? `${row.status} ` : ''
  const secondary = row.secondary.trim()
  const detail = secondary.length > 0 && secondary !== row.primary ? ` - ${secondary}` : ''
  const text = `${COLUMN_LABELS[column]} ${marker} ${status}${row.primary}${detail}${suffix}`
  return truncateByWidth(text, Math.max(20, cols))
}

function clampIndex(selectedIndex: number | undefined, length: number): number {
  return Math.max(0, Math.min(selectedIndex ?? 0, Math.max(0, length - 1)))
}
