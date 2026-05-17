// src/core/tasks/stopTool.ts
//
// TaskStop — kill a running background task by ID. Sends SIGTERM (for bash
// tasks) or aborts the runner signal (agent / teammate / shell / dream),
// then awaits the runner's `done` promise so the resulting state
// transition is observable before this tool returns.
//
// Mirrors the upstream Nuka-Code TaskStopTool shape:
//   - `task_id` (primary) / `shell_id` (deprecated KillShell alias)
//   - Refuses to operate on a task that is already terminal (completed /
//     failed / killed) — surfacing the existing state instead of pretending
//     to act.

import type { Tool } from '../tools/types'
import { defineTool } from '../tools/define'
import type { Task, TaskState } from './types'

/**
 * Minimal manager surface needed by TaskStop. The full {@link TaskManager}
 * satisfies this, but tests can pass a stub.
 */
export type TaskStopManagerLike = {
  get(id: string): Task | undefined
  cancel(id: string): Promise<void>
}

export type TaskStopToolInput = {
  task_id?: string
  /**
   * Deprecated alias retained for compatibility with KillShell-shaped
   * callsites. If both are set, `task_id` wins.
   */
  shell_id?: string
}

const TERMINAL_STATES: ReadonlySet<TaskState> = new Set([
  'completed',
  'failed',
  'killed',
])

function isTerminal(state: TaskState): boolean {
  return TERMINAL_STATES.has(state)
}

export function makeTaskStopTool(
  manager: TaskStopManagerLike,
): Tool<TaskStopToolInput> {
  return defineTool<TaskStopToolInput>({
    name: 'TaskStop',
    description:
      'Kill a running background task by ID. Sends a termination signal and waits for the runner to settle. No-op on tasks that are already completed / failed / killed (returns the existing state). Use TaskList or the /tasks slash to discover IDs.',
    aliases: ['KillShell'],
    parameters: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'Background task ID to stop.',
          minLength: 1,
        },
        shell_id: {
          type: 'string',
          description:
            'Deprecated alias for task_id, retained for KillShell compatibility.',
          minLength: 1,
        },
      },
    },
    source: 'builtin',
    tags: ['core', 'tasks'],
    needsPermission: () => 'none',
    annotations: { readOnly: false },
    searchHint: ['task', 'stop', 'kill', 'background', 'cancel'],
    async run(input) {
      const id = (input.task_id ?? input.shell_id ?? '').trim()
      if (!id) {
        return {
          isError: true,
          output: 'task_id (or deprecated shell_id) is required.',
        }
      }

      const before = manager.get(id)
      if (!before) {
        return {
          isError: true,
          output: `No background task with id '${id}'.`,
        }
      }

      if (isTerminal(before.state)) {
        const exit =
          before.exitCode !== undefined ? ` (exit ${before.exitCode})` : ''
        return {
          isError: false,
          output: `Task ${id} already ${before.state}${exit} — nothing to stop.`,
        }
      }

      try {
        await manager.cancel(id)
      } catch (err) {
        return {
          isError: true,
          output: `Failed to stop task ${id}: ${(err as Error).message ?? err}`,
        }
      }

      const after = manager.get(id)
      const finalState: TaskState = after?.state ?? 'killed'
      const kind = (after ?? before).kind
      const description = (after ?? before).description
      return {
        isError: false,
        output: `Stopped task ${id} [${kind}] '${description}' (state=${finalState}).`,
      }
    },
  })
}
