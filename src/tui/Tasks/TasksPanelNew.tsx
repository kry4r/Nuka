// src/tui/Tasks/TasksPanelNew.tsx
//
// Phase 14b — New 5-column Tasks panel powered by columnReducer + focusReducer.
// Kept as TasksPanelNew to avoid breaking the existing TasksPanel (legacy API).
// App.tsx wires this in Task 13 (keyboard wiring).
import * as React from 'react'
import { Box, Text } from 'ink'
import { PlanColumn } from './columns/PlanColumn'
import { SubagentColumn } from './columns/SubagentColumn'
import { PipelineColumn } from './columns/PipelineColumn'
import { BackgroundColumn } from './columns/BackgroundColumn'
import { MessageColumn } from './columns/MessageColumn'
import { truncateByWidth } from '../../core/stringWidth'
import type { ColumnsState } from './columnReducer'
import type { FocusState } from './focusReducer'

// Wide layout needs ~110 cols to fit five columns plus borders + indicators
// without wrapping. Below that we collapse to a single visible column.
const WIDE_THRESHOLD = 110

export function TasksPanelNew(props: { state: ColumnsState; focus: FocusState; cols: number }): React.ReactNode {
  const focusedCol = props.focus.kind === 'tasks-column' ? props.focus.column : undefined
  const selectedIndex = props.focus.kind === 'tasks-column' ? props.focus.selectedIndex : undefined

  if (props.cols < WIDE_THRESHOLD) {
    const order = ['plan', 'subagent', 'pipeline', 'background', 'message'] as const
    const active = focusedCol ?? 'plan'
    const idx = order.indexOf(active)
    const counts = {
      plan: props.state.plan.rows.length,
      subagent: props.state.subagent.rows.length,
      pipeline: props.state.pipeline.rows.length,
      background: props.state.background.rows.length,
      message: props.state.message.rows.length,
    }
    const summary = buildNarrowTaskSummary(counts, active, idx, props.cols)
    return (
      <Box flexDirection="column">
        <Text>
          {summary}
        </Text>
        {active === 'plan'       && <PlanColumn rows={props.state.plan.rows} focused selectedIndex={selectedIndex} />}
        {active === 'subagent'   && <SubagentColumn rows={props.state.subagent.rows} focused selectedIndex={selectedIndex} />}
        {active === 'pipeline'   && <PipelineColumn rows={props.state.pipeline.rows} focused selectedIndex={selectedIndex} />}
        {active === 'background' && <BackgroundColumn rows={props.state.background.rows} focused selectedIndex={selectedIndex} />}
        {active === 'message'    && <MessageColumn rows={props.state.message.rows} focused selectedIndex={selectedIndex} />}
      </Box>
    )
  }
  return (
    <Box flexDirection="row">
      <PlanColumn       rows={props.state.plan.rows}       focused={focusedCol === 'plan'}       selectedIndex={focusedCol === 'plan' ? selectedIndex : undefined} />
      <SubagentColumn   rows={props.state.subagent.rows}   focused={focusedCol === 'subagent'}   selectedIndex={focusedCol === 'subagent' ? selectedIndex : undefined} />
      <PipelineColumn   rows={props.state.pipeline.rows}   focused={focusedCol === 'pipeline'}   selectedIndex={focusedCol === 'pipeline' ? selectedIndex : undefined} />
      <BackgroundColumn rows={props.state.background.rows} focused={focusedCol === 'background'} selectedIndex={focusedCol === 'background' ? selectedIndex : undefined} />
      <MessageColumn    rows={props.state.message.rows}    focused={focusedCol === 'message'}    selectedIndex={focusedCol === 'message' ? selectedIndex : undefined} />
    </Box>
  )
}

function buildNarrowTaskSummary(
  counts: { plan: number; subagent: number; pipeline: number; background: number; message: number },
  active: 'plan' | 'subagent' | 'pipeline' | 'background' | 'message',
  activeIndex: number,
  cols: number,
): string {
  const focus = active === 'subagent' ? 'sub' : active === 'pipeline' ? 'pipe' : active === 'background' ? 'bg' : active === 'message' ? 'msg' : active
  const summary = `Tasks: plan ${counts.plan} · sub ${counts.subagent} · pipe ${counts.pipeline} · bg ${counts.background} · msg ${counts.message} · focus ${focus} ${activeIndex + 1}/5`
  return truncateByWidth(summary, Math.max(20, cols))
}
