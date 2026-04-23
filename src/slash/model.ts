import type { SlashCommand } from './types'

export const ModelCommand: SlashCommand = {
  name: 'model',
  description: 'Pick provider + model (two-level picker)',
  run: async () => ({ type: 'dialog', dialog: { kind: 'model-picker' } }),
}
