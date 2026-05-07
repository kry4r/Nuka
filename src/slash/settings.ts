// src/slash/settings.ts
import type { SlashCommand } from './types'

// Open the settings dialog unconditionally — even with zero providers
// configured. The dialog itself surfaces an "add provider" affordance,
// so we no longer block first-run users behind `nuka init`.
const settingsRun: SlashCommand['run'] = async () => {
  return { type: 'dialog', dialog: { kind: 'settings' } }
}

export const SettingsCommand: SlashCommand = {
  name: 'settings',
  description: 'Open settings submenu',
  source: 'builtin',
  usage: '/settings',
  examples: ['/settings'],
  run: settingsRun,
}

// Alias: many users call this `/config` (Claude Code parity). Same dialog.
export const ConfigCommand: SlashCommand = {
  name: 'config',
  description: 'Alias for /settings',
  source: 'builtin',
  usage: '/config',
  examples: ['/config'],
  run: settingsRun,
}
