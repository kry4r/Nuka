// src/tui/Messages/Messages.tsx
import React from 'react'
import { Box } from 'ink'
import { MessageRow } from './MessageRow'
import { DISPATCH_AGENT_TOOL_NAME } from '../../core/agents/dispatchTool'
import type { Message } from '../../core/message/types'

// Tail-N: only the most recent N messages are rendered live so the
// conversation zone can't overflow the available terminal rows and push
// the prompt/status bar off-screen. Earlier messages are dropped from
// the live area (the user still has full history via /resume + the
// session log file).
const TAIL_N = 50

/**
 * Build a map of tool_use id → {output, isError} for dispatch_agent tool
 * calls. Only dispatch_agent entries are included so that MessageRow
 * can render an inline AgentCall (result collapsed with the call) and
 * suppress the standalone tool-role block for those ids.
 */
function buildToolResultsById(items: Message[]): Map<string, { output: string; isError: boolean }> {
  const out = new Map<string, { output: string; isError: boolean }>()
  const dispatchIds = new Set<string>()
  for (const m of items) {
    if (m.role === 'assistant') {
      for (const b of m.content) {
        if (b.type === 'tool_use' && b.name === DISPATCH_AGENT_TOOL_NAME) {
          dispatchIds.add(b.id)
        }
      }
    }
  }
  for (const m of items) {
    if (m.role === 'tool' && dispatchIds.has(m.toolUseId)) {
      const output = typeof m.content === 'string'
        ? m.content
        : m.content.map(b => (b.type === 'text' ? b.text : `[${b.type}]`)).join('\n')
      out.set(m.toolUseId, { output, isError: m.isError })
    }
  }
  return out
}

export function Messages(props: {
  items: Message[]
  streaming: Message | null
  expandedAgentCallIds?: Set<string>
  resolveToolSource?: (toolName: string) => 'builtin' | 'skill' | 'plugin' | undefined
  resolveToolAnnotations?: (toolName: string) => { readOnly?: boolean; destructive?: boolean; openWorld?: boolean } | undefined
  /** Optional prologue rendered above the message list — typically the
   *  Welcome hero. Stays in the live area (no longer pushed to scrollback). */
  prologue?: React.ReactNode
}): React.JSX.Element {
  const toolResultsById = buildToolResultsById(props.items)
  // Tail-N truncation keeps the live conversation zone bounded so a long
  // session can't overflow and shove the prompt/status panel out of view.
  const tail = props.items.length > TAIL_N
    ? props.items.slice(props.items.length - TAIL_N)
    : props.items
  return (
    <Box flexDirection="column">
      {props.prologue && <Box>{props.prologue}</Box>}
      {tail.map((m, i) => (
        <MessageRow
          key={'id' in m ? m.id : `m-${i}`}
          m={m}
          toolResultsById={toolResultsById}
          expandedAgentCallIds={props.expandedAgentCallIds}
          resolveToolSource={props.resolveToolSource}
          resolveToolAnnotations={props.resolveToolAnnotations}
        />
      ))}
      {props.streaming && (
        <MessageRow
          m={props.streaming}
          toolResultsById={toolResultsById}
          expandedAgentCallIds={props.expandedAgentCallIds}
          resolveToolSource={props.resolveToolSource}
          resolveToolAnnotations={props.resolveToolAnnotations}
        />
      )}
    </Box>
  )
}
