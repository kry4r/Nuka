// src/slash/memdir.ts
//
// Phase 7 §5.3 — `/memdir <list|clear|compact>` slash command.
//
// `list`    — print the current MEMORY.md entries.
// `clear`   — wipe MEMORY.md.
// `compact` — synthesize one new entry from the active session and append.
//
// `compact` is only available when the slash context provides a synth
// callable. cli.tsx wires that callable; tests can pass a stub. Without
// a callable, we degrade gracefully to a usage line.

import type { SlashCommand, SlashContext } from './types'
import { loadMemory, clearMemory } from '../core/memdir/index'
import type { MemoryEntry } from '../core/memdir/parser'

/**
 * `/memdir compact` needs a way to actually synthesize + append. Wired by
 * cli.tsx into a process-scoped helper so this slash command stays free
 * of provider/cwd plumbing.
 */
export type MemdirSynthCallable = () => Promise<MemoryEntry | null>

/** Set by cli.tsx at startup; tests inject directly. */
let synthCallable: MemdirSynthCallable | undefined

export function setMemdirSynthCallable(cb: MemdirSynthCallable | undefined): void {
  synthCallable = cb
}

function fmtList(entries: MemoryEntry[]): string {
  if (entries.length === 0) return '(memory empty)'
  return entries.map((e, i) => {
    const kw = e.keywords.length > 0 ? `  [${e.keywords.join(', ')}]` : ''
    return `${i + 1}. ${e.ts}${kw}\n   ${e.body}`
  }).join('\n\n')
}

export const MemdirCommand: SlashCommand = {
  name: 'memdir',
  description: 'Manage long-term project memory (list / clear / compact)',
  usage: '/memdir <list|clear|compact>',
  run: async (args: string, _ctx: SlashContext) => {
    const sub = args.trim().toLowerCase() || 'list'
    const cwd = process.cwd()
    if (sub === 'list') {
      const entries = await loadMemory(cwd)
      return { type: 'text', text: fmtList(entries) }
    }
    if (sub === 'clear') {
      await clearMemory(cwd)
      return { type: 'text', text: 'memory cleared' }
    }
    if (sub === 'compact') {
      if (!synthCallable) {
        return { type: 'text', text: '/memdir compact unavailable (no synth callable wired)' }
      }
      const entry = await synthCallable()
      if (!entry) return { type: 'text', text: 'no durable facts extracted' }
      return { type: 'text', text: `appended memory entry: ${entry.body}` }
    }
    return { type: 'text', text: `usage: ${MemdirCommand.usage}` }
  },
}
