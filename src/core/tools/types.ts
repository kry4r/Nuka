// src/core/tools/types.ts
import type { ToolSpec } from '../provider/types'
import type { ValidationResult } from './validate'
import type { ContentBlock } from './content'
import type { Session } from '../session/types'

export type { ContentBlock } from './content'

export type PermissionHint = 'none' | 'write' | 'exec' | 'network'

export type ToolResult = { output: string | ContentBlock[]; isError: boolean }

export type ToolContext = {
  signal: AbortSignal
  cwd: string
  onProgress?: (msg: string) => void
  /**
   * Typed progress callback. Available when the tool declares
   * progressType === 'object'. The payload is JSON-serialized and emitted
   * as the text of a tool_progress event.
   */
  onProgressTyped?: <P extends Record<string, unknown>>(payload: P) => void
  /**
   * Persisted user config for the plugin that owns this tool.
   * Only present for plugin tools that have userConfig fields defined in
   * their manifest.
   */
  pluginConfig?: Record<string, unknown>
  /**
   * The session this tool call is running in. Provided so tools can read
   * session-scoped flags (e.g. `allowedAgentDispatch` for the recursion
   * guard on `dispatch_agent`). Optional for backward compatibility.
   */
  session?: Session
}

/**
 * Describes how a tool's `run` is realised at call time.
 *
 * - `in-process` (default): the author supplies `run` directly.
 * - `spawn`: the platform synthesises a `run` that spawns an external process
 *   (see {@link executeSpawn} in spawnRuntime.ts) and adapts its stdout/exit
 *   code into a {@link ToolResult}.
 */
export type ToolRuntime =
  | { kind: 'in-process' }
  | {
      kind: 'spawn'
      command: string
      args?: (input: unknown) => string[]
      env?: NodeJS.ProcessEnv
      parseOutput?: (stdout: string) => unknown
    }

export interface Tool<I = unknown> {
  name: string
  description: string
  parameters: Record<string, unknown>
  source: 'builtin' | 'skill' | 'plugin'
  /**
   * Capability tags used by the activation algorithm (see spec §4.3 and
   * §7). `['core']` means "always available"; other tags such as `'fs.read'`
   * or `'net.read'` are matched against `Skill.requires`.
   *
   * Required at the type level — the registry treats an empty array as
   * "no tags" (the tool is reachable only via the `core` rule or by name).
   */
  tags: string[]
  /**
   * Optional runtime hint for tools that wrap an external process. Default
   * is `{ kind: 'in-process' }` — the author's `run` is used as-is.
   */
  runtime?: ToolRuntime
  /** Optional custom validator; if absent, validateWithJsonSchema is used. */
  validateInput?: (input: unknown) => ValidationResult<I>
  /** Optional per-tool result size cap (string output only). */
  maxResultSizeChars?: number
  /** Optional annotations about tool behavior. */
  annotations?: {
    readOnly?: boolean
    destructive?: boolean
    openWorld?: boolean
    /**
     * When true, the main agent loop may parallelize two calls to this
     * tool even when they share the same tool name. This is only safe
     * when each invocation is fully independent (no shared state).
     * Used by `dispatch_agent` — sibling sub-agent dispatches hold their
     * own isolated session and tool registry.
     */
    parallelSafe?: boolean
  }
  /**
   * Keywords that trigger eager loading when matched against the first user
   * message. Once matched, the tool stays loaded for the session.
   */
  searchHint?: string[]
  /**
   * If true, always include this tool in every provider call.
   */
  alwaysLoad?: boolean
  /**
   * Return true to defer this tool (exclude from provider call) unless
   * it has been un-deferred via searchHint matching or manual un-defer.
   */
  shouldDefer?: (input: { text: string }) => boolean
  /**
   * Alternate names for this tool. The registry will map each alias to
   * this tool so find(alias) works.
   */
  aliases?: string[]
  /**
   * Controls how progress is emitted:
   * - 'line'   (default): tool uses onProgress(string)
   * - 'object': tool uses onProgressTyped(payload)
   */
  progressType?: 'line' | 'object'
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
