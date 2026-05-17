// src/core/cron/tools.ts
//
// Three tools for scheduling, listing, and cancelling cron jobs:
//
//   CronCreate — schedule a prompt to fire on a 5-field cron expression.
//                Supports recurring or one-shot. Session-only (no disk).
//   CronList   — enumerate the active jobs.
//   CronDelete — cancel a job by ID.
//
// The actual fire-the-prompt scheduling tick is intentionally NOT wired here.
// This port lands the registry + the parser. Wiring the scheduler into the
// agent loop is a follow-up — until then these tools register intent and the
// model can manage that intent.

import type { Tool } from '../tools/types'
import { defineTool } from '../tools/define'
import {
  cronToHuman,
  nextCronRunMs,
  parseCronExpression,
} from './parser'
import { CronStore } from './store'

// --- CronCreate -------------------------------------------------------------

export type CronCreateInput = {
  cron: string
  prompt: string
  recurring?: boolean
  durable?: boolean
}

export function makeCronCreateTool(store: CronStore): Tool<CronCreateInput> {
  return defineTool<CronCreateInput>({
    name: 'CronCreate',
    description:
      'Schedule a prompt to fire on a 5-field cron expression (local time). Set recurring=false for one-shot reminders. Set durable=true to persist across restarts (requires durable mode).',
    parameters: {
      type: 'object',
      required: ['cron', 'prompt'],
      properties: {
        cron: {
          type: 'string',
          description:
            'Standard 5-field cron expression in local time: "M H DoM Mon DoW" (e.g. "*/5 * * * *" = every 5 minutes).',
        },
        prompt: {
          type: 'string',
          description: 'The prompt to enqueue at each fire time.',
          minLength: 1,
        },
        recurring: {
          type: 'boolean',
          description:
            'true (default) = fire on every cron match until deleted. false = fire once at next match, then auto-delete.',
        },
        durable: {
          type: 'boolean',
          description:
            'false (default) = session-only, dies when the CLI exits. true = persist to .nuka/scheduled_tasks.json and survive restarts. Use true only when the user asks the task to survive across sessions.',
        },
      },
    },
    source: 'builtin',
    tags: ['core', 'schedule'],
    needsPermission: () => 'none',
    annotations: { readOnly: false },
    searchHint: ['schedule', 'cron', 'remind', 'recurring', 'durable'],
    async run(input) {
      if (!parseCronExpression(input.cron)) {
        return {
          isError: true,
          output: `Invalid cron expression '${input.cron}'. Expected 5 fields: M H DoM Mon DoW.`,
        }
      }
      if (nextCronRunMs(input.cron, Date.now()) === null) {
        return {
          isError: true,
          output: `Cron expression '${input.cron}' does not match any calendar date in the next year.`,
        }
      }
      if (store.size() >= CronStore.MAX_JOBS) {
        return {
          isError: true,
          output: `Too many scheduled jobs (max ${CronStore.MAX_JOBS}). Cancel one first with CronDelete.`,
        }
      }
      const recurring = input.recurring ?? true
      const durable = input.durable ?? false
      if (durable && !store.isDurable()) {
        return {
          isError: true,
          output:
            'Durable scheduling is not enabled in this session. Restart with a durable-mode CronStore, or set durable=false for a session-only task.',
        }
      }
      const task = store.add({
        cron: input.cron,
        prompt: input.prompt,
        recurring,
        durable,
      })
      const human = cronToHuman(task.cron)
      const flavor = recurring ? 'recurring job' : 'one-shot task'
      const lifetime = durable
        ? 'persisted to disk — survives restarts'
        : 'session-only — dies when the CLI exits'
      return {
        isError: false,
        output: `Scheduled ${flavor} ${task.id} (${human}). ${lifetime}. Use CronDelete to cancel.`,
      }
    },
  })
}

// --- CronList ---------------------------------------------------------------

export type CronListInput = Record<string, never>

export function makeCronListTool(store: CronStore): Tool<CronListInput> {
  return defineTool<CronListInput>({
    name: 'CronList',
    description: 'List all active scheduled cron jobs in this session.',
    parameters: {
      type: 'object',
      properties: {},
    },
    source: 'builtin',
    tags: ['core', 'schedule'],
    needsPermission: () => 'none',
    annotations: { readOnly: true, parallelSafe: true },
    async run() {
      const tasks = store.list()
      if (tasks.length === 0) {
        return { isError: false, output: 'No scheduled jobs.' }
      }
      const lines = tasks.map((t) => {
        const human = cronToHuman(t.cron)
        const flavor = t.recurring ? 'recurring' : 'one-shot'
        const preview =
          t.prompt.length > 80 ? `${t.prompt.slice(0, 77)}...` : t.prompt
        return `${t.id} — ${human} (${flavor}): ${preview}`
      })
      return { isError: false, output: lines.join('\n') }
    },
  })
}

// --- CronDelete -------------------------------------------------------------

export type CronDeleteInput = { id: string }

export function makeCronDeleteTool(store: CronStore): Tool<CronDeleteInput> {
  return defineTool<CronDeleteInput>({
    name: 'CronDelete',
    description: 'Cancel a scheduled cron job by ID (as reported by CronCreate / CronList).',
    parameters: {
      type: 'object',
      required: ['id'],
      properties: {
        id: {
          type: 'string',
          description: 'Job ID returned by CronCreate.',
          minLength: 1,
        },
      },
    },
    source: 'builtin',
    tags: ['core', 'schedule'],
    needsPermission: () => 'none',
    async run(input) {
      if (!store.get(input.id)) {
        return {
          isError: true,
          output: `No scheduled job with id '${input.id}'`,
        }
      }
      store.remove(input.id)
      return { isError: false, output: `Cancelled job ${input.id}.` }
    },
  })
}

// --- bulk factory -----------------------------------------------------------

/**
 * Build all three cron tools sharing one store. Convenience for the wiring
 * site so the CronStore singleton stays threaded through correctly.
 */
export function makeCronTools(store: CronStore): {
  create: Tool<CronCreateInput>
  list: Tool<CronListInput>
  delete: Tool<CronDeleteInput>
} {
  return {
    create: makeCronCreateTool(store),
    list: makeCronListTool(store),
    delete: makeCronDeleteTool(store),
  }
}
