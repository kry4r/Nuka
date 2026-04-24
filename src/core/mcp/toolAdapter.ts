import type { Tool } from '../tools/types'
import type { McpClient } from './client'
import { buildMcpToolName } from './names'

export async function mcpToolsFor(client: McpClient): Promise<Tool[]> {
  const descriptors = await client.listTools()
  return descriptors.map(d => {
    const annotations: Tool['annotations'] = d.annotations
      ? {
          readOnly: d.annotations.readOnlyHint,
          destructive: d.annotations.destructiveHint,
          openWorld: d.annotations.openWorldHint,
        }
      : undefined

    return {
      name: buildMcpToolName(client.name, d.name),
      description: d.description ?? '',
      parameters: d.inputSchema ?? { type: 'object', properties: {} },
      source: 'mcp' as const,
      annotations,
      needsPermission: () => 'exec' as const,
      async run(input: unknown, ctx: { signal: AbortSignal }) {
        return client.callTool(d.name, input, ctx.signal)
      },
    }
  })
}
