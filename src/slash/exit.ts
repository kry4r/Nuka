import type { SlashCommand } from './types'

export const ExitCommand: SlashCommand = {
  name: 'exit',
  description: 'Quit Nuka',
  run: async () => ({ type: 'exit' }),
}
