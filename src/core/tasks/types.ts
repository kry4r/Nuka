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
import type { HookRegistry } from '../hooks/registry'
import type { GitRunner } from '../worktree/git'

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

export type LocalAgentWorktreeSpec = [
  path: string,
  repoRoot: string,
]

export type LocalAgentWriteScope = {
  /** Paths this logical subagent is expected to own or edit. Descriptive only for now. */
  allow?: string[]
  /** Paths this logical subagent should avoid. Descriptive only for now. */
  deny?: string[]
  /** Free-form scope note from the parent agent. */
  note?: string
}

export type LocalAgentSpec = {
  kind: 'local_agent'
  description: string
  /** Qualified agent definition name, for lifecycle/resume UI. */
  agentName?: string
  /** Original task prompt for this execution. */
  task?: string
  /** Optional context supplied with the task prompt. */
  context?: string
  /** True when this execution resumes a prior logical subagent. */
  resumed?: boolean
  /**
   * Stable subagent identity. Defaults to `agent-<task id>` when omitted.
   * Kept separate from task id so future resume/send/wait APIs can address
   * the logical agent while TaskManager keeps owning execution records.
   */
  agentId?: string
  /** Returns an async iterable of textual chunks. The runner persists
   *  each chunk to the task's outputFile in order. */
  agentRunner: (signal: AbortSignal) => AsyncIterable<AgentChunk>
  /**
   * Optional in-process hook registry. When provided, `runAgent` fires
   * `sessionStart` / `sessionEnd` / `afterTurn` with `context: 'task'`.
   * Absent → no events fire (backward-compat for any test fixture that
   * builds a spec without lifecycle wiring).
   */
  hookRegistry?: HookRegistry
  /**
   * Stable identifier used in the lifecycle payloads' `sessionId` field.
   * Defaults to the task id (assigned by `TaskManager.enqueue`) when
   * omitted. Surface as a separate field so callers can correlate a
   * task to a parent session if they wish.
   */
  taskSessionId?: string
  /**
   * Provider/model strings forwarded into `sessionStart` payload so
   * handlers can branch on model identity. Falls back to `'unknown'` /
   * `'unknown'` when the caller does not know (purely metadata).
   */
  providerId?: string
  model?: string
  /** Effective cwd/worktree path for this local-agent execution. */
  cwd?: string
  /** Descriptive write ownership metadata for forked/background subagents. */
  writeScope?: LocalAgentWriteScope
  /** Worktree lifecycle tuple: [path, repoRoot]. Clean trees are removed; dirty trees are kept. */
  worktree?: LocalAgentWorktreeSpec
  /** Optional mockable git runner for worktree cleanup. */
  gitRunner?: GitRunner
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
  agentId?: string
  agentName?: string
  teamName?: string
  progress?: ProgressTrackerSnapshot
  evictAfter?: number
}

export type TaskChangeListener = (t: Task) => void
