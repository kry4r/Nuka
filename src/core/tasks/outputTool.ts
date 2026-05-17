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
import type { TaskManager } from './manager'
import type { Task, TaskState } from './types'

/**
 * The subset of {@link TaskManager} we depend on. Letting tests pass a
 * minimal stub keeps the test surface small and avoids spinning up a real
 * manager + tmpdir for every assertion.
 */
export type TaskOutputManagerLike = {
  get(id: string): Task | undefined
  on(event: 'change', cb: (t: Task) => void): () => void
}

export type TaskOutputToolInput = {
  task_id: string
  /** When true, poll until the task settles or `timeout_ms` elapses. */
  block?: boolean
  /** Max wait when `block === true`. Defaults to 30s; clamped to [0, 600_000]. */
  timeout_ms?: number
  /** Max lines of output to return. Defaults to 200; clamped to [1, 5_000]. */
  lines?: number
}

export type TaskOutputRetrievalStatus = 'success' | 'timeout' | 'not_found'

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
): Tool<TaskOutputToolInput> {
  return defineTool<TaskOutputToolInput>({
    name: 'TaskOutput',
    description:
      'Read stdout/stderr and current state of a background task by its ID. Returns the last N lines of output plus task metadata (state, exit code, error). With block=true (default), waits up to timeout_ms for the task to finish. Use TaskList (or the /tasks slash) to discover IDs.',
    parameters: {
      type: 'object',
      required: ['task_id'],
      properties: {
        task_id: {
          type: 'string',
          description: 'Background task ID (from TaskManager.list()).',
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
    searchHint: ['task', 'output', 'log', 'background', 'stdout', 'stderr'],
    async run(input, ctx) {
      const id = input.task_id?.trim()
      if (!id) {
        return { isError: true, output: 'task_id is required' }
      }
      const block = input.block !== false
      const timeoutMs = Math.max(
        0,
        Math.min(MAX_TIMEOUT_MS, input.timeout_ms ?? DEFAULT_TIMEOUT_MS),
      )
      const maxLines = Math.max(
        1,
        Math.min(MAX_LINES, input.lines ?? DEFAULT_LINES),
      )

      let task = manager.get(id)
      if (!task) {
        return {
          isError: true,
          output: `No background task with id '${id}'.`,
        }
      }

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
