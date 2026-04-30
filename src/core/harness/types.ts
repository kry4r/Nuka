// src/core/harness/types.ts
export type TaskProfile = 'explore' | 'fix' | 'refactor' | 'feature' | 'docs' | 'config' | 'research'
export type HarnessStage = 'brainstorm' | 'spec' | 'plan' | 'search' | 'implement' | 'review' | 'recap'
export type HarnessMode = 'deep' | 'fast' | 'off'
export type StageRequirement = 'mandatory' | 'optional' | 'forbidden'

export type StageEntry = {
  stage: HarnessStage
  enteredAt: number
  exitedAt?: number
  workersSpawned: Array<{ taskId: string; agentName: string }>
  primitivesSeen: { sequentialThinking: boolean; searchAndVerify: boolean; askUser: boolean }
  exitReason?: 'completed' | 'aborted' | 'reentered' | 'fast-path-skipped'
}

export type HarnessState = {
  sessionId: string
  mode: HarnessMode
  taskProfile: TaskProfile | null
  currentStage: HarnessStage | null
  history: StageEntry[]
  scratchpadPath: string
  startedAt: number
}
