// src/slash/stats.ts
// Phase 8 §4.2 — `/stats` slash command.
//
// Opens the interactive two-tab StatsView (Overview / Models).

import type { SlashCommand, SlashContext } from './types'

export const StatsCommand: SlashCommand = {
  name: 'stats',
  description: 'Show usage stats (tokens, cost, models)',
  usage: '/stats',
  run: async (_args: string, _ctx: SlashContext) => {
    return { type: 'dialog', dialog: { kind: 'stats' } }
  },
}
