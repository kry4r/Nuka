import type { SlashCommand } from './types'

export const ResumeCommand: SlashCommand = {
  name: 'resume',
  description: 'Resume a past session',
  source: 'builtin',
  usage: '/resume',
  examples: ['/resume'],
  run: async () => ({ type: 'dialog', dialog: { kind: 'session-picker' } }),
}
