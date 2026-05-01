// src/tui/Monitor/useMonitorEvents.ts
//
// Phase 14b review fix — live subscription hook for MonitorSubmenu.
// Mirrors the useTasksColumns pattern: useReducer + useEffect + bus.subscribe.
//
// T8.4 — coordination.* harness events are routed to a separate visual lane
// (`coordination`) rather than the generic `harness` lane.
import { useEffect, useReducer } from 'react'
import type { EventBus } from '../../core/events/bus'
import type { TaskEvent, AgentBusEvent, MessageEvent, HarnessEvent } from '../../core/events/types'
import type { TimelineLane } from './bucketTimeline'

export type MonitorEventItem = {
  t: number
  /** Visualization lane. Note: `coordination` is derived in the reducer
   *  from harness payloads whose `type` starts with `coordination.`. */
  topic: TimelineLane
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
  coordination: HarnessEvent[]
  events: MonitorEventItem[]
  agentUsage: AgentUsageItem[]
}

type BusTopic = 'task' | 'agent' | 'message' | 'harness'
type Dispatch = {
  topic: BusTopic
  payload: unknown
  t: number
}

function initialState(): BucketedState {
  return { task: [], agent: [], message: [], harness: [], coordination: [], events: [], agentUsage: [] }
}

/**
 * Decide which visualization lane a payload belongs to. Bus topics task/agent/
 * message map 1:1 to lanes. Harness topic is split: `coordination.*` events
 * go to the coordination lane, everything else to harness.
 */
function laneOf(topic: BusTopic, payload: unknown): TimelineLane {
  if (topic !== 'harness') return topic
  const t = (payload as { type?: string } | null)?.type ?? ''
  return t.startsWith('coordination.') ? 'coordination' : 'harness'
}

function monitorReducer(prev: BucketedState, ev: Dispatch): BucketedState {
  const { topic, payload, t } = ev
  const lane = laneOf(topic, payload)
  // Store the typed payload in either harness or coordination bucket.
  let nextHarness = prev.harness
  let nextCoordination = prev.coordination
  let nextTask = prev.task
  let nextAgent = prev.agent
  let nextMessage = prev.message

  if (topic === 'harness') {
    if (lane === 'coordination') {
      nextCoordination = [...prev.coordination.slice(-499), payload as HarnessEvent]
    } else {
      nextHarness = [...prev.harness.slice(-499), payload as HarnessEvent]
    }
  } else if (topic === 'task') {
    nextTask = [...prev.task.slice(-499), payload as TaskEvent]
  } else if (topic === 'agent') {
    nextAgent = [...prev.agent.slice(-499), payload as AgentBusEvent]
  } else if (topic === 'message') {
    nextMessage = [...prev.message.slice(-499), payload as MessageEvent]
  }

  // Rebuild flat timeline events list using the visualization lane.
  const nextEvents: MonitorEventItem[] = [...prev.events.slice(-499), { t, topic: lane }]

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
    task: nextTask,
    agent: nextAgent,
    message: nextMessage,
    harness: nextHarness,
    coordination: nextCoordination,
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
