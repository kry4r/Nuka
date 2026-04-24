import type { Tool } from '../tools/types'
import type { McpManager } from './manager'

export function makeListMcpResourcesTool(manager: McpManager): Tool<{ server?: string }> {
  return {
    name: 'ListMcpResources',
    description: 'List resources exposed by connected MCP servers. Optional server filter.',
    parameters: {
      type: 'object',
      properties: { server: { type: 'string' } },
    },
    source: 'builtin',
    needsPermission: () => 'none',
    async run(input, _ctx) {
      const clients = input.server
        ? manager.listClients().filter(c => c.name === input.server)
        : manager.listClients()

      if (input.server && clients.length === 0) {
        return {
          output: `server '${input.server}' not found. connected servers: ${manager.listClients().map(c => c.name).join(', ') || '(none)'}`,
          isError: true,
        }
      }

      const results = await Promise.all(
        clients.map(async c => {
          if (c.status.kind !== 'connected') return []
          try {
            const items = await c.listResources()
            return items
          } catch {
            return []
          }
        }),
      )
      const flat = results.flat()
      return { output: JSON.stringify(flat, null, 2), isError: false }
    },
  }
}

export function makeReadMcpResourceTool(manager: McpManager): Tool<{ server: string; uri: string }> {
  return {
    name: 'ReadMcpResource',
    description: 'Read a specific resource by URI from a named MCP server.',
    parameters: {
      type: 'object',
      required: ['server', 'uri'],
      properties: {
        server: { type: 'string' },
        uri: { type: 'string' },
      },
    },
    source: 'builtin',
    needsPermission: () => 'none',
    async run(input, ctx) {
      const c = manager.findClient(input.server)
      if (!c) return { output: `unknown server: ${input.server}`, isError: true }
      if (c.status.kind !== 'connected') return { output: `server '${input.server}' is not connected`, isError: true }
      return c.readResource(input.uri, ctx.signal)
    },
  }
}
