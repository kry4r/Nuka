import type { Task, TaskState, ProgressTrackerSnapshot } from '../tasks/types'
import type { MessageEnvelope } from '../messaging/types'

export type Topic = 'task' | 'agent' | 'message' | 'harness'

export type TaskEvent =
  | { type: 'task.created'; task: Task }
  | { type: 'task.state'; id: string; from: TaskState; to: TaskState }
  | { type: 'task.progress'; id: string; snapshot: ProgressTrackerSnapshot }
  | { type: 'task.evicted'; id: string }

export type AgentBusEvent =
  | { type: 'agent.tool.start'; sessionId: string; toolName: string; input: unknown }
  | { type: 'agent.tool.end'; sessionId: string; toolName: string; ok: boolean; durationMs: number }
  | { type: 'agent.message.assistant'; sessionId: string; text: string }
  | { type: 'agent.usage'; sessionId: string; inputTokens: number; outputTokens: number }

export type MessageEvent =
  | { type: 'message.sent'; envelope: MessageEnvelope }
  | { type: 'message.delivered'; envelopeId: string; to: string }
  | { type: 'message.failed'; envelopeId: string; reason: string }

export type HarnessStage =
  | 'brainstorm' | 'spec' | 'plan' | 'search'
  | 'implement' | 'review' | 'recap'

export type HarnessEvent =
  | { type: 'harness.stage.enter'; stage: HarnessStage; sessionId: string }
  | { type: 'harness.stage.exit'; stage: HarnessStage; sessionId: string; reason: string }
  | { type: 'harness.editor.directive'; sessionId: string; directive: string }
  // coordination layer events (T3+: task graph + a2a router)
  | { type: 'coordination.task.created'; sessionId: string; taskId: string; agentId?: string }
  | { type: 'coordination.task.started'; sessionId: string; taskId: string; agentId: string }
  | { type: 'coordination.task.completed'; sessionId: string; taskId: string; agentId: string }
  | { type: 'coordination.a2a.dispatched'; sessionId: string; from: string; to: string; reason: string }

export type EventPayload<T extends Topic> =
  T extends 'task' ? TaskEvent :
  T extends 'agent' ? AgentBusEvent :
  T extends 'message' ? MessageEvent :
  T extends 'harness' ? HarnessEvent :
  never

export type EventRecord =
  | { seq: number; t: number; topic: 'task'; payload: TaskEvent }
  | { seq: number; t: number; topic: 'agent'; payload: AgentBusEvent }
  | { seq: number; t: number; topic: 'message'; payload: MessageEvent }
  | { seq: number; t: number; topic: 'harness'; payload: HarnessEvent }
