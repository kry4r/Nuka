// src/tui/Tasks/SubagentList.tsx
//
// Phase 12 M3 — Subagent section of the Tasks panel.
//
// Scans session.messages for `tool_use` blocks named `dispatch_agent`.
// For each, checks if any later message (any role) is a `tool` message
// whose `toolUseId` matches. Missing match → in-flight.
//
// Only in-flight subagents are shown (they are the interesting ones; completed
// ones are surfaced in the conversation transcript).
//
// Render order: most recent first (newest tool_use id shown at top).
// Overflow: items beyond `maxItems` are replaced with "  … +N more".

import React from 'react'
import { Box, Text, useStdout } from 'ink'
import type { Message } from '../../core/message/types'
import { DISPATCH_AGENT_TOOL_NAME } from '../../core/agents/dispatchTool'
import { useTheme } from '../../core/theme/context'
import { defaultPalette as P } from '../theme'
import { truncateByWidth } from '../../core/stringWidth'

const TASK_LABEL_WIDTH = 60

function truncateTaskLabel(task: string): string {
  return truncateByWidth(task, TASK_LABEL_WIDTH + 1)
}

export type SubagentInfo = {
  id: string
  /** The `input.task` or `input.agent` field as a label — derived from tool input. */
  label: string
}

/**
 * Scan all messages for in-flight dispatch_agent calls (tool_use with no
 * matching tool_result message). Returns them most-recent first.
 * Exported for tests.
 */
export function findInFlightSubagents(messages: readonly Message[]): SubagentInfo[] {
  // Collect all dispatch_agent tool_use calls in order (oldest first).
  const calls: Array<{ id: string; label: string }> = []
  // Collect all tool result ids for quick lookup.
  const resolvedIds = new Set<string>()

  for (const m of messages) {
    if (m.role === 'assistant') {
      for (const block of m.content) {
        if (
          block.type === 'tool_use' &&
          block.name === DISPATCH_AGENT_TOOL_NAME
        ) {
          const input = block.input as { agent?: string; task?: string } | undefined
          const label = input?.task
            ? truncateTaskLabel(input.task)
            : input?.agent ?? block.id
          calls.push({ id: block.id, label })
        }
      }
    }
    if (m.role === 'tool') {
      resolvedIds.add(m.toolUseId)
    }
  }

  // In-flight = calls without a matching tool result.
  const inFlight = calls.filter(c => !resolvedIds.has(c.id))
  // Reverse: most recent first.
  return inFlight.reverse()
}

export type SubagentListProps = {
  messages: readonly Message[]
  maxItems: number
}

export function SubagentList({ messages, maxItems }: SubagentListProps): React.JSX.Element | null {
  const { stdout } = useStdout()
  const columns = process.stdout.columns ?? stdout?.columns ?? 80
  const { colors } = useTheme()
  const inFlight = findInFlightSubagents(messages)
  if (inFlight.length === 0) return null

  const visible = inFlight.slice(0, maxItems)
  const overflow = inFlight.length - visible.length
  const rowLabelWidth = Math.max(1, columns - 2)

  const titleColor  = colors.accentWarm ?? P.accentWarm
  const accentColor = colors.accentCool ?? P.accentCool
  const fgColor     = colors.fg ?? P.fg
  const fgMuted     = colors.fgMuted ?? P.fgMuted

  return (
    <Box flexDirection="column">
      <Text color={titleColor} bold>Subagents</Text>
      {visible.map(agent => {
        const label = truncateByWidth(agent.label, rowLabelWidth)
        return (
          <Box key={agent.id} flexDirection="row" gap={1}>
            <Text color={accentColor}>▶</Text>
            <Text color={fgColor}>{label}</Text>
          </Box>
        )
      })}
      {overflow > 0 && (
        <Text color={fgMuted}>  … +{overflow} more</Text>
      )}
    </Box>
  )
}
