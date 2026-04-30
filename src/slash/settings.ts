// src/slash/settings.ts
import type { SlashCommand } from './types'

export const SettingsCommand: SlashCommand = {
  name: 'settings',
  description: 'Open settings submenu (categories: Provider, Model, Theme, StatusBar, …)',
  source: 'builtin',
  usage: '/settings',
  examples: ['/settings'],
  run: async (_args, ctx) => {
    if (ctx.config.providers.length === 0) {
      return {
        type: 'text',
        text:
          'No providers configured yet. Run `nuka init` from a fresh shell to launch the onboarding wizard, ' +
          'or open the config file directly with /model.',
      }
    }
    return { type: 'dialog', dialog: { kind: 'settings' } }
  },
}
