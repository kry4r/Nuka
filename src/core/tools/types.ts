// src/core/tools/types.ts
import type { ToolSpec } from '../provider/types'

export type PermissionHint = 'none' | 'write' | 'exec' | 'network'

export type ToolResult = { output: string; isError: boolean }

export type ToolContext = {
  signal: AbortSignal
  cwd: string
  onProgress?: (msg: string) => void
}

export interface Tool<I = unknown> {
  name: string
  description: string
  parameters: Record<string, unknown>
  source: 'builtin' | 'skill' | 'mcp' | 'plugin'
  needsPermission: (input: I) => PermissionHint
  run: (input: I, ctx: ToolContext) => Promise<ToolResult>
}

export function toToolSpec<I>(t: Tool<I>): ToolSpec {
  return {
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }
}
