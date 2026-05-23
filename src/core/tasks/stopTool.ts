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
import {
  cleanLookupId,
  findTaskByAgentId,
  type TaskLookupManagerLike,
} from './lookup'

/**
 * Minimal manager surface needed by TaskStop. The full {@link TaskManager}
 * satisfies this, but tests can pass a stub.
 */
export type TaskStopManagerLike = {
  get(id: string): Task | undefined
  list(): Task[]
  cancel(id: string): Promise<void>
}

export type TaskStopToolInput = {
  task_id?: string
  /**
   * Deprecated alias retained for compatibility with KillShell-shaped
   * callsites. If both are set, `task_id` wins.
   */
  shell_id?: string
  /** Stable local subagent ID. Used only when task_id and shell_id are omitted. */
  agent_id?: string
}

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
  input: TaskStopToolInput,
): { task?: Task; error?: string } {
  const directId = cleanLookupId(input.task_id) ?? cleanLookupId(input.shell_id)
  if (directId) {
    const task = manager.get(directId)
    if (!task) return { error: `No background task with id '${directId}'.` }
    return { task }
  }

  const agentId = cleanLookupId(input.agent_id)
  if (!agentId) {
    return {
      error: 'task_id (or deprecated shell_id) or agent_id is required.',
    }
  }

  const task = findTaskByAgentId(manager, agentId)
  if (!task) {
    return { error: `No background task with agent id '${agentId}'.` }
  }
  return { task }
}

export function makeTaskStopTool(
  manager: TaskStopManagerLike,
): Tool<TaskStopToolInput> {
  return defineTool<TaskStopToolInput>({
    name: 'TaskStop',
    description:
      'Kill a running background task by task_id, deprecated shell_id, or stable local subagent agent_id. Sends a termination signal and waits for the runner to settle. No-op on tasks that are already completed / failed / killed (returns the existing state). Use TaskList or the /tasks slash to discover IDs.',
    aliases: ['KillShell'],
    parameters: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'Background task ID to stop. Takes precedence.',
          minLength: 1,
        },
        shell_id: {
          type: 'string',
          description:
            'Deprecated alias for task_id, retained for KillShell compatibility.',
          minLength: 1,
        },
        agent_id: {
          type: 'string',
          description:
            'Stable local subagent ID. Used when task_id and shell_id are omitted; the newest matching execution record is selected.',
          minLength: 1,
        },
      },
    },
    source: 'builtin',
    tags: ['core', 'tasks'],
    needsPermission: () => 'none',
    annotations: { readOnly: false },
    searchHint: ['task', 'agent', 'stop', 'kill', 'background', 'cancel'],
    async run(input) {
      const resolved = resolveTask(manager, input)
      if (resolved.error || !resolved.task) {
        return {
          isError: true,
          output: resolved.error ?? 'task_id (or deprecated shell_id) or agent_id is required.',
        }
      }

      const before = resolved.task
      const id = before.id
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
