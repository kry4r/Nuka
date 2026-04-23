// src/slash/config.ts
import type { SlashCommand } from './types'

export const ConfigCommand: SlashCommand = {
  name: 'config',
  description: 'Open config in $EDITOR',
  run: async () => ({ type: 'dialog', dialog: { kind: 'config-editor' } }),
}
