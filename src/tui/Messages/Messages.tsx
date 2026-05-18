// src/tui/Messages/Messages.tsx
import React from 'react'
import { Box, Static } from 'ink'
import { MessageRow } from './MessageRow'
import { DISPATCH_AGENT_TOOL_NAME } from '../../core/agents/dispatchTool'
import type { Message } from '../../core/message/types'
import { shouldPrologueGoStatic } from './staticGating'

// Tail-N applies only to the LIVE area now — the Static stream prints to the
// real terminal scrollback (recoverable via mouse-wheel) and does not need
// truncating. The cap here is a defensive guard against pathological growth
// in the live area (e.g. a runaway tool loop).
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

/**
 * Build the set of tool_use ids that have a corresponding tool_result
 * already in the items list (i.e. completed). Used by the freeze rule:
 * an assistant message whose every tool_use has resolved is eligible to
 * move into the Static stream.
 */
function buildResolvedToolUseIds(items: Message[]): Set<string> {
  const resolved = new Set<string>()
  for (const m of items) {
    if (m.role === 'tool') {
      resolved.add(m.toolUseId)
    }
  }
  return resolved
}

/**
 * Freeze rule — a message is "static-eligible" iff:
 *  - It is NOT the currently streaming message (caller filters that).
 *  - It is NOT among the last `liveTailCount` messages (so the user can
 *    still toggle expand on recent items before they freeze).
 *  - For assistant messages: every tool_use block has a matching tool
 *    result already in items (no in-flight tool calls).
 *  - For tool messages: always — once a tool result is in the array, it
 *    won't mutate. (The matching assistant message's eligibility is
 *    governed by its own tool_use blocks.)
 *  - For user messages: always.
 *  - System messages render to nothing in MessageRow, so eligibility is
 *    irrelevant; we still treat them as eligible for partition purposes.
 *
 * The rule is strictly monotonic with respect to appends: once a message
 * satisfies it, appending more items to `items` cannot un-satisfy it
 * (resolved tool_use ids only grow; `liveTailCount` slides forward, so
 * earlier indexes stay below the threshold). This is required by ink's
 * <Static>, which is append-only.
 */
const LIVE_TAIL_COUNT = 1

function isStaticEligible(
  m: Message,
  index: number,
  totalCount: number,
  resolvedToolUseIds: Set<string>,
): boolean {
  // Keep the most-recent N messages in the live area so toggle interactions
  // (e.g. expand agent call) keep working until they're superseded.
  if (index >= totalCount - LIVE_TAIL_COUNT) return false
  if (m.role === 'assistant') {
    for (const b of m.content) {
      if (b.type === 'tool_use' && !resolvedToolUseIds.has(b.id)) return false
    }
    return true
  }
  // user / tool / system — no in-flight state once they're not the latest.
  return true
}

type StaticItem =
  | { kind: 'prologue'; key: string; node: React.ReactNode }
  | { kind: 'message'; key: string; m: Message }

export function Messages(props: {
  items: Message[]
  streaming: Message | null
  expandedAgentCallIds?: Set<string>
  resolveToolSource?: (toolName: string) => 'builtin' | 'skill' | 'plugin' | undefined
  resolveToolAnnotations?: (toolName: string) => { readOnly?: boolean; destructive?: boolean; openWorld?: boolean } | undefined
  /** Optional prologue rendered above the message list — typically the
   *  Welcome hero. While the conversation is empty it stays in the live
   *  area (so it can re-render on cwd/branch/model changes). The moment
   *  any message lands it flips into the Static stream as the first item
   *  and from then on scrolls upward with the conversation. */
  prologue?: React.ReactNode
  /**
   * Bug fix #9 — height-aware tail: when the parent passes the row budget
   * available to the conversation zone, Messages clamps its visible-message
   * count to fit. Now applies only to the LIVE area; Static items live in
   * terminal scrollback and the terminal handles their height.
   */
  availableRows?: number
}): React.JSX.Element {
  const toolResultsById = buildToolResultsById(props.items)
  const resolvedToolUseIds = buildResolvedToolUseIds(props.items)

  // Partition items into static-eligible (frozen, sent to terminal scrollback
  // via <Static>) vs live (still mutable / most recent). The partition is
  // strictly monotonic with respect to appends, which is what <Static>
  // requires (it is append-only — items already rendered cannot be removed).
  const total = props.items.length
  const staticMessages: Message[] = []
  const liveMessages: Message[] = []
  for (let i = 0; i < total; i++) {
    const m = props.items[i]!
    if (isStaticEligible(m, i, total, resolvedToolUseIds)) {
      staticMessages.push(m)
    } else {
      liveMessages.push(m)
    }
  }

  // Tail-N truncation only applies to the live area now. Static items already
  // live in terminal scrollback (recoverable via mouse-wheel scroll-up).
  let tailLimit = TAIL_N
  if (typeof props.availableRows === 'number') {
    const prologueRows = props.prologue && total === 0 ? PROLOGUE_ROWS : 0
    const budget = props.availableRows - prologueRows
    tailLimit = Math.min(TAIL_N, Math.max(TAIL_FLOOR, budget))
  }
  const liveTail = liveMessages.length > tailLimit
    ? liveMessages.slice(liveMessages.length - tailLimit)
    : liveMessages

  // Build the Static items array. Prologue flips INTO Static the moment any
  // message exists (or a stream begins) so it scrolls off-screen with the
  // conversation. While the session is pure-prologue (no messages, no
  // stream), the prologue stays in the live area so it can re-render when
  // cwd/branch/model change.
  const prologueGoesStatic = shouldPrologueGoStatic({ prologue: props.prologue, total, streaming: props.streaming })
  const staticItems: StaticItem[] = []
  if (prologueGoesStatic) {
    staticItems.push({ kind: 'prologue', key: 'prologue', node: props.prologue })
  }
  for (const m of staticMessages) {
    const key = 'id' in m ? m.id : `m-${staticItems.length}`
    staticItems.push({ kind: 'message', key, m })
  }

  return (
    // The outer Box constrains the live area to the available terminal rows.
    // <Static> sits inside but uses position: 'absolute' (per ink internals)
    // and prints to the real terminal scrollback above the live region — it
    // is unaffected by the parent's height/overflow constraints.
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Static items={staticItems}>
        {(item) =>
          item.kind === 'prologue' ? (
            <Box key={item.key}>{item.node}</Box>
          ) : (
            <MessageRow
              key={item.key}
              m={item.m}
              toolResultsById={toolResultsById}
              expandedAgentCallIds={props.expandedAgentCallIds}
              resolveToolSource={props.resolveToolSource}
              resolveToolAnnotations={props.resolveToolAnnotations}
            />
          )
        }
      </Static>
      {/* Live area — prologue (only while pure-prologue), then live messages,
          then the streaming row. flexShrink={0} on the inner column lets the
          rows take their natural height; the parent's overflow="hidden" still
          guards against pathological overflow pushing the prompt off-screen. */}
      <Box flexDirection="column" flexShrink={0}>
        {props.prologue && !prologueGoesStatic && <Box>{props.prologue}</Box>}
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
