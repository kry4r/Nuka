// src/slash/vim.ts
//
// `/vim on|off|toggle [status]` — flips the persistent flag at config.vim.enabled.

import os from 'node:os'
import type { SlashCommand, SlashContext } from './types'
import { saveVimEnabled } from '../core/config/save'

export const VimCommand: SlashCommand = {
  name: 'vim',
  description: 'Toggle vim-mode editing in the prompt input',
  usage: '/vim [on|off|toggle|status]',
  run: async (args: string, ctx: SlashContext) => {
    const cur = !!ctx.config.vim?.enabled
    const a = args.trim().toLowerCase()
    let next: boolean
    switch (a) {
      case '':
      case 'toggle':
        next = !cur
        break
      case 'on':
      case 'enable':
      case 'true':
        next = true
        break
      case 'off':
      case 'disable':
      case 'false':
        next = false
        break
      case 'status':
        return { type: 'text', text: `vim mode: ${cur ? 'on' : 'off'}` }
      default:
        return { type: 'text', text: `usage: /vim [on|off|toggle|status]` }
    }
    try {
      await saveVimEnabled(os.homedir(), next)
    } catch (err) {
      return {
        type: 'text',
        text: `vim toggle failed: ${(err as Error).message}`,
      }
    }
    // Mutate the live config in place so the running TUI picks up the change
    // on next render without a restart.
    ctx.config.vim = { ...(ctx.config.vim ?? {}), enabled: next }
    return { type: 'text', text: `vim mode: ${next ? 'on' : 'off'} (restart not required)` }
  },
}
