// src/core/agents/coordinator/types.ts
//
// B5 — Coordinator types. Layered above dispatchAgent; nothing here
// imports from the runtime modules so types can be referenced from tool
// definitions without pulling the orchestration code.

export type AgentSpec = {
  /** Qualified agent name (`<plugin>:<name>`) — same shape `dispatch_agent` accepts. */
  name: string
  /** Per-agent task prompt; embedded into the worker's first user message. */
  task: string
  /** Optional context appended after the task — matches dispatchAgent.context. */
  context?: string
}

export type CoordinatorInput = {
  /** Shared high-level goal — surfaced to every worker via the prompt template. */
  goal: string
  /** Workers to fan out per iteration. Must be non-empty. */
  agents: AgentSpec[]
  /** Hard cap on coordinator iterations. Each iteration re-spawns workers. */
  maxIterations: number
}

export type WorkerOutcome = {
  name: string
  status: 'ok' | 'error' | 'aborted'
  /** Final assistant text (truncated to 4 KiB) or error message. */
  summary: string
  turns: number
  error: string | undefined
}

export type BlackboardSnapshot = {
  [key: string]: string
}

export type CoordinatorResult = {
  /** Number of iterations actually run (1 if everyone said done first time). */
  iterations: number
  /** Final blackboard snapshot — read-only view for the caller. */
  blackboard: BlackboardSnapshot
  /** Per-worker outcomes from the FINAL iteration (errors here are isolated, not fatal). */
  outcomes: WorkerOutcome[]
  /** True when the iteration cap was reached without every worker reporting done. */
  hitCap: boolean
}
