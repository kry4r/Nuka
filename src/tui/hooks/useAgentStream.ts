// src/tui/hooks/useAgentStream.ts
import { useCallback, useRef, useState } from 'react'
import type { AgentEvent } from '../../core/agent/events'

export type AgentStreamDeps = {
  runAgent: (input: { text: string }, signal: AbortSignal) => AsyncIterable<AgentEvent>
}

export function useAgentStream(deps: AgentStreamDeps): {
  events: AgentEvent[]
  progressByToolId: Record<string, string[]>
  running: boolean
  send: (text: string) => Promise<void>
  cancel: () => void
  reset: () => void
} {
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [progressByToolId, setProgressByToolId] = useState<Record<string, string[]>>({})
  const [running, setRunning] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const send = useCallback(async (text: string) => {
    const ac = new AbortController()
    abortRef.current = ac
    setRunning(true)
    try {
      for await (const ev of deps.runAgent({ text }, ac.signal)) {
        setEvents(prev => [...prev, ev])
        if (ev.type === 'tool_progress') {
          setProgressByToolId(prev => {
            const existing = prev[ev.id] ?? []
            return { ...prev, [ev.id]: [...existing, ev.text] }
          })
        }
      }
    } catch (err) {
      setEvents(prev => [...prev, { type: 'error', error: err as Error }])
    } finally {
      setRunning(false)
    }
  }, [deps])

  const cancel = useCallback(() => abortRef.current?.abort(), [])
  const reset = useCallback(() => { setEvents([]); setProgressByToolId({}) }, [])

  return { events, progressByToolId, running, send, cancel, reset }
}
