// src/core/tasks/outputTool.ts
//
// TaskOutput — read stdout/stderr (and current state) of a background task
// managed by {@link TaskManager}. Complements the TaskList family from iter G,
// but operates on the *execution* layer (background subprocess registry), not
// the agent-facing TODO list.
//
// Two modes:
//   - block=false (default `block=true`, but callers may opt out) → return
//     the current state and last N lines immediately.
//   - block=true  → poll the manager until the task settles (completed /
//     failed / killed) or `timeout` ms elapses. Returns whatever it has
//     at the end with a `retrieval_status` field so the caller can tell.
//
// Mirrors the upstream Nuka-Code TaskOutputTool surface (task_id / block /
// timeout) but trimmed — no React UI, no Bash-task-specific live taskOutput
// object (Nuka persists everything to disk via run-bash.ts → appendOutputSync).
//
// Output is read from `task.outputFile` via {@link tailOutput}; we cap the
// number of lines returned so the model doesn't blow its context on a
// noisy long-running task.

import type { Tool } from '../tools/types'
import { defineTool } from '../tools/define'
import { tailOutput } from './persist'
import type { Task, TaskState } from './types'
import { findLatestMetaByAgentId, type TaskMeta } from './meta'
import {
  cleanLookupId,
  findTaskByAgentId,
  type TaskLookupManagerLike,
} from './lookup'

/**
 * The subset of {@link TaskManager} we depend on. Letting tests pass a
 * minimal stub keeps the test surface small and avoids spinning up a real
 * manager + tmpdir for every assertion.
 */
export type TaskOutputManagerLike = {
  get(id: string): Task | undefined
  list(): Task[]
  on(event: 'change', cb: (t: Task) => void): () => void
}

export type TaskOutputToolInput = {
  task_id?: string
  /** Stable local subagent ID. Used only when task_id is omitted. */
  agent_id?: string
  /** When true, poll until the task settles or `timeout_ms` elapses. */
  block?: boolean
  /** Max wait when `block === true`. Defaults to 30s; clamped to [0, 600_000]. */
  timeout_ms?: number
  /** Max lines of output to return. Defaults to 200; clamped to [1, 5_000]. */
  lines?: number
}

export type TaskOutputRetrievalStatus = 'success' | 'timeout' | 'not_found'

export type TaskOutputToolOpts = {
  home?: string
}

const DEFAULT_LINES = 200
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_LINES = 5_000
const MAX_TIMEOUT_MS = 600_000
const TERMINAL_STATES: ReadonlySet<TaskState> = new Set([
  'completed',
  'failed',
  'killed',
])

function isTerminal(state: TaskState): boolean {
  return TERMINAL_STATES.has(state)
}

function resolveTask(
  manager: TaskLookupManagerLike,
  opts: TaskOutputToolOpts,
  input: Pick<TaskOutputToolInput, 'task_id' | 'agent_id'>,
): { task?: Task; meta?: TaskMeta; error?: string } {
  const taskId = cleanLookupId(input.task_id)
  if (taskId) {
    const task = manager.get(taskId)
    if (!task) return { error: `No background task with id '${taskId}'.` }
    return { task }
  }

  const agentId = cleanLookupId(input.agent_id)
  if (!agentId) {
    return { error: 'task_id or agent_id is required.' }
  }
  const task = findTaskByAgentId(manager, agentId)
  if (task) return { task }
  const meta = opts.home ? findLatestMetaByAgentId(opts.home, agentId) : undefined
  if (meta?.kind === 'local_agent') return { meta }
  else {
    return {
      error: `No background task with agent id '${agentId}'.`,
    }
  }
}

function renderOutput(
  task: Task,
  outputLines: string[],
  status: TaskOutputRetrievalStatus,
): string {
  const parts: string[] = []
  parts.push(`task_id=${task.id}`)
  parts.push(`kind=${task.kind}`)
  parts.push(`state=${task.state}`)
  parts.push(`retrieval_status=${status}`)
  if (task.agentId) parts.push(`agent_id=${task.agentId}`)
  if (task.exitCode !== undefined) parts.push(`exit_code=${task.exitCode}`)
  if (task.error) parts.push(`error=${task.error}`)
  parts.push(`description=${task.description}`)
  parts.push('---')
  if (outputLines.length === 0) {
    parts.push('(no output yet)')
  } else {
    parts.push(outputLines.join('\n'))
  }
  return parts.join('\n')
}

function renderPersistedOutput(
  meta: TaskMeta,
  status: TaskOutputRetrievalStatus,
): string {
  const parts: string[] = []
  parts.push(`task_id=${meta.id}`)
  parts.push(`kind=${meta.kind}`)
  parts.push(`state=${meta.state}`)
  parts.push(`retrieval_status=${status}`)
  if (meta.agentId) parts.push(`agent_id=${meta.agentId}`)
  if (meta.finishedAt !== undefined) parts.push(`finished_at=${meta.finishedAt}`)
  const description = meta.agentName && meta.agentTask
    ? `${meta.agentName}: ${meta.agentTask}`
    : meta.agentTask ?? meta.agentName ?? meta.id
  parts.push(`description=${description}`)
  parts.push('---')
  parts.push(meta.finalOutput?.trim() || '(no output available)')
  return parts.join('\n')
}

/**
 * Wait for `task` to enter a terminal state or `timeoutMs` to elapse.
 * Subscribes to `manager.on('change', ...)` so we don't busy-poll. If the
 * abort signal fires, resolves with whatever we have right now.
 */
async function waitForTerminal(
  manager: TaskOutputManagerLike,
  taskId: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<Task | undefined> {
  const initial = manager.get(taskId)
  if (!initial) return undefined
  if (isTerminal(initial.state)) return initial
  if (timeoutMs <= 0) return initial

  return new Promise<Task | undefined>((resolve) => {
    let settled = false
    let timer: NodeJS.Timeout | undefined
    const off = manager.on('change', (t) => {
      if (settled) return
      if (t.id !== taskId) return
      if (!isTerminal(t.state)) return
      settled = true
      off()
      if (timer) clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve(t)
    })
    const finishCurrent = () => {
      if (settled) return
      settled = true
      off()
      signal.removeEventListener('abort', onAbort)
      resolve(manager.get(taskId))
    }
    const onAbort = () => {
      if (timer) clearTimeout(timer)
      finishCurrent()
    }
    timer = setTimeout(() => {
      timer = undefined
      finishCurrent()
    }, timeoutMs)
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      ;(timer as { unref: () => void }).unref()
    }
    if (signal.aborted) {
      onAbort()
    } else {
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

export function makeTaskOutputTool(
  manager: TaskOutputManagerLike,
  opts: TaskOutputToolOpts = {},
): Tool<TaskOutputToolInput> {
  return defineTool<TaskOutputToolInput>({
    name: 'TaskOutput',
    description:
      'Read stdout/stderr and current state of a background task by task_id, or by stable local subagent agent_id. Returns the last N lines of output plus task metadata (state, exit code, error). With block=true (default), waits up to timeout_ms for the task to finish. Use TaskList (or the /tasks slash) to discover IDs.',
    parameters: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description:
            'Background task ID (from TaskManager.list()). Takes precedence over agent_id.',
          minLength: 1,
        },
        agent_id: {
          type: 'string',
          description:
            'Stable local subagent ID. Used when task_id is omitted; the newest matching execution record is selected.',
          minLength: 1,
        },
        block: {
          type: 'boolean',
          description:
            'Wait for the task to reach a terminal state (completed / failed / killed) before returning. Default true.',
        },
        timeout_ms: {
          type: 'integer',
          description: `Max wait in milliseconds when block=true. Default ${DEFAULT_TIMEOUT_MS}; clamped to [0, ${MAX_TIMEOUT_MS}].`,
          minimum: 0,
          maximum: MAX_TIMEOUT_MS,
        },
        lines: {
          type: 'integer',
          description: `Max number of trailing output lines to return. Default ${DEFAULT_LINES}; clamped to [1, ${MAX_LINES}].`,
          minimum: 1,
          maximum: MAX_LINES,
        },
      },
    },
    source: 'builtin',
    tags: ['core', 'tasks'],
    needsPermission: () => 'none',
    annotations: { readOnly: true, parallelSafe: true },
    searchHint: ['task', 'agent', 'output', 'log', 'background', 'stdout', 'stderr'],
    async run(input, ctx) {
      const resolved = resolveTask(manager, opts, input)
      if (resolved.meta) {
        return {
          isError: false,
          output: renderPersistedOutput(resolved.meta, 'success'),
        }
      }
      if (resolved.error || !resolved.task) {
        return { isError: true, output: resolved.error ?? 'task_id or agent_id is required.' }
      }
      const id = resolved.task.id
      const block = input.block !== false
      const timeoutMs = Math.max(
        0,
        Math.min(MAX_TIMEOUT_MS, input.timeout_ms ?? DEFAULT_TIMEOUT_MS),
      )
      const maxLines = Math.max(
        1,
        Math.min(MAX_LINES, input.lines ?? DEFAULT_LINES),
      )

      let task = resolved.task

      let status: TaskOutputRetrievalStatus = 'success'
      if (block && !isTerminal(task.state)) {
        const after = await waitForTerminal(manager, id, timeoutMs, ctx.signal)
        if (after) task = after
        if (!isTerminal(task.state)) status = 'timeout'
      }

      let lines: string[] = []
      try {
        lines = await tailOutput(task.outputFile, maxLines)
      } catch (err) {
        lines = [
          `(failed to read output file: ${(err as Error).message ?? err})`,
        ]
      }

      return {
        isError: false,
        output: renderOutput(task, lines, status),
      }
    },
  })
}
