import type { SlashCommand } from './types'

export const NewCommand: SlashCommand = {
  name: 'new',
  description: 'Start a new session',
  run: async () => ({ type: 'effect', effect: { kind: 'new-session' } }),
}
