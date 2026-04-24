// src/core/tools/types.ts
import type { ToolSpec } from '../provider/types'
import type { ValidationResult } from './validate'
import type { ContentBlock } from './content'

export type { ContentBlock } from './content'

export type PermissionHint = 'none' | 'write' | 'exec' | 'network'

export type ToolResult = { output: string | ContentBlock[]; isError: boolean }

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
  /** Optional custom validator; if absent, validateWithJsonSchema is used. */
  validateInput?: (input: unknown) => ValidationResult<I>
  /** Optional per-tool result size cap (string output only). */
  maxResultSizeChars?: number
  /** Optional annotations about tool behavior. */
  annotations?: {
    readOnly?: boolean
    destructive?: boolean
    openWorld?: boolean
  }
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
