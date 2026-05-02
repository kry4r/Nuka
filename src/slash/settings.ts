// src/slash/settings.ts
import type { SlashCommand } from './types'

const settingsRun: SlashCommand['run'] = async (_args, ctx) => {
  if (ctx.config.providers.length === 0) {
    return {
      type: 'text',
      text:
        'No providers configured yet. Run `nuka init` from a fresh shell to launch the onboarding wizard, ' +
        'or open the config file directly with /model.',
    }
  }
  return { type: 'dialog', dialog: { kind: 'settings' } }
}

export const SettingsCommand: SlashCommand = {
  name: 'settings',
  description: 'Open settings submenu (categories: Provider, Model, Theme, StatusBar, …)',
  source: 'builtin',
  usage: '/settings',
  examples: ['/settings'],
  run: settingsRun,
}

// Alias: many users call this `/config` (Claude Code parity). Same dialog.
export const ConfigCommand: SlashCommand = {
  name: 'config',
  description: 'Alias for /settings — open the settings submenu',
  source: 'builtin',
  usage: '/config',
  examples: ['/config'],
  run: settingsRun,
}
