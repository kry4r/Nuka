import type { SlashCommand, SlashContext } from './types'

export const BtwCommand: SlashCommand = {
  name: 'btw',
  description: 'Queue a message without interrupting',
  usage: '/btw <text>',
  run: async (args: string, ctx: SlashContext) => {
    const active = ctx.sessions.active()
    if (!active) return { type: 'text', text: 'No active session.' }
    if (!args.trim()) return { type: 'text', text: 'Usage: /btw <text>' }
    active.queue.push(args)
    return { type: 'text', text: `queued (${active.queue.size()} pending)` }
  },
}
