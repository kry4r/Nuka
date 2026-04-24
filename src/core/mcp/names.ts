export function normalizeMcpName(s: string): string {
  const result = s
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (result === '') throw new Error(`MCP name "${s}" normalizes to empty string`)
  return result
}

export function buildMcpToolName(server: string, tool: string): string {
  return `mcp__${normalizeMcpName(server)}__${normalizeMcpName(tool)}`
}

export function parseMcpToolName(name: string): { server: string; tool: string } | null {
  const parts = name.split('__')
  if (parts[0] !== 'mcp' || parts.length < 3) return null
  const server = parts[1]
  const tool = parts.slice(2).join('__')
  if (!server || !tool) return null
  return { server, tool }
}

/**
 * Format a namespaced MCP tool name for user-facing display.
 * `mcp__github__listRepos` → `{ server: 'github', tool: 'listRepos' }`
 * Returns `null` for non-MCP names.
 */
export function formatMcpDisplayName(namespaced: string): { server: string; tool: string } | null {
  return parseMcpToolName(namespaced)
}
