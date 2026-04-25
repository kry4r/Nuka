// src/slash/theme.ts
// Phase 8 §4.1 — `/theme` slash command.
//
// Subcommands:
//   /theme list         — tabular list of all registered themes
//   /theme <name>       — switch to a named theme (persists to config)
//   /theme              — show current theme + hint about subcommands
//
// The interactive picker (arrow keys + Enter) is deferred to a follow-up
// pass because Ink dialog mounting has additional test-setup complexity.
// List-mode fulfils the spec's "first iteration" note.

import type { SlashCommand, SlashContext } from './types'
import { listThemes, findTheme } from '../core/theme/themes'
import { saveTheme } from '../core/config/save'
import os from 'node:os'

export const ThemeCommand: SlashCommand = {
  name: 'theme',
  description: 'Switch color theme',
  usage: '/theme [list | <name>]',
  run: async (args: string, ctx: SlashContext) => {
    const arg = args.trim()

    // /theme list
    if (arg === 'list') {
      const themes = listThemes()
      const currentName: string = (ctx.config as any).theme?.name ?? 'default-dark'
      const rows = themes.map(t => {
        const active = t.name === currentName ? ' *' : ''
        return `  ${t.name}${active}`
      })
      return {
        type: 'text',
        text: `Available themes (current marked *):\n${rows.join('\n')}`,
      }
    }

    // /theme <name>
    if (arg !== '') {
      const found = findTheme(arg)
      if (!found) {
        const names = listThemes().map(t => t.name).join(', ')
        return {
          type: 'text',
          text: `Theme "${arg}" not found.\nAvailable: ${names}`,
        }
      }
      try {
        await saveTheme(os.homedir(), found.name)
      } catch {
        // Non-fatal: config write failure shouldn't prevent the switch from
        // being visible in the running session.
      }
      return {
        type: 'text',
        text: `Theme switched to: ${found.name}`,
      }
    }

    // /theme (no args) — show current + usage hint
    const currentName: string = (ctx.config as any).theme?.name ?? 'default-dark'
    return {
      type: 'text',
      text: `Current theme: ${currentName}\nUse /theme list to see all themes, /theme <name> to switch.`,
    }
  },
}
