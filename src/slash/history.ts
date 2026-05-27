// src/slash/history.ts
//
// B4 — /history slash command. Opens the full-screen session browser
// (SessionList.tsx via the App submenu reducer). When persistence is
// disabled (NUKA_SESSION_PERSIST unset) we return a plain text response
// telling the user how to enable it, rather than opening an empty list.
import type { SlashCommand } from './types'
import { isPersistEnabled, PERSIST_ENV } from '../core/session/history/persist'

export const HistoryCommand: SlashCommand = {
  name: 'history',
  description: 'Browse, search, resume or delete past sessions',
  source: 'builtin',
  usage: '/history [query]',
  args: [{ name: 'query', description: 'Optional text to search across persisted conversations' }],
  examples: ['/history', '/history auth bug'],
  run: async (args) => {
    if (!isPersistEnabled(process.env)) {
      return {
        type: 'text',
        text: `Session history is disabled. Set ${PERSIST_ENV}=1 and restart Nuka to enable cross-startup session resume.`,
      }
    }
    const query = args.trim()
    return {
      type: 'dialog',
      dialog: query ? { kind: 'history-list', query } : { kind: 'history-list' },
    }
  },
}
