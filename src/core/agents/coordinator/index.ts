// src/core/agents/coordinator/index.ts
export { runCoordinator } from './coordinator'
export type { CoordinatorDeps } from './coordinator'
export { Blackboard } from './blackboard'
export { composeWorkerPrompt, isDone } from './prompt'
export type {
  AgentSpec,
  CoordinatorInput,
  CoordinatorResult,
  WorkerOutcome,
  BlackboardSnapshot,
} from './types'
