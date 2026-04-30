// src/slash/monitor.ts
// Phase 14b — /monitor slash command.
// Opens the swarm monitor dashboard (DAG / Timeline / Tokens) as a full submenu.
import type { SlashCommand, SlashResult } from './types'

export const monitorCommand: SlashCommand = {
  name: 'monitor',
  description: 'Open the swarm monitor dashboard (DAG / Timeline / Tokens)',
  source: 'builtin',
  usage: '/monitor',
  examples: ['/monitor'],
  async run(_args, _ctx): Promise<SlashResult> {
    return { type: 'dialog', dialog: { kind: 'monitor' } }
  },
}
