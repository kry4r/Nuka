import type { TaskProfile, Difficulty, TestStrategy } from '../harness/types'

/** ULID-shaped string identifier for sub-tasks within a TaskGraph. */
export type SubTaskId = string

/**
 * A single executable unit within the harness's coordination layer.
 *
 * - `pending`   — declared, not yet picked up
 * - `running`   — an agent is actively working on it
 * - `listening` — main work done, agent stays subscribed for downstream a2a (hell mode)
 * - `done`      — terminal success
 * - `failed`    — terminal failure
 */
export type SubTask = {
  id: SubTaskId
  title: string
  /** Profile inherited (or overridden) for this sub-task. */
  profile: TaskProfile
  /** Test strategy picked for this sub-task. */
  testStrategy: TestStrategy
  /** Subagent assigned to this task, or null if not yet dispatched. */
  agentId: string | null
  status: 'pending' | 'running' | 'listening' | 'done' | 'failed'
  /** Sub-tasks that must reach `done` before this one becomes `ready`. */
  dependsOn: SubTaskId[]
  /** Reverse index: when these tasks start, this task's owner agent should be notified (hell mode). */
  contextFor: SubTaskId[]
  result: { summary: string; artifacts: string[] } | null
}

/**
 * The full coordination graph for a single user message.
 *
 * `correlations` records semantically-coupled task pairs whose interaction must
 * be exercised by review-stage tests (see `correlation.ts`).
 */
export type TaskGraph = {
  rootMessage: string
  difficulty: Difficulty
  nodes: Record<SubTaskId, SubTask>
  correlations: Array<{ between: [SubTaskId, SubTaskId]; reason: string }>
}

/**
 * Subscription registered by an agent that has finished its primary work but
 * remains in `listening` state to push event-driven supplements to downstream
 * sub-tasks.
 *
 * `lifecycle` controls auto-cleanup:
 *   - `until-correlated-tasks-done` — unsubscribe when every taskId in `triggersOn`
 *     has reached terminal state (done|failed)
 *   - `until-session-end` — survive until the harness session shuts down
 *
 * `triggerCount` is incremented by the router each time the subscription fires,
 * with an upper bound (3) enforced by `a2aRouter.ts` to prevent loops.
 */
export type A2ASubscription = {
  subscriberAgentId: string
  ownsTaskId: SubTaskId
  triggersOn: SubTaskId[]
  triggerCount: number
  lifecycle: 'until-correlated-tasks-done' | 'until-session-end'
}
