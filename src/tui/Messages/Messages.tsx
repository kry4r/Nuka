// src/tui/Messages/Messages.tsx
import React, { useMemo, useRef } from 'react'
import { Box, Static } from 'ink'
import { MessageRow } from './MessageRow'
import { DISPATCH_AGENT_TOOL_NAME } from '../../core/agents/dispatchTool'
import type { Message } from '../../core/message/types'

type StaticItem =
  | { kind: 'welcome' }
  | { kind: 'message'; m: Message }

// Sentinel object reused across renders so `<Static>` doesn't treat the
// Welcome prologue as a new item on every parent re-render. The actual
// React node lives in a ref outside the items array.
const WELCOME_ITEM: StaticItem = { kind: 'welcome' }

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
  /** Optional prologue rendered as the first Static item — typically the Welcome
   *  hero. Lives inside Static so it scrolls up to scrollback as messages
   *  accumulate, instead of staying glued to the live area. */
  prologue?: React.ReactNode
}): React.JSX.Element {
  const toolResultsById = buildToolResultsById(props.items)
  // Keep latest prologue node in a ref so the rendered Welcome stays current
  // (cwd/branch/model can shift), but the Static items array's identity for
  // the welcome slot is stable — `<Static>` only emits new items on length
  // change, which is what we want.
  const prologueRef = useRef<React.ReactNode>(null)
  prologueRef.current = props.prologue ?? null
  const hasPrologue = props.prologue !== undefined && props.prologue !== null
  const items = useMemo<StaticItem[]>(() => {
    const arr: StaticItem[] = []
    if (hasPrologue) arr.push(WELCOME_ITEM)
    for (const m of props.items) arr.push({ kind: 'message', m })
    return arr
  }, [hasPrologue, props.items])
  return (
    <Box flexDirection="column">
      <Static items={items}>
        {(item, i) => {
          if (item.kind === 'welcome') {
            return <Box key="welcome-prologue">{prologueRef.current}</Box>
          }
          const m = item.m
          return (
            <MessageRow
              key={'id' in m ? m.id : `m-${i}`}
              m={m}
              toolResultsById={toolResultsById}
              expandedAgentCallIds={props.expandedAgentCallIds}
              resolveToolSource={props.resolveToolSource}
              resolveToolAnnotations={props.resolveToolAnnotations}
            />
          )
        }}
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
