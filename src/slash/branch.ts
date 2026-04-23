import type { SlashCommand } from './types'

export const BranchCommand: SlashCommand = {
  name: 'branch',
  description: 'Fork the current session',
  run: async () => ({ type: 'effect', effect: { kind: 'branch-session' } }),
}
