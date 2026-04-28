import type { Tool } from '../tools/types'
import type { McpClient } from './client'
import { buildMcpToolName } from './names'
import { truncateDescription } from './truncate'

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
      description: truncateDescription(d.description ?? ''),
      parameters: d.inputSchema ?? { type: 'object', properties: {} },
      source: 'mcp' as const,
      tags: [],
      annotations,
      // M1.16: map _meta fields to Tool.searchHint / Tool.alwaysLoad
      ...(d._meta?.searchHint !== undefined ? { searchHint: d._meta.searchHint } : {}),
      ...(d._meta?.alwaysLoad !== undefined ? { alwaysLoad: d._meta.alwaysLoad } : {}),
      needsPermission: () => 'exec' as const,
      async run(input: unknown, ctx: { signal: AbortSignal }) {
        return client.callTool(d.name, input, ctx.signal)
      },
    }
  })
}
