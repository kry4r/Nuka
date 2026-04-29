// src/slash/statusHub.ts
//
// Phase 13 M3 — /status-hub slash command.
// Toggles or sets the statusBar.iconMode config field.
//
// Usage:
//   /status-hub          — toggle between 'icon' and 'text'
//   /status-hub icon     — set to icon mode
//   /status-hub text     — set to text mode

import os from 'node:os'
import type { SlashCommand, SlashResult } from './types'
import { saveConfigPatch } from '../core/config/save'

export const StatusHubCommand: SlashCommand = {
  name: 'status-hub',
  description: 'Toggle or set status bar icon/text mode',
  source: 'builtin',
  usage: '/status-hub [icon|text]',
  args: [
    {
      name: 'mode',
      choices: ['icon', 'text'],
      description: 'icon (default, uses glyphs) or text (plain labels). Omit to toggle.',
    },
  ],
  examples: [
    '/status-hub',
    '/status-hub icon',
    '/status-hub text',
  ],
  async run(args, ctx): Promise<SlashResult> {
    const home = os.homedir()
    const trimmed = args.trim().toLowerCase()
    const current = (ctx.config.statusBar as any)?.iconMode ?? 'icon'

    let next: 'icon' | 'text'
    if (trimmed === 'icon') {
      next = 'icon'
    } else if (trimmed === 'text') {
      next = 'text'
    } else if (!trimmed) {
      // Toggle
      next = current === 'icon' ? 'text' : 'icon'
    } else {
      return {
        type: 'text',
        text: `Unknown mode: ${trimmed}\nUsage: /status-hub [icon|text]`,
      }
    }

    await saveConfigPatch(home, (obj) => {
      obj.statusBar = { ...(obj.statusBar ?? {}), iconMode: next }
      // Mirror into in-memory config for live update without restart.
      if (ctx.config.statusBar) {
        (ctx.config.statusBar as any).iconMode = next
      } else {
        (ctx.config as any).statusBar = { iconMode: next }
      }
    })

    return {
      type: 'text',
      text: `Status hub: ${next}`,
    }
  },
}
