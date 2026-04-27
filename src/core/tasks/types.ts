// src/core/tasks/types.ts
//
// Phase 10 §4.3 — polymorphic background tasks.
//
// Three task kinds:
//   - local_bash    — spawn a child process, capture stdout/stderr to disk.
//   - local_agent   — run a Phase-5 dispatchAgent invocation in the
//                      background. The runner accepts an injected
//                      `agentRunner: () => AsyncIterable<AgentChunk>` so
//                      the task subsystem stays testable without coupling
//                      to the full agent loop (production code wires
//                      dispatchAgent into the injection).
//   - monitor_mcp   — subscribe to a long-running MCP tool's progress
//                      events. Same injection pattern: caller supplies
//                      `eventStream: () => AsyncIterable<ProgressEvent>`.
//
// Tasks expose a stable lifecycle (`pending` → `running` → `completed` |
// `failed` | `killed`) and persist their textual output under
// `<home>/.nuka/tasks/<id>.log`.

export type TaskKind = 'local_bash' | 'local_agent' | 'monitor_mcp'

export type TaskState =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'killed'

/** Discriminated union — each kind carries its own spec. */
export type TaskSpec =
  | LocalBashSpec
  | LocalAgentSpec
  | MonitorMcpSpec

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

/** Progress event surfaced by a long-running MCP tool. */
export type ProgressEvent = {
  /** Free-form progress message (rendered to outputFile as a line). */
  message: string
  /** When `done` is true the runner transitions the task to `completed`. */
  done?: boolean
  /** When set with `done: true`, the task transitions to `failed`. */
  error?: string
}

export type MonitorMcpSpec = {
  kind: 'monitor_mcp'
  description: string
  eventStream: (signal: AbortSignal) => AsyncIterable<ProgressEvent>
}

export type Task = {
  id: string
  kind: TaskKind
  description: string
  state: TaskState
  startedAt?: number
  finishedAt?: number
  exitCode?: number
  /** Absolute path to the on-disk output log. */
  outputFile: string
  spec: TaskSpec
  /** Last error message (set when state === 'failed'). */
  error?: string
}

export type TaskChangeListener = (t: Task) => void
