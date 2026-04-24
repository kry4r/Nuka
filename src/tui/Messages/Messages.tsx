// src/tui/Messages/Messages.tsx
import React from 'react'
import { Box, Static } from 'ink'
import { MessageRow } from './MessageRow'
import { DISPATCH_AGENT_TOOL_NAME } from '../../core/agents/dispatchTool'
import type { Message } from '../../core/message/types'

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
  resolveToolSource?: (toolName: string) => 'builtin' | 'skill' | 'mcp' | 'plugin' | undefined
  resolveToolAnnotations?: (toolName: string) => { readOnly?: boolean; destructive?: boolean; openWorld?: boolean } | undefined
}): React.JSX.Element {
  const toolResultsById = buildToolResultsById(props.items)
  return (
    <Box flexDirection="column">
      <Static items={props.items}>
        {(m, i) => (
          <MessageRow
            key={'id' in m ? m.id : i}
            m={m}
            toolResultsById={toolResultsById}
            expandedAgentCallIds={props.expandedAgentCallIds}
            resolveToolSource={props.resolveToolSource}
            resolveToolAnnotations={props.resolveToolAnnotations}
          />
        )}
      </Static>
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
