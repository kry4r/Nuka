import type { SlashCommand, SlashResult } from './types'

export const McpCommand: SlashCommand = {
  name: 'mcp',
  description: 'List configured MCP servers and their connection status',
  async run(_args, ctx): Promise<SlashResult> {
    const mgr = ctx.mcpManager
    if (!mgr) {
      return { type: 'text', text: 'No MCP manager wired (no servers configured).' }
    }
    const statuses = mgr.status()
    if (statuses.length === 0) {
      return { type: 'text', text: 'No MCP servers configured. Add one to ~/.nuka/config.yaml under mcp.servers.' }
    }
    const lines = [`${statuses.length} MCP server${statuses.length === 1 ? '' : 's'}:`]
    for (const s of statuses) {
      const status = s.status.kind
      const icon = status === 'connected' ? '●' : status === 'connecting' ? '◐' : '○'
      const detail = (s.status as any).reason ? ` — ${(s.status as any).reason}` : ''
      lines.push(`  ${icon} ${s.name}  [${status}]${detail}`)
    }
    return { type: 'text', text: lines.join('\n') }
  },
}
