// src/tui/Messages/AgentCall.tsx
import React from 'react'
import { Box, Text } from 'ink'
import { defaultPalette as P } from '../theme'

/**
 * Render a `dispatch_agent` tool call as a distinctive indented block
 * with an agent-name badge (`[<plugin>:<agent>]`). When `expanded` is
 * false, a short summary of the task is shown and the result (if any)
 * is collapsed. When `expanded` is true, the full task and result text
 * are displayed.
 */
export function AgentCall(props: {
  /** Qualified agent name `<plugin>:<agent>`. */
  agent: string
  /** Task text given to the sub-agent. */
  task: string
  /** Status: running, ok, or error (from the tool result). */
  status: 'running' | 'ok' | 'error'
  /** Final result text. Undefined while the sub-agent is still running. */
  result?: string
  /** When true, show full task + result; when false, show collapsed summary. */
  expanded?: boolean
}): React.JSX.Element {
  const icon = props.status === 'ok' ? '✓' : props.status === 'error' ? '✗' : '…'
  const iconColor = props.status === 'error' ? P.error : P.success
  const expanded = props.expanded ?? false

  const shortTask = props.task.length > 80 ? props.task.slice(0, 80) + '…' : props.task
  const shortResult = props.result && props.result.length > 120
    ? props.result.slice(0, 120) + '…'
    : props.result

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Box>
        <Text color={P.primary}>◆ </Text>
        <Text color={P.fg} bold>[{props.agent}] </Text>
        <Text color={P.fgMuted}>{expanded ? props.task : shortTask}</Text>
        <Text color={iconColor}> {icon}</Text>
      </Box>
      {props.result !== undefined && props.result.length > 0 && (
        <Box flexDirection="column" marginLeft={2} borderStyle="round" borderColor={P.fgMuted}>
          <Text color={P.fgMuted}>{expanded ? props.result : (shortResult ?? '')}</Text>
          <Text color={P.fgMuted} dimColor>(from `{props.agent}`)</Text>
        </Box>
      )}
      {/* Empty result: just a faint footer, no bordered block. */}
      {props.result !== undefined && props.result.length === 0 && (
        <Box marginLeft={2}>
          <Text color={P.fgMuted} dimColor>(from `{props.agent}`)</Text>
        </Box>
      )}
    </Box>
  )
}
