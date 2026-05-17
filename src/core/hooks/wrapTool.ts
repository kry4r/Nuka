// src/core/hooks/wrapTool.ts
//
// Higher-order Tool wrapper that integrates the in-process HookRegistry
// (see registry.ts / events.ts / pipeline.ts) into individual tools without
// touching the agent loop's tool-call sites.
//
// Wiring choice: per-Tool wrapping rather than runner-level interception.
//   - Nuka has THREE separate tool-call sites today (parallel path & serial
//     path in agent/loop.ts, plus a third in agents/dispatch.ts). Doing the
//     interception inside the runner would mean modifying all three plus
//     keeping them in lock-step on every future change.
//   - Per-Tool wrapping means the registration sites (cli.tsx and agent
//     dispatch) can opt-in tools individually, and the runners stay
//     completely unchanged. The Tool surface is preserved: a wrapped tool
//     IS a Tool — same name, same parameters, same `needsPermission`, same
//     annotations — only its `run` is intercepted.
//
// Semantics (mirrors the design block in the iter brief):
//   1. Fire `beforeToolCall` hooks before the tool runs.
//   2. If any hook returns `{ skip: true }`, RETURN the synthetic result
//      `{ output: "Skipped by hook: <reason>", isError: false }` without
//      calling the underlying tool. (Matches the shell-hook veto semantics
//      already implemented in agent/loop.ts so the upstream model sees a
//      consistent shape.)
//   3. Run the tool. Capture either the result or a thrown error.
//   4. Fire `afterToolCall` hooks regardless of outcome. They receive the
//      result and/or error via `payload`. Post-hook failures are isolated
//      by the pipeline so a buggy hook does not crash the tool result.
//   5. Re-throw the original error (if any), else return the result.
//
// Error isolation: hooks themselves are isolated via the pipeline's
// per-handler try/catch — a throwing pre-hook becomes `outcome: 'error'`
// in the results array and does NOT prevent tool execution. This matches
// the brief's "pre-hook error doesn't crash tool execution" requirement.
//
// Iter WWW — afterToolCall pipeline mode.
//
// In the default `last-write-wins` mode (preserved for backward compat),
// every afterToolCall handler reads the SAME `payload.result` (the tool's
// original output) and the wrapper picks the last successful
// `replaceResult`. This is fine when only one handler ever mutates the
// result, but it breaks composition: registering jsonFormat + pathDisplay
// + auto-truncate together means each handler sees the original string —
// none sees the prior handler's transformed output, so the transforms
// can't chain.
//
// Pipeline mode (`pipelineMode: 'pipeline'`) fixes this by feeding each
// handler's `data.replaceResult` into the next handler's `payload.result`
// before invoking it. Handlers that return `{}` leave the pipeline state
// untouched. Throwing handlers are still isolated — the pipeline continues
// with the current state.
//
// The choice is per-wrap so a single registry can power both modes for
// different tool sets (e.g. some plumbing tools opt-out of composition).
// Default remains `last-write-wins`. beforeToolCall is unaffected — the
// `{skip}` veto already runs first-veto-wins and doesn't compose this way.

import type { HookRegistry } from './registry'
import type { Tool, ToolContext, ToolResult } from '../tools/types'
import type { HookContext } from './events'
import { compareRegisteredHooks, runOneHandler } from './pipeline'

/**
 * How multiple afterToolCall handlers that return `data.replaceResult`
 * combine.
 *
 * - `'last-write-wins'` (default): every handler reads the original tool
 *   result via `payload.result`; the wrapper picks the last successful
 *   `replaceResult` and discards earlier ones. Matches the surface
 *   shipped in Iter III and is the production default.
 *
 * - `'pipeline'`: handlers run in priority order; each handler's
 *   `payload.result` is the CURRENT pipeline state (either the original
 *   tool result, or the previous handler's `replaceResult` if one was
 *   returned). Handlers that return `{}` pass the state through
 *   unchanged. Throwing handlers are isolated and the pipeline continues
 *   with the current state. The final state becomes the user-visible
 *   output.
 */
export type WrapPipelineMode = 'last-write-wins' | 'pipeline'

/**
 * Options accepted by {@link wrapWithHooks}.
 */
export interface WrapWithHooksOptions {
  /**
   * Pipeline mode for afterToolCall handlers that return
   * `data.replaceResult`. See {@link WrapPipelineMode}. Defaults to
   * `'last-write-wins'`.
   */
  pipelineMode?: WrapPipelineMode
}

/**
 * Return a new Tool whose `run` invokes hooks around the original `run`.
 *
 * The returned Tool shares all metadata (name, description, parameters,
 * annotations, etc.) with the input; only `run` is replaced.
 *
 * @param tool   the underlying tool
 * @param hooks  registry holding the handlers
 * @param opts   wrap options — see {@link WrapWithHooksOptions}
 */
export function wrapWithHooks<I>(
  tool: Tool<I>,
  hooks: HookRegistry,
  opts: WrapWithHooksOptions = {},
): Tool<I> {
  const pipelineMode: WrapPipelineMode = opts.pipelineMode ?? 'last-write-wins'

  const wrapped: Tool<I> = {
    ...tool,
    async run(input: I, ctx: ToolContext): Promise<ToolResult> {
      // 1. beforeToolCall — sequential, error-isolated by the pipeline.
      const preResults = await hooks.invoke(
        'beforeToolCall',
        {
          toolName: tool.name,
          payload: { input },
        },
        { signal: ctx.signal },
      )

      // 2. Look for an explicit skip request from any successful handler.
      //    We check `outcome === 'success'` to ignore handlers that errored;
      //    a hook that throws cannot veto a call (matching the brief's
      //    isolation requirement).
      for (const r of preResults) {
        if (r.outcome === 'success' && r.result?.skip === true) {
          const reason = r.result.reason ?? 'hook-skipped'
          return {
            output: `Skipped by hook: ${reason}`,
            isError: false,
          }
        }
      }

      // 3. Run the underlying tool. Capture either result or error so the
      //    `afterToolCall` hooks can observe both successes and failures.
      let result: ToolResult | undefined
      let runError: unknown
      try {
        result = await tool.run(input, ctx)
      } catch (err) {
        runError = err
      }

      // 4. afterToolCall — dispatch mode depends on `pipelineMode`.
      if (pipelineMode === 'pipeline') {
        // Pipeline mode: feed each handler's replaceResult into the next
        // handler's payload.result. We bypass `hooks.invoke()` because that
        // one-shot call builds the payload once and reuses it for every
        // handler; we need per-handler payload mutation to chain
        // transformations.
        //
        // Snapshot the handler list at dispatch time so a handler that
        // re-registers mid-flight doesn't surprise us. Sort with the same
        // comparator the registry uses so priority/insertion order matches
        // last-write-wins behaviour. Error isolation is provided by
        // `runOneHandler` (identical semantics to `runPipeline`).
        const ordered = [...hooks.list('afterToolCall')].sort(
          compareRegisteredHooks,
        )
        // Only chain replacements on the success path — preserving the
        // last-write-wins guard that "runError set → re-throw, don't
        // surface replacement". Handlers still run on the error path so
        // observers can see the failure; their replaceResult is ignored.
        for (const hook of ordered) {
          if (ctx.signal?.aborted) break
          const handlerCtx: HookContext = {
            event: 'afterToolCall',
            toolName: tool.name,
            payload: {
              input,
              result,
              error: runError,
            },
            signal: ctx.signal,
          }
          const res = await runOneHandler(hook, handlerCtx)
          if (runError !== undefined) continue
          if (res.outcome !== 'success') continue
          const replaceResult = res.result?.data?.replaceResult
          if (isToolResult(replaceResult)) {
            result = replaceResult
          }
        }
      } else {
        // last-write-wins (default) — preserved verbatim from Iter III.
        const postResults = await hooks.invoke(
          'afterToolCall',
          {
            toolName: tool.name,
            payload: {
              input,
              result,
              error: runError,
            },
          },
          { signal: ctx.signal },
        )
        // 4a. Allow a successful post-hook to REPLACE the surfaced result
        //     by returning `{ data: { replaceResult: <ToolResult> } }`. This is
        //     the contract used by the auto-truncate hook (see
        //     core/toolResult/autoTruncateHook.ts) so oversized output is
        //     trimmed before the agent ever sees it. Replacement only applies
        //     to successful runs; if `runError` is set we still re-throw below.
        //     Last-write-wins among multiple hooks (handlers run in priority
        //     order; later replacements supersede earlier ones).
        if (runError === undefined) {
          for (const r of postResults) {
            if (r.outcome !== 'success') continue
            const replaceResult = r.result?.data?.replaceResult
            if (isToolResult(replaceResult)) {
              result = replaceResult
            }
          }
        }
      }

      // 5. Surface the original outcome. We re-throw so the existing
      //    agent-loop error handling (try/catch around the parallel batch,
      //    the catch on serial toolPromise) sees the exact same exception
      //    it would have seen without wrapping.
      if (runError !== undefined) throw runError
      // result is defined here because either tool.run resolved (result set)
      // or it threw (runError set → we returned above). The non-null assertion
      // expresses that invariant to TypeScript.
      return result!
    },
  }
  return wrapped
}

/**
 * Narrow an opaque value to `ToolResult`. Used by step 4a to vet a hook's
 * proposed replacement payload before we trust it as the surfaced output.
 * We accept either string output or an array (the ContentBlock[] case is
 * not deeply validated here — the agent-side renderer is responsible for
 * tolerating malformed blocks; the gate just stops obvious garbage from
 * the hook contract entering the pipeline).
 */
function isToolResult(v: unknown): v is ToolResult {
  if (typeof v !== 'object' || v === null) return false
  const obj = v as Record<string, unknown>
  if (typeof obj.isError !== 'boolean') return false
  return typeof obj.output === 'string' || Array.isArray(obj.output)
}
