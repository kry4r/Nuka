import type { Tool } from '../tools/types'
import type { McpClient } from './client'
import { buildMcpToolName } from './names'

export async function mcpToolsFor(client: McpClient): Promise<Tool[]> {
  const descriptors = await client.listTools()
  return descriptors.map(d => ({
    name: buildMcpToolName(client.name, d.name),
    description: d.description ?? '',
    parameters: d.inputSchema ?? { type: 'object', properties: {} },
    source: 'mcp' as const,
    needsPermission: () => 'exec' as const,
    async run(input: unknown, ctx: { signal: AbortSignal }) {
      return client.callTool(d.name, input, ctx.signal)
    },
  }))
}
