// src/tui/Messages/AgentCall.tsx
import React from 'react'
import { Box, Text } from 'ink'
import { defaultPalette as P } from '../theme'
import { useTerminalSize } from '../hooks/useTerminalSize'

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
  const { columns } = useTerminalSize()
  const icon = props.status === 'ok' ? '✓' : props.status === 'error' ? '✗' : '…'
  const iconColor = props.status === 'error' ? P.error : P.success
  const expanded = props.expanded ?? false

  const shortTask = props.task.length > 80 ? props.task.slice(0, 80) + '…' : props.task
  const shortResult = props.result && props.result.length > 120
    ? props.result.slice(0, 120) + '…'
    : props.result

  // marginLeft=2 + 2 border chars = 4 chrome columns reserved.
  const boxWidth = Math.max(20, columns - 4)
  const innerCap = Math.max(1, boxWidth - 2)
  const rawResult = expanded ? (props.result ?? '') : (shortResult ?? '')
  // Defensive hard-cut only for unbreakable lines (e.g. URLs without
  // spaces) so ink's word-wrap can't push glyphs through the right border.
  // Lines that already contain whitespace are left alone — wrap="wrap"
  // handles them safely within the bounded box width.
  const safeResult = rawResult
    .split('\n')
    .map(line => (line.length > innerCap && !/\s/.test(line)) ? line.slice(0, innerCap) : line)
    .join('\n')

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Box>
        <Text color={P.primary}>◆ </Text>
        <Text color={P.fg} bold>[{props.agent}] </Text>
        <Text color={P.fgMuted}>{expanded ? props.task : shortTask}</Text>
        <Text color={iconColor}> {icon}</Text>
      </Box>
      {props.result !== undefined && props.result.length > 0 && (
        <Box flexDirection="column" marginLeft={2} width={boxWidth} borderStyle="round" borderColor={P.fgMuted}>
          <Text color={P.fgMuted} wrap="wrap">{safeResult}</Text>
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
