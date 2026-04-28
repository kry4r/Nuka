// src/core/tools/define.ts
import type { Tool, ToolContext, ToolResult } from './types'
import { executeSpawn } from './spawnRuntime'

/**
 * Spec accepted by {@link defineTool}.
 *
 * - When `runtime.kind === 'spawn'`, `run` is OPTIONAL — it will be
 *   synthesised by the platform via {@link executeSpawn}.
 * - For the default in-process runtime, `run` is required and is passed
 *   through unchanged.
 *
 * `tags` defaults to `[]` if omitted (the registry treats empty as
 * "no capability tags").
 *
 * See spec §4.1 (Tool authoring) and §7 (Tag taxonomy).
 */
export type DefineToolSpec<I> =
  | (Omit<Tool<I>, 'run' | 'tags'> & {
      tags?: string[]
      runtime: Extract<NonNullable<Tool<I>['runtime']>, { kind: 'spawn' }>
      run?: Tool<I>['run']
    })
  | (Omit<Tool<I>, 'tags'> & {
      tags?: string[]
      runtime?: Extract<NonNullable<Tool<I>['runtime']>, { kind: 'in-process' }>
    })

/**
 * Factory that produces a {@link Tool}. Centralises:
 *
 * 1. Defaulting `tags` to `[]` when omitted.
 * 2. Synthesising `run` from {@link executeSpawn} for spawn-runtime tools.
 * 3. Pass-through for in-process tools (the author's `run` is unchanged).
 *
 * Internal/builtin tools migrated to this factory get tag-based activation
 * for free (spec §4.3) without losing their original behaviour.
 */
export function defineTool<I = unknown>(spec: DefineToolSpec<I>): Tool<I> {
  const tags = spec.tags ?? []

  if (spec.runtime && spec.runtime.kind === 'spawn') {
    const partial: Tool<I> = {
      ...(spec as Omit<Tool<I>, 'tags' | 'run'>),
      tags,
      runtime: spec.runtime,
      run: spec.run ?? (async (input: I, ctx: ToolContext): Promise<ToolResult> => {
        return executeSpawn(partial, input, ctx)
      }),
    }
    return partial
  }

  // in-process (default): pass run through unchanged.
  if (!('run' in spec) || typeof (spec as Tool<I>).run !== 'function') {
    throw new Error(`defineTool: tool '${spec.name}' has no run() and no spawn runtime`)
  }
  return {
    ...(spec as Tool<I>),
    tags,
    runtime: spec.runtime ?? { kind: 'in-process' },
  }
}
