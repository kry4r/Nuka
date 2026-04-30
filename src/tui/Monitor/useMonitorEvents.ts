// src/tui/Monitor/useMonitorEvents.ts
//
// Phase 14b review fix — live subscription hook for MonitorSubmenu.
// Mirrors the useTasksColumns pattern: useReducer + useEffect + bus.subscribe.
import { useEffect, useReducer } from 'react'
import type { EventBus } from '../../core/events/bus'
import type { TaskEvent, AgentBusEvent, MessageEvent, HarnessEvent } from '../../core/events/types'

export type MonitorEventItem = {
  t: number
  topic: 'task' | 'agent' | 'message' | 'harness'
}

export type AgentUsageItem = {
  agentName: string
  inputTokens: number
  outputTokens: number
}

type BucketedState = {
  task: TaskEvent[]
  agent: AgentBusEvent[]
  message: MessageEvent[]
  harness: HarnessEvent[]
  events: MonitorEventItem[]
  agentUsage: AgentUsageItem[]
}

type Dispatch = {
  topic: 'task' | 'agent' | 'message' | 'harness'
  payload: unknown
  t: number
}

function initialState(): BucketedState {
  return { task: [], agent: [], message: [], harness: [], events: [], agentUsage: [] }
}

function monitorReducer(prev: BucketedState, ev: Dispatch): BucketedState {
  const { topic, payload, t } = ev
  const arr = prev[topic] as unknown[]
  const nextArr = [...arr.slice(-499), payload] as never[]

  // Rebuild flat timeline events list
  const nextEvents: MonitorEventItem[] = [...prev.events.slice(-499), { t, topic }]

  // Rebuild agentUsage if this is an agent.usage event
  let nextAgentUsage = prev.agentUsage
  if (topic === 'agent') {
    const p = payload as AgentBusEvent
    if (p.type === 'agent.usage') {
      const name = p.sessionId
      const existing = nextAgentUsage.find(u => u.agentName === name)
      if (existing) {
        nextAgentUsage = nextAgentUsage.map(u =>
          u.agentName === name
            ? { ...u, inputTokens: p.inputTokens, outputTokens: u.outputTokens + p.outputTokens }
            : u,
        )
      } else {
        nextAgentUsage = [
          ...nextAgentUsage,
          { agentName: name, inputTokens: p.inputTokens, outputTokens: p.outputTokens },
        ]
      }
    }
  }

  return {
    ...prev,
    [topic]: nextArr,
    events: nextEvents,
    agentUsage: nextAgentUsage,
  }
}

export function useMonitorEvents(bus: EventBus): {
  events: MonitorEventItem[]
  agentUsage: AgentUsageItem[]
} {
  const [state, dispatch] = useReducer(monitorReducer, null, initialState)

  useEffect(() => {
    const offs = (['task', 'agent', 'message', 'harness'] as const).map(topic =>
      bus.subscribe(topic, (payload: unknown) =>
        dispatch({ topic, payload, t: Date.now() }),
      ),
    )
    // Seed with prior ring-buffer contents.
    for (const topic of ['task', 'agent', 'message', 'harness'] as const) {
      for (const payload of bus.replay(topic, 500)) {
        dispatch({ topic, payload, t: Date.now() })
      }
    }
    return () => { for (const off of offs) off() }
  }, [bus])

  return { events: state.events, agentUsage: state.agentUsage }
}
