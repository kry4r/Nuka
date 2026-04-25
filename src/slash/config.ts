// src/slash/config.ts
import type { SlashCommand } from './types'

export const ConfigCommand: SlashCommand = {
  name: 'config',
  description: 'Open config in $EDITOR (or run onboarding wizard if no provider configured)',
  run: async (_args, ctx) => {
    // Offline boot: zero providers → hint at the wizard rather than dropping
    // the user into a $EDITOR session on an empty file.
    if (ctx.config.providers.length === 0) {
      return {
        type: 'text',
        text:
          'No providers configured yet. Run `nuka init` from a fresh shell to launch the onboarding wizard, ' +
          'or open the config file directly with /model.',
      }
    }
    return { type: 'dialog', dialog: { kind: 'config-editor' } }
  },
}
