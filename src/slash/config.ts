// src/slash/config.ts
import type { SlashCommand } from './types'

/**
 * Phase 12 §4.7 — `/config` opens the new ConfigSubmenu (left-nav +
 * right-form). Replaces the old ConfigEditor punt-to-$EDITOR flow.
 */
export const ConfigCommand: SlashCommand = {
  name: 'config',
  description: 'Open config submenu (categories: Provider, Model, Theme, StatusBar, …)',
  source: 'builtin',
  usage: '/config',
  examples: ['/config'],
  run: async (_args, ctx) => {
    // Offline boot: zero providers → hint at the wizard rather than
    // dropping the user into an empty submenu.
    if (ctx.config.providers.length === 0) {
      return {
        type: 'text',
        text:
          'No providers configured yet. Run `nuka init` from a fresh shell to launch the onboarding wizard, ' +
          'or open the config file directly with /model.',
      }
    }
    return { type: 'dialog', dialog: { kind: 'config' } }
  },
}
