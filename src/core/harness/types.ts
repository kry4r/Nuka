export type TaskProfile =
  | 'feature' | 'debug-fix' | 'refactor'
  | 'investigate' | 'doc' | 'odd-jobs'

export type Difficulty = 'simple' | 'medium' | 'hard' | 'hell'
export type TestStrategy = 'tdd' | 'cross-module' | 'multi-test'

export type HarnessStage =
  | 'brainstorm' | 'spec' | 'plan' | 'search'
  | 'implement' | 'review' | 'recap'

export type HarnessMode = 'deep' | 'fast' | 'off'
export type StageRequirement = 'mandatory' | 'optional' | 'forbidden'

export type Triage = {
  profile: TaskProfile
  difficulty: Difficulty
  testStrategy: TestStrategy
  reasoning: string
  userConfirmed: boolean
}

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
  triage: Triage | null
  currentStage: HarnessStage | null
  history: StageEntry[]
  scratchpadPath: string
  taskGraphPath: string
  startedAt: number
}
