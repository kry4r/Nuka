// test/core/hooks/wrapToolPipeline.test.ts
//
// Tests for Iter WWW — afterToolCall pipeline mode in `wrapWithHooks`.
//
// Coverage areas:
//   - Pipeline mode chains replaceResult between handlers
//   - Handler returning {} passes state through unchanged
//   - Throwing handler is isolated; pipeline continues with current state
//   - Order is preserved (priority → insertion order)
//   - Last-write-wins (default) is unchanged: handlers read original
//     payload.result, only the last replaceResult wins
//   - ToolResult type guard rejects malformed replacement payloads in
//     both modes (so a broken hook can't poison the pipeline)
//   - Empty handler list is a no-op in both modes
//   - Real handlers (auto-truncate + jsonFormat) chain correctly under
//     pipeline mode

import { describe, it, expect } from 'vitest'
import { createHookRegistry } from '../../../src/core/hooks/registry'
import { wrapWithHooks } from '../../../src/core/hooks/wrapTool'
import type { Tool, ToolContext, ToolResult } from '../../../src/core/tools/types'
import { createAutoTruncateHook } from '../../../src/core/toolResult/autoTruncateHook'
import { createJsonFormatHandler } from '../../../src/core/jsonFormat/jsonFormatHook'

function makeTool(opts: {
  name?: string
  run: (input: unknown, ctx: ToolContext) => Promise<ToolResult>
}): Tool {
  return {
    name: opts.name ?? 'TestTool',
    description: 'test',
    parameters: { type: 'object', properties: {} },
    source: 'builtin',
    tags: [],
    needsPermission: () => 'none',
    run: opts.run,
  }
}

function makeCtx(): ToolContext {
  return {
    signal: new AbortController().signal,
    cwd: '/tmp',
  }
}

/** Shorthand for a `{ data: { replaceResult } }` post-hook return. */
function replaceWith(output: string, isError = false): {
  data: { replaceResult: ToolResult }
} {
  return { data: { replaceResult: { output, isError } } }
}

describe('wrapWithHooks pipeline mode', () => {
  it('pipeline mode: handler B sees A.replaceResult as payload.result (chained)', async () => {
    const seenByB: unknown[] = []
    const registry = createHookRegistry()
    registry.register('afterToolCall', () => replaceWith('A-output'), {
      id: 'A',
    })
    registry.register(
      'afterToolCall',
      (ctx) => {
        const payload = ctx.payload as { result?: ToolResult }
        seenByB.push(payload.result?.output)
        return replaceWith('B-output')
      },
      { id: 'B' },
    )
    const tool = makeTool({
      run: async () => ({ output: 'original', isError: false }),
    })
    const wrapped = wrapWithHooks(tool, registry, { pipelineMode: 'pipeline' })
    const result = await wrapped.run({}, makeCtx())
    expect(seenByB).toEqual(['A-output'])
    expect(result.output).toBe('B-output')
  })

  it('pipeline mode: handler A returns {} → B sees original (passthrough)', async () => {
    const seenByB: unknown[] = []
    const registry = createHookRegistry()
    registry.register('afterToolCall', () => ({}), { id: 'A' })
    registry.register(
      'afterToolCall',
      (ctx) => {
        const payload = ctx.payload as { result?: ToolResult }
        seenByB.push(payload.result?.output)
        return replaceWith('B-output')
      },
      { id: 'B' },
    )
    const tool = makeTool({
      run: async () => ({ output: 'original', isError: false }),
    })
    const wrapped = wrapWithHooks(tool, registry, { pipelineMode: 'pipeline' })
    const result = await wrapped.run({}, makeCtx())
    expect(seenByB).toEqual(['original'])
    expect(result.output).toBe('B-output')
  })

  it('pipeline mode: handler A throws → B still runs with current state', async () => {
    const seenByB: unknown[] = []
    const registry = createHookRegistry()
    registry.register(
      'afterToolCall',
      () => {
        throw new Error('A-boom')
      },
      { id: 'A' },
    )
    registry.register(
      'afterToolCall',
      (ctx) => {
        const payload = ctx.payload as { result?: ToolResult }
        seenByB.push(payload.result?.output)
        return replaceWith('B-output')
      },
      { id: 'B' },
    )
    const tool = makeTool({
      run: async () => ({ output: 'original', isError: false }),
    })
    const wrapped = wrapWithHooks(tool, registry, { pipelineMode: 'pipeline' })
    const result = await wrapped.run({}, makeCtx())
    // A threw, state was 'original'; B observed 'original' and replaced.
    expect(seenByB).toEqual(['original'])
    expect(result.output).toBe('B-output')
  })

  it('pipeline mode: all handlers return {} → output unchanged', async () => {
    const registry = createHookRegistry()
    registry.register('afterToolCall', () => ({}), { id: 'A' })
    registry.register('afterToolCall', () => ({}), { id: 'B' })
    registry.register('afterToolCall', () => ({}), { id: 'C' })
    const tool = makeTool({
      run: async () => ({ output: 'untouched', isError: false }),
    })
    const wrapped = wrapWithHooks(tool, registry, { pipelineMode: 'pipeline' })
    const result = await wrapped.run({}, makeCtx())
    expect(result.output).toBe('untouched')
    expect(result.isError).toBe(false)
  })

  it('pipeline mode: registration order is preserved when priorities tie', async () => {
    const seen: string[] = []
    const registry = createHookRegistry()
    registry.register(
      'afterToolCall',
      (ctx) => {
        const payload = ctx.payload as { result?: ToolResult }
        seen.push(`A:${payload.result?.output}`)
        return replaceWith('after-A')
      },
      { id: 'A' },
    )
    registry.register(
      'afterToolCall',
      (ctx) => {
        const payload = ctx.payload as { result?: ToolResult }
        seen.push(`B:${payload.result?.output}`)
        return replaceWith('after-B')
      },
      { id: 'B' },
    )
    registry.register(
      'afterToolCall',
      (ctx) => {
        const payload = ctx.payload as { result?: ToolResult }
        seen.push(`C:${payload.result?.output}`)
        return replaceWith('after-C')
      },
      { id: 'C' },
    )
    const tool = makeTool({
      run: async () => ({ output: 'original', isError: false }),
    })
    const wrapped = wrapWithHooks(tool, registry, { pipelineMode: 'pipeline' })
    const result = await wrapped.run({}, makeCtx())
    expect(seen).toEqual(['A:original', 'B:after-A', 'C:after-B'])
    expect(result.output).toBe('after-C')
  })

  it('pipeline mode: priority overrides registration order', async () => {
    const seen: string[] = []
    const registry = createHookRegistry()
    // Registered first but lower priority → runs last.
    registry.register(
      'afterToolCall',
      (ctx) => {
        const payload = ctx.payload as { result?: ToolResult }
        seen.push(`low:${payload.result?.output}`)
        return replaceWith('low-out')
      },
      { id: 'low', priority: 0 },
    )
    // Registered second but higher priority → runs first.
    registry.register(
      'afterToolCall',
      (ctx) => {
        const payload = ctx.payload as { result?: ToolResult }
        seen.push(`high:${payload.result?.output}`)
        return replaceWith('high-out')
      },
      { id: 'high', priority: 10 },
    )
    const tool = makeTool({
      run: async () => ({ output: 'original', isError: false }),
    })
    const wrapped = wrapWithHooks(tool, registry, { pipelineMode: 'pipeline' })
    const result = await wrapped.run({}, makeCtx())
    // high runs first, sees original; low runs second, sees high-out.
    expect(seen).toEqual(['high:original', 'low:high-out'])
    expect(result.output).toBe('low-out')
  })

  it('pipeline mode: only successful handlers contribute replacements (malformed replaceResult ignored)', async () => {
    const seenByB: unknown[] = []
    const registry = createHookRegistry()
    // Handler A returns a *bad* replaceResult (missing isError).
    // The isToolResult guard rejects it, so B should see the ORIGINAL.
    registry.register(
      'afterToolCall',
      () => ({ data: { replaceResult: { output: 'no-iserror' } } }),
      { id: 'A' },
    )
    registry.register(
      'afterToolCall',
      (ctx) => {
        const payload = ctx.payload as { result?: ToolResult }
        seenByB.push(payload.result?.output)
        return {}
      },
      { id: 'B' },
    )
    const tool = makeTool({
      run: async () => ({ output: 'original', isError: false }),
    })
    const wrapped = wrapWithHooks(tool, registry, { pipelineMode: 'pipeline' })
    const result = await wrapped.run({}, makeCtx())
    expect(seenByB).toEqual(['original'])
    expect(result.output).toBe('original')
  })

  it('pipeline mode: tool error path — replaceResult is ignored, error re-thrown', async () => {
    const observed: { result?: ToolResult; error?: unknown }[] = []
    const registry = createHookRegistry()
    registry.register('afterToolCall', (ctx) => {
      const payload = ctx.payload as { result?: ToolResult; error?: unknown }
      observed.push({ result: payload.result, error: payload.error })
      // Even though we return replaceResult, error path should ignore it.
      return replaceWith('should-not-apply')
    })
    const tool = makeTool({
      run: async () => {
        throw new Error('tool-boom')
      },
    })
    const wrapped = wrapWithHooks(tool, registry, { pipelineMode: 'pipeline' })
    await expect(wrapped.run({}, makeCtx())).rejects.toThrow('tool-boom')
    expect(observed).toHaveLength(1)
    expect(observed[0]?.result).toBeUndefined()
    expect((observed[0]?.error as Error).message).toBe('tool-boom')
  })

  it('pipeline mode: empty handler list → no-op (tool output passes through)', async () => {
    const registry = createHookRegistry()
    const tool = makeTool({
      run: async () => ({ output: 'as-is', isError: false }),
    })
    const wrapped = wrapWithHooks(tool, registry, { pipelineMode: 'pipeline' })
    const result = await wrapped.run({}, makeCtx())
    expect(result.output).toBe('as-is')
    expect(result.isError).toBe(false)
  })

  it('last-write-wins mode (default): both A and B return replaceResult → B wins, A discarded', async () => {
    const seenByA: unknown[] = []
    const seenByB: unknown[] = []
    const registry = createHookRegistry()
    registry.register(
      'afterToolCall',
      (ctx) => {
        const payload = ctx.payload as { result?: ToolResult }
        seenByA.push(payload.result?.output)
        return replaceWith('A-output')
      },
      { id: 'A' },
    )
    registry.register(
      'afterToolCall',
      (ctx) => {
        const payload = ctx.payload as { result?: ToolResult }
        seenByB.push(payload.result?.output)
        return replaceWith('B-output')
      },
      { id: 'B' },
    )
    const tool = makeTool({
      run: async () => ({ output: 'original', isError: false }),
    })
    // No options → default last-write-wins.
    const wrapped = wrapWithHooks(tool, registry)
    const result = await wrapped.run({}, makeCtx())
    expect(seenByA).toEqual(['original'])
    // KEY: B also sees ORIGINAL, not A-output. No chaining in last-write-wins.
    expect(seenByB).toEqual(['original'])
    // KEY: B's replacement wins (last write).
    expect(result.output).toBe('B-output')
  })

  it('last-write-wins mode: explicit option matches default behaviour', async () => {
    const seenByB: unknown[] = []
    const registry = createHookRegistry()
    registry.register('afterToolCall', () => replaceWith('A-output'), { id: 'A' })
    registry.register(
      'afterToolCall',
      (ctx) => {
        const payload = ctx.payload as { result?: ToolResult }
        seenByB.push(payload.result?.output)
        return replaceWith('B-output')
      },
      { id: 'B' },
    )
    const tool = makeTool({
      run: async () => ({ output: 'original', isError: false }),
    })
    const wrapped = wrapWithHooks(tool, registry, {
      pipelineMode: 'last-write-wins',
    })
    const result = await wrapped.run({}, makeCtx())
    // Same as default — B does NOT see A's replaceResult.
    expect(seenByB).toEqual(['original'])
    expect(result.output).toBe('B-output')
  })

  it('last-write-wins mode: malformed replaceResult ignored (type guard)', async () => {
    const registry = createHookRegistry()
    // Bad replacement (no isError field).
    registry.register(
      'afterToolCall',
      () => ({ data: { replaceResult: { output: 'bad' } } }),
      { id: 'A' },
    )
    // Good replacement.
    registry.register('afterToolCall', () => replaceWith('good'), { id: 'B' })
    const tool = makeTool({
      run: async () => ({ output: 'original', isError: false }),
    })
    const wrapped = wrapWithHooks(tool, registry)
    const result = await wrapped.run({}, makeCtx())
    // The malformed one is skipped; the good one wins.
    expect(result.output).toBe('good')
  })

  it('last-write-wins mode: empty handler list → no-op', async () => {
    const registry = createHookRegistry()
    const tool = makeTool({
      run: async () => ({ output: 'as-is', isError: false }),
    })
    const wrapped = wrapWithHooks(tool, registry)
    const result = await wrapped.run({}, makeCtx())
    expect(result.output).toBe('as-is')
    expect(result.isError).toBe(false)
  })

  it('integration: jsonFormat + auto-truncate chain under pipeline mode', async () => {
    // Build a single-line JSON that is both:
    //   - parseable JSON (jsonFormat will pretty-print it)
    //   - shorter than the auto-truncate budget pre-format, but
    //     pretty-printed it stays still well under the budget, so the
    //     chain just verifies jsonFormat applied. The composition test
    //     here is: handler B (auto-truncate) MUST see the pretty-printed
    //     output, not the raw compact JSON.
    const items = Array.from({ length: 20 }, (_, i) => ({ id: i, v: `item-${i}` }))
    const compact = JSON.stringify(items)

    const seenByTruncate: number[] = []
    const registry = createHookRegistry()
    // jsonFormat first (registration order; both default priority).
    registry.register('afterToolCall', createJsonFormatHandler(), {
      id: 'jsonFormat',
    })
    // Spy handler in the middle to observe pipeline state mid-chain.
    registry.register(
      'afterToolCall',
      (ctx) => {
        const payload = ctx.payload as { result?: ToolResult }
        const out = payload.result?.output
        if (typeof out === 'string') seenByTruncate.push(out.length)
        return {}
      },
      { id: 'observer' },
    )
    // auto-truncate last — with a high enough cap that it's a no-op,
    // but we still want to verify the pipeline reached it.
    registry.register('afterToolCall', createAutoTruncateHook({ maxChars: 100000 }), {
      id: 'auto-truncate',
    })

    const tool = makeTool({
      run: async () => ({ output: compact, isError: false }),
    })
    const wrapped = wrapWithHooks(tool, registry, { pipelineMode: 'pipeline' })
    const result = await wrapped.run({}, makeCtx())
    expect(typeof result.output).toBe('string')
    // Pretty-printed JSON should contain newlines (compact didn't).
    expect((result.output as string).includes('\n')).toBe(true)
    // Observer saw the pretty-printed length, NOT the compact length.
    expect(seenByTruncate).toHaveLength(1)
    expect(seenByTruncate[0]).toBeGreaterThan(compact.length)
  })

  it('integration: jsonFormat + auto-truncate do NOT chain under last-write-wins', async () => {
    // Same setup as the pipeline test, but in last-write-wins mode. The
    // observer should see the ORIGINAL compact output, because handlers
    // are not chained: each reads the same payload.result. The wrapper
    // then picks the LAST successful replaceResult; since auto-truncate
    // returned `{}` (under budget), the wrapper falls back to
    // jsonFormat's pretty-printed replacement.
    const items = Array.from({ length: 20 }, (_, i) => ({ id: i, v: `item-${i}` }))
    const compact = JSON.stringify(items)
    const seenByObserver: number[] = []
    const registry = createHookRegistry()
    registry.register('afterToolCall', createJsonFormatHandler(), {
      id: 'jsonFormat',
    })
    registry.register(
      'afterToolCall',
      (ctx) => {
        const payload = ctx.payload as { result?: ToolResult }
        const out = payload.result?.output
        if (typeof out === 'string') seenByObserver.push(out.length)
        return {}
      },
      { id: 'observer' },
    )
    registry.register('afterToolCall', createAutoTruncateHook({ maxChars: 100000 }), {
      id: 'auto-truncate',
    })

    const tool = makeTool({
      run: async () => ({ output: compact, isError: false }),
    })
    // Default mode (last-write-wins).
    const wrapped = wrapWithHooks(tool, registry)
    const result = await wrapped.run({}, makeCtx())
    // Observer saw the ORIGINAL compact length, not pretty-printed.
    expect(seenByObserver).toEqual([compact.length])
    // Surfaced result still got the pretty-printed output (jsonFormat
    // was the only replacement; auto-truncate returned {} so didn't
    // override). This is the historical behaviour.
    expect(typeof result.output).toBe('string')
    expect((result.output as string).includes('\n')).toBe(true)
  })
})
