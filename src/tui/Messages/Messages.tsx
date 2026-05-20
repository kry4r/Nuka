// src/tui/Messages/Messages.tsx
import React from 'react'
import { Box } from 'ink'
import { MessageRow } from './MessageRow'
import { DISPATCH_AGENT_TOOL_NAME } from '../../core/agents/dispatchTool'
import type { Message } from '../../core/message/types'

// Tail-N caps the live transcript so pathological sessions do not make Ink
// repaint unbounded history. Recent turns stay in the live viewport; nothing
// is sent to Ink's <Static> scrollback path because that makes previous turns
// disappear from the actual conversation pane after submit.
const TAIL_N = 50

// Approximate row count to reserve for the Welcome hero when it is
// rendered as the prologue. Mirrors HERO_MAX_HEIGHT in Welcome.tsx.
const PROLOGUE_ROWS = 12

// Floor on tailN so the live area never collapses below a couple of
// recent turns even on a tiny terminal.
const TAIL_FLOOR = 5

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
   *  Welcome hero. It is visible only while the conversation is empty so it
   *  does not compete with user/assistant turns after the first submit. */
  prologue?: React.ReactNode
  /**
   * Bug fix #9 — height-aware tail: when the parent passes the row budget
   * available to the conversation zone, Messages clamps its visible-message
   * count to fit and lets the conversation zone clip old overflow at the top.
   */
  availableRows?: number
}): React.JSX.Element {
  const toolResultsById = buildToolResultsById(props.items)
  const total = props.items.length
  const showPrologue = total === 0 && props.streaming === null && props.prologue !== undefined

  let tailLimit = TAIL_N
  if (typeof props.availableRows === 'number') {
    const prologueRows = showPrologue ? PROLOGUE_ROWS : 0
    const budget = props.availableRows - prologueRows
    tailLimit = Math.min(TAIL_N, Math.max(TAIL_FLOOR, budget))
  }
  const liveTail = props.items.length > tailLimit
    ? props.items.slice(props.items.length - tailLimit)
    : props.items

  return (
    // Bottom-align the live transcript inside the conversation zone. When the
    // transcript is taller than the zone, overflow is clipped from the top so
    // the newest turn remains near the prompt and previous recent turns remain
    // visible above it.
    <Box flexDirection="column" flexGrow={1} justifyContent="flex-end" overflow="hidden">
      <Box flexDirection="column" flexShrink={0}>
        {showPrologue && <Box>{props.prologue}</Box>}
        {liveTail.map((m, i) => (
          <MessageRow
            key={'id' in m ? m.id : `live-${i}`}
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
    </Box>
  )
}
