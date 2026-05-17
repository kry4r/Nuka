// src/core/tasks/tools.ts
//
// Four tools wrapping {@link TaskStore} — the agent's TODO list surface:
//
//   TaskCreate — add a new task (subject + description, pending status).
//   TaskList   — enumerate the open task set, terse one-line summaries.
//   TaskGet    — full details for a single task by ID, including blocks.
//   TaskUpdate — mutate a task (status / subject / blocks / deletion).
//
// Closely follows the upstream Nuka-Code shape so the model's behavior is
// portable, but trimmed: hooks/teammates/swarm coordination/mailbox have
// been dropped (those subsystems aren't in Nuka). Status transitions and
// deletion (status === 'deleted') match upstream semantics.

import type { Tool } from '../tools/types'
import { defineTool } from '../tools/define'
import {
  TASK_STATUSES,
  type TaskStatus,
  type TaskStore,
} from './store'

const TASK_STATUS_ENUM = [...TASK_STATUSES] as const
const UPDATE_STATUS_ENUM = [...TASK_STATUSES, 'deleted'] as const

// --- shared helpers ---------------------------------------------------------

/**
 * Render a single task to a tool_result-friendly one-line summary. Used by
 * TaskList. Mirrors the upstream `#id [status] subject (owner) [blocked
 * by #x, #y]` shape so the model's existing intuitions about the format
 * carry over.
 */
function summarizeTask(t: {
  id: string
  subject: string
  status: TaskStatus
  owner?: string
  blockedBy: string[]
}): string {
  const owner = t.owner ? ` (${t.owner})` : ''
  const blocked =
    t.blockedBy.length > 0
      ? ` [blocked by ${t.blockedBy.map((id) => `#${id}`).join(', ')}]`
      : ''
  return `#${t.id} [${t.status}] ${t.subject}${owner}${blocked}`
}

// --- TaskCreate -------------------------------------------------------------

export type TaskCreateToolInput = {
  subject: string
  description: string
  activeForm?: string
  owner?: string
  metadata?: Record<string, unknown>
}

export function makeTaskCreateTool(
  store: TaskStore,
): Tool<TaskCreateToolInput> {
  return defineTool<TaskCreateToolInput>({
    name: 'TaskCreate',
    description:
      'Create a new task in the session TODO list. Tasks start in pending status. Use TaskUpdate to mark them in_progress / completed or to wire up dependencies.',
    parameters: {
      type: 'object',
      required: ['subject', 'description'],
      properties: {
        subject: {
          type: 'string',
          description: 'Short title for the task (imperative form).',
          minLength: 1,
        },
        description: {
          type: 'string',
          description: 'What needs to be done — full requirements / context.',
          minLength: 1,
        },
        activeForm: {
          type: 'string',
          description:
            'Present-continuous form shown in the spinner while in_progress (e.g. "Running tests").',
        },
        owner: {
          type: 'string',
          description: 'Optional agent owning this task.',
        },
        metadata: {
          type: 'object',
          description:
            'Optional arbitrary metadata to attach. Keys with value null are deleted on update.',
        },
      },
    },
    source: 'builtin',
    tags: ['core', 'tasks'],
    needsPermission: () => 'none',
    annotations: { readOnly: false },
    searchHint: ['task', 'todo', 'create', 'plan'],
    async run(input) {
      const subject = input.subject.trim()
      const description = input.description.trim()
      if (subject.length === 0) {
        return { isError: true, output: 'subject must not be empty' }
      }
      if (description.length === 0) {
        return { isError: true, output: 'description must not be empty' }
      }
      let task
      try {
        task = store.add({
          subject,
          description,
          activeForm: input.activeForm,
          owner: input.owner,
          metadata: input.metadata,
        })
      } catch (e) {
        return {
          isError: true,
          output: e instanceof Error ? e.message : String(e),
        }
      }
      return {
        isError: false,
        output: `Task #${task.id} created: ${task.subject}`,
      }
    },
  })
}

// --- TaskList ---------------------------------------------------------------

export type TaskListToolInput = Record<string, never>

export function makeTaskListTool(store: TaskStore): Tool<TaskListToolInput> {
  return defineTool<TaskListToolInput>({
    name: 'TaskList',
    description:
      'List all tasks in the session TODO list. Each line: "#id [status] subject (owner) [blocked by #x, #y]". Resolved blockers are filtered out — only open blockers are shown.',
    parameters: {
      type: 'object',
      properties: {},
    },
    source: 'builtin',
    tags: ['core', 'tasks'],
    needsPermission: () => 'none',
    annotations: { readOnly: true, parallelSafe: true },
    searchHint: ['task', 'todo', 'list'],
    async run() {
      const all = store.list()
      if (all.length === 0) {
        return { isError: false, output: 'No tasks.' }
      }
      const resolved = new Set(
        all.filter((t) => t.status === 'completed').map((t) => t.id),
      )
      const lines = all.map((t) =>
        summarizeTask({
          id: t.id,
          subject: t.subject,
          status: t.status,
          owner: t.owner,
          blockedBy: t.blockedBy.filter((id) => !resolved.has(id)),
        }),
      )
      return { isError: false, output: lines.join('\n') }
    },
  })
}

// --- TaskGet ----------------------------------------------------------------

export type TaskGetToolInput = { taskId: string }

export function makeTaskGetTool(store: TaskStore): Tool<TaskGetToolInput> {
  return defineTool<TaskGetToolInput>({
    name: 'TaskGet',
    description:
      'Read a single task by ID. Returns subject, description, status, owner, and the cross-task blocks / blockedBy lists.',
    parameters: {
      type: 'object',
      required: ['taskId'],
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID as reported by TaskCreate / TaskList.',
          minLength: 1,
        },
      },
    },
    source: 'builtin',
    tags: ['core', 'tasks'],
    needsPermission: () => 'none',
    annotations: { readOnly: true, parallelSafe: true },
    searchHint: ['task', 'todo', 'get'],
    async run(input) {
      const t = store.get(input.taskId)
      if (!t) {
        return { isError: false, output: `Task #${input.taskId} not found.` }
      }
      const lines = [
        `Task #${t.id}: ${t.subject}`,
        `Status: ${t.status}`,
        `Description: ${t.description}`,
      ]
      if (t.owner) lines.push(`Owner: ${t.owner}`)
      if (t.activeForm) lines.push(`Active form: ${t.activeForm}`)
      if (t.blockedBy.length > 0) {
        lines.push(`Blocked by: ${t.blockedBy.map((id) => `#${id}`).join(', ')}`)
      }
      if (t.blocks.length > 0) {
        lines.push(`Blocks: ${t.blocks.map((id) => `#${id}`).join(', ')}`)
      }
      return { isError: false, output: lines.join('\n') }
    },
  })
}

// --- TaskUpdate -------------------------------------------------------------

export type TaskUpdateToolInput = {
  taskId: string
  subject?: string
  description?: string
  activeForm?: string
  status?: TaskStatus | 'deleted'
  owner?: string | null
  addBlocks?: string[]
  addBlockedBy?: string[]
  metadata?: Record<string, unknown>
}

export function makeTaskUpdateTool(
  store: TaskStore,
): Tool<TaskUpdateToolInput> {
  return defineTool<TaskUpdateToolInput>({
    name: 'TaskUpdate',
    description:
      'Update an existing task. Set status to in_progress when starting, completed when done, or "deleted" to remove the task permanently. addBlocks / addBlockedBy append to dependency lists (deduped). owner=null clears the owner.',
    parameters: {
      type: 'object',
      required: ['taskId'],
      properties: {
        taskId: { type: 'string', minLength: 1, description: 'Task ID.' },
        subject: { type: 'string' },
        description: { type: 'string' },
        activeForm: { type: 'string' },
        status: {
          type: 'string',
          enum: [...UPDATE_STATUS_ENUM],
          description: 'pending | in_progress | completed | deleted.',
        },
        owner: {
          // null clears, string sets; we accept both at runtime and validate in the body.
          description:
            'Set owner to a name, or null to clear. Omit to leave unchanged.',
        },
        addBlocks: {
          type: 'array',
          items: { type: 'string' },
          description: 'Task IDs this task should block (appended, deduped).',
        },
        addBlockedBy: {
          type: 'array',
          items: { type: 'string' },
          description: 'Task IDs that block this task (appended, deduped).',
        },
        metadata: {
          type: 'object',
          description:
            'Metadata patch. Keys with null delete; other values overwrite.',
        },
      },
    },
    source: 'builtin',
    tags: ['core', 'tasks'],
    needsPermission: () => 'none',
    annotations: { readOnly: false },
    searchHint: ['task', 'todo', 'update', 'complete', 'delete'],
    async run(input) {
      const existing = store.get(input.taskId)
      if (!existing) {
        return {
          isError: true,
          output: `Task #${input.taskId} not found.`,
        }
      }

      // Validate status enum at runtime — JSON schema enforcement varies
      // across provider validators, so we do a defensive check.
      if (
        input.status !== undefined &&
        !UPDATE_STATUS_ENUM.includes(input.status as never)
      ) {
        return {
          isError: true,
          output: `Invalid status '${input.status}'. Expected one of: ${UPDATE_STATUS_ENUM.join(', ')}.`,
        }
      }

      if (input.status === 'deleted') {
        store.remove(input.taskId)
        return {
          isError: false,
          output: `Task #${input.taskId} deleted.`,
        }
      }

      // Validate owner shape. Accept undefined (leave alone), null (clear),
      // or string (set). Reject other types to keep the surface clean.
      if (
        input.owner !== undefined &&
        input.owner !== null &&
        typeof input.owner !== 'string'
      ) {
        return {
          isError: true,
          output: 'owner must be a string, null, or omitted.',
        }
      }

      const updated = store.update(input.taskId, {
        subject: input.subject,
        description: input.description,
        activeForm: input.activeForm,
        status: input.status as TaskStatus | undefined,
        owner: input.owner,
        addBlocks: input.addBlocks,
        addBlockedBy: input.addBlockedBy,
        metadata: input.metadata,
      })

      if (!updated) {
        // Should be unreachable because we checked existence above, but
        // surface a clear error if the store dropped the task mid-flight.
        return {
          isError: true,
          output: `Task #${input.taskId} disappeared during update.`,
        }
      }

      const changed: string[] = []
      if (input.subject !== undefined && input.subject !== existing.subject)
        changed.push('subject')
      if (
        input.description !== undefined &&
        input.description !== existing.description
      )
        changed.push('description')
      if (
        input.activeForm !== undefined &&
        input.activeForm !== existing.activeForm
      )
        changed.push('activeForm')
      if (input.status !== undefined && input.status !== existing.status)
        changed.push(`status=${input.status}`)
      if (input.owner !== undefined) changed.push('owner')
      if (input.addBlocks && input.addBlocks.length > 0) changed.push('blocks')
      if (input.addBlockedBy && input.addBlockedBy.length > 0)
        changed.push('blockedBy')
      if (input.metadata !== undefined) changed.push('metadata')

      const summary =
        changed.length === 0
          ? 'no changes'
          : changed.join(', ')
      return {
        isError: false,
        output: `Task #${updated.id} updated (${summary}).`,
      }
    },
  })
}

// --- bulk factory -----------------------------------------------------------

/**
 * Build all four task tools sharing one store. Convenience for the wiring
 * site — matches the {@link makeCronTools} pattern from iter A.
 */
export function makeTaskTools(store: TaskStore): {
  create: Tool<TaskCreateToolInput>
  list: Tool<TaskListToolInput>
  get: Tool<TaskGetToolInput>
  update: Tool<TaskUpdateToolInput>
} {
  return {
    create: makeTaskCreateTool(store),
    list: makeTaskListTool(store),
    get: makeTaskGetTool(store),
    update: makeTaskUpdateTool(store),
  }
}
