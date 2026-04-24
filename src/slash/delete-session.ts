import type { SlashCommand } from './types'

export const DeleteSessionCommand: SlashCommand = {
  name: 'delete-session',
  description: 'Delete a past session by id prefix',
  usage: '/delete-session <id>',
  run: async (args, ctx) => {
    const prefix = args.trim()
    if (!prefix) return { type: 'text', text: 'usage: /delete-session <id>' }
    const metas = await ctx.sessions.listPersisted()
    const matches = metas.filter(m => m.id.startsWith(prefix))
    if (matches.length === 0) return { type: 'text', text: 'No matching session.' }
    if (matches.length > 1) return { type: 'text', text: `Ambiguous — matches ${matches.length} sessions.` }
    const meta = matches[0]!
    await ctx.sessions.delete(meta.id)
    return { type: 'text', text: `deleted session ${meta.id.slice(0, 8)}` }
  },
}
