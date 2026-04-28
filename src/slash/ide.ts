/**
 * src/slash/ide.ts — Phase 8 §4.5
 *
 * /ide  — probe for running IDEs and list them.
 *
 * Phase 11 M3: MCP-based IDE connect/disconnect was removed; the slash
 * command now only reports detection results. The IDE bridge will be
 * rebuilt on top of the new tool-platform interface in a later workstream.
 */

import type { SlashCommand, SlashContext, SlashResult } from './types'
import { detectIdes } from '../core/ide/detect'

export const IdeCommand: SlashCommand = {
  name: 'ide',
  description: 'Detect running IDEs',
  usage: '/ide',

  run: async (_args: string, _ctx: SlashContext): Promise<SlashResult> => {
    const ides = await detectIdes()
    if (ides.length === 0) {
      return { type: 'text', text: '(no IDEs detected — see docs/ide.md)' }
    }
    const lines = ides.map(
      (ide, i) =>
        `  ${i + 1}. ${ide.family}${ide.port !== undefined ? ` (port ${ide.port})` : ''}`,
    )
    return {
      type: 'text',
      text: `Detected IDEs:\n${lines.join('\n')}`,
    }
  },
}
