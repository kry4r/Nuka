// src/slash/tasks.ts
//
// Phase 10 §4.3 — `/tasks` slash command.
//
// Subcommands:
//   /tasks                  → list all tasks (newest first).
//   /tasks show <id>        → tail the last 50 lines of <id>.log.
//   /tasks cancel <id>      → SIGTERM (bash) or abort (agent/monitor).

import type { SlashCommand, SlashContext, SlashResult } from './types'
import { tailOutput } from '../core/tasks/persist'
import type { Task } from '../core/tasks/types'

const TAIL_LINES = 50

function fmtState(s: Task['state']): string {
  switch (s) {
    case 'pending':            return 'pend'
    case 'running':            return 'run'
    case 'completed':          return 'done'
    case 'failed':             return 'fail'
    case 'killed':             return 'kill'
    case 'idle':               return 'idle'
    case 'shutdown_requested': return 'shut'
  }
}

function fmtRow(t: Task): string {
  const dur = t.startedAt
    ? `${(((t.finishedAt ?? Date.now()) - t.startedAt) / 1000).toFixed(1)}s`
    : '–'
  // Pad columns for stable alignment in the TUI.
  return `  ${t.id}  ${fmtState(t.state).padEnd(4)}  ${t.kind.padEnd(12)}  ${dur.padStart(6)}  ${t.description}`
}

async function runShow(id: string, ctx: SlashContext): Promise<SlashResult> {
  const m = ctx.taskManager
  if (!m) return { type: 'text', text: 'Task system is not enabled in this session.' }
  const t = m.get(id)
  if (!t) return { type: 'text', text: `No task with id '${id}'.` }
  const lines = await tailOutput(t.outputFile, TAIL_LINES)
  if (lines.length === 0) {
    return { type: 'text', text: `Task ${id} (${fmtState(t.state)}): no output yet.` }
  }
  const header = `Task ${id} (${fmtState(t.state)}, ${t.kind}) — last ${lines.length} line(s):`
  return { type: 'text', text: `${header}\n${lines.map(l => `  ${l}`).join('\n')}` }
}

async function runCancel(id: string, ctx: SlashContext): Promise<SlashResult> {
  const m = ctx.taskManager
  if (!m) return { type: 'text', text: 'Task system is not enabled in this session.' }
  const t = m.get(id)
  if (!t) return { type: 'text', text: `No task with id '${id}'.` }
  if (t.state !== 'running' && t.state !== 'pending') {
    return { type: 'text', text: `Task ${id} is already ${fmtState(t.state)}; nothing to cancel.` }
  }
  await m.cancel(id)
  return { type: 'text', text: `Cancelled task ${id}.` }
}

async function runList(ctx: SlashContext): Promise<SlashResult> {
  const m = ctx.taskManager
  if (!m) return { type: 'text', text: 'Task system is not enabled in this session.' }
  const all = m.list()
  if (all.length === 0) return { type: 'text', text: 'No background tasks.' }
  const header = '  id        state  kind          dur     description'
  const rows = all.map(fmtRow).join('\n')
  return { type: 'text', text: `${header}\n${rows}` }
}

export const TasksCommand: SlashCommand = {
  name: 'tasks',
  description: 'List, show, or cancel background tasks',
  source: 'builtin',
  usage: '/tasks [show <id> | cancel <id>]',
  args: [
    { name: 'subcommand', choices: ['show', 'cancel'], description: 'Action to perform' },
    { name: 'id', description: 'Task ID' },
  ],
  examples: ['/tasks', '/tasks show abc123', '/tasks cancel abc123'],
  run: async (args: string, ctx: SlashContext): Promise<SlashResult> => {
    const trimmed = args.trim()
    if (trimmed === '') return runList(ctx)

    const m = trimmed.match(/^(\S+)(?:\s+(\S+))?\s*$/)
    if (!m) return { type: 'text', text: 'Usage: /tasks [show <id> | cancel <id>]' }
    const sub = m[1]!
    const id = m[2] ?? ''

    if (sub === 'list') return runList(ctx)
    if (sub === 'show') {
      if (!id) return { type: 'text', text: 'Usage: /tasks show <id>' }
      return runShow(id, ctx)
    }
    if (sub === 'cancel') {
      if (!id) return { type: 'text', text: 'Usage: /tasks cancel <id>' }
      return runCancel(id, ctx)
    }
    return { type: 'text', text: `Unknown subcommand '${sub}'. Try /tasks, /tasks show <id>, or /tasks cancel <id>.` }
  },
}
