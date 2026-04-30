import type { SlashCommand } from './types'

export const ForkCommand: SlashCommand = {
  name: 'fork',
  description: 'Fork the current session',
  usage: '/fork',
  run: async () => ({ type: 'effect', effect: { kind: 'fork-session' } }),
}
