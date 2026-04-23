// src/slash/compact.ts
import type { SlashCommand } from './types'

export const CompactCommand: SlashCommand = {
  name: 'compact',
  description: 'Summarize older messages via the active model',
  run: async () => ({ type: 'effect', effect: { kind: 'compact' } }),
}
