import type { SlashCommand } from './types'

function formatDate(ts: number): string {
  const d = new Date(ts)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`
}

export const HistoryCommand: SlashCommand = {
  name: 'history',
  description: 'List past sessions',
  run: async (_args, ctx) => {
    const metas = await ctx.sessions.listPersisted()
    if (metas.length === 0) return { type: 'text', text: 'No past sessions.' }
    const lines = metas.slice(0, 20).map(m =>
      `${m.id.slice(0, 8)}  ${formatDate(m.updatedAt)}  ${m.model}  msgs=${m.messageCount}`,
    )
    return { type: 'text', text: lines.join('\n') }
  },
}
