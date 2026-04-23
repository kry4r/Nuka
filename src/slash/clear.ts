import type { SlashCommand } from './types'

export const ClearCommand: SlashCommand = {
  name: 'clear',
  description: 'Clear rendered messages',
  run: async () => ({ type: 'effect', effect: { kind: 'clear-screen' } }),
}
