// src/core/tasks/types.ts
//
// Phase 10 §4.3 — polymorphic background tasks.
//
// Two task kinds:
//   - local_bash    — spawn a child process, capture stdout/stderr to disk.
//   - local_agent   — run a Phase-5 dispatchAgent invocation in the
//                      background. The runner accepts an injected
//                      `agentRunner: () => AsyncIterable<AgentChunk>` so
//                      the task subsystem stays testable without coupling
//                      to the full agent loop (production code wires
//                      dispatchAgent into the injection).
//
// Tasks expose a stable lifecycle (`pending` → `running` → `completed` |
// `failed` | `killed`) and persist their textual output under
// `<home>/.nuka/tasks/<id>.log`.

import type { ResolvedAgentDef } from '../agents/types'
import type { ProgressTrackerSnapshot } from './progressTracker'

export type { ProgressTrackerSnapshot } from './progressTracker'

export type TaskKind =
  | 'local_bash'
  | 'local_agent'
  | 'in_process_teammate'
  | 'local_shell'
  | 'remote_agent'
  | 'dream'

export type TaskState =
  | 'pending'
  | 'running'
  | 'idle'
  | 'completed'
  | 'failed'
  | 'killed'
  | 'shutdown_requested'

export type LocalBashSpec = {
  kind: 'local_bash'
  description: string
  command: string
  args?: string[]
  /** Optional cwd; defaults to process.cwd() at run time. */
  cwd?: string
  /** Optional env override; merged on top of process.env. */
  env?: Record<string, string>
}

/**
 * An async-iterable chunk of agent output. Kept loose on purpose so the
 * runner doesn't import from Phase-5 message types — production callers
 * stringify the chunks they care about into `text` before yielding.
 */
export type AgentChunk = { text: string }

export type LocalAgentSpec = {
  kind: 'local_agent'
  description: string
  /** Returns an async iterable of textual chunks. The runner persists
   *  each chunk to the task's outputFile in order. */
  agentRunner: (signal: AbortSignal) => AsyncIterable<AgentChunk>
}

export type InProcessTeammateSpec = {
  kind: 'in_process_teammate'
  description: string
  teamName: string
  agentName: string
  agentDef: ResolvedAgentDef
  initialMessage: string
  longRunning: boolean
}

export type LocalShellSpec = {
  kind: 'local_shell'
  description: string
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  pty: boolean
}

export type RemoteAgentSpec = {
  kind: 'remote_agent'
  description: string
  transport: { kind: string; addr: string }
  initialMessage: string
}

export type DreamSpec = {
  kind: 'dream'
  description: string
  consolidationPrompt: string
  parentSessionId: string
}

/** Discriminated union — each kind carries its own spec. */
export type TaskSpec =
  | LocalBashSpec
  | LocalAgentSpec
  | InProcessTeammateSpec
  | LocalShellSpec
  | RemoteAgentSpec
  | DreamSpec

export type Task = {
  id: string
  kind: TaskKind
  description: string
  state: TaskState
  startedAt?: number
  finishedAt?: number
  exitCode?: number
  outputFile: string
  spec: TaskSpec
  error?: string
  agentName?: string
  teamName?: string
  progress?: ProgressTrackerSnapshot
  evictAfter?: number
}

export type TaskChangeListener = (t: Task) => void
