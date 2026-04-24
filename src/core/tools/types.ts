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
  /**
   * Keywords that trigger eager loading when matched against the first user
   * message. Once matched, the tool stays loaded for the session.
   * Shape kept identical to M1 (cross-stream merge safety).
   */
  searchHint?: string[]
  /**
   * If true, always include this tool in every provider call.
   * Shape kept identical to M1 (cross-stream merge safety).
   */
  alwaysLoad?: boolean
  /**
   * Return true to defer this tool (exclude from provider call) unless
   * it has been un-deferred via searchHint matching or manual un-defer.
   */
  shouldDefer?: (input: { text: string }) => boolean
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
