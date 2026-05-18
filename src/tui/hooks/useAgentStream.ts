// src/tui/hooks/useAgentStream.ts
import { useCallback, useRef, useState } from 'react'
import type { AgentEvent } from '../../core/agent/events'
import type { AssistantMessage, ContentBlock, ImageContentBlock } from '../../core/message/types'
import { emptyAssistant } from '../../core/message/factories'

export type SendOpts = {
  /** Provider-bound image attachments resolved by `inlineReferencesIntoText`. */
  images?: readonly ImageContentBlock[]
}

export type AgentStreamDeps = {
  /**
   * Wrapped agent driver. `input.images` carries optional provider-bound
   * image attachments alongside the user's text prompt; text-only callers
   * may omit the field entirely.
   */
  runAgent: (
    input: { text: string; images?: readonly ImageContentBlock[] },
    signal: AbortSignal,
  ) => AsyncIterable<AgentEvent>
}

/**
 * Append/extend a `text` ContentBlock on the in-flight assistant. Returns a
 * new AssistantMessage so React detects the state change.
 *
 * Note: `tool_call` AgentEvents arrive AFTER the assistant turn has already
 * been appended to `session.messages` (see runAgent in core/agent/loop.ts).
 * We therefore only mirror text deltas here — tool_use blocks become visible
 * via the static-rendered messages.
 */
function applyTextDelta(prev: AssistantMessage | null, text: string): AssistantMessage {
  const base = prev ?? emptyAssistant()
  const content: ContentBlock[] = base.content.slice()
  const last = content[content.length - 1]
  if (last && last.type === 'text') {
    content[content.length - 1] = { type: 'text', text: last.text + text }
  } else {
    content.push({ type: 'text', text })
  }
  return { ...base, content }
}

export function useAgentStream(deps: AgentStreamDeps): {
  events: AgentEvent[]
  progressByToolId: Record<string, string[]>
  running: boolean
  streamingAssistant: AssistantMessage | null
  send: (text: string, opts?: SendOpts) => Promise<void>
  cancel: () => void
  reset: () => void
} {
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [progressByToolId, setProgressByToolId] = useState<Record<string, string[]>>({})
  const [running, setRunning] = useState(false)
  const [streamingAssistant, setStreamingAssistant] = useState<AssistantMessage | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const send = useCallback(async (text: string, opts?: SendOpts) => {
    const ac = new AbortController()
    abortRef.current = ac
    setRunning(true)
    setStreamingAssistant(null)
    try {
      // Only forward `images` when present so the legacy text-only path
      // observes the identical `{ text }` shape it had before.
      const input = opts?.images !== undefined
        ? { text, images: opts.images }
        : { text }
      for await (const ev of deps.runAgent(input, ac.signal)) {
        setEvents(prev => [...prev, ev])
        if (ev.type === 'text_delta') {
          setStreamingAssistant(prev => applyTextDelta(prev, ev.text))
        } else if (ev.type === 'tool_progress') {
          setProgressByToolId(prev => {
            const existing = prev[ev.id] ?? []
            return { ...prev, [ev.id]: [...existing, ev.text] }
          })
        } else if (ev.type === 'turn_end') {
          setStreamingAssistant(null)
        } else if (ev.type === 'tool_call') {
          // Assistant turn is already appended to session.messages by now; the
          // in-flight node is stale. Drop it so we don't double-render the text.
          setStreamingAssistant(null)
        }
      }
    } catch (err) {
      setEvents(prev => [...prev, { type: 'error', error: err as Error }])
      setStreamingAssistant(null)
    } finally {
      setRunning(false)
      setStreamingAssistant(null)
    }
  }, [deps])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    setStreamingAssistant(null)
  }, [])
  const reset = useCallback(() => {
    setEvents([])
    setProgressByToolId({})
    setStreamingAssistant(null)
  }, [])

  return { events, progressByToolId, running, streamingAssistant, send, cancel, reset }
}
