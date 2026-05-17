// test/core/toolResult/autoTruncateHook.test.ts
//
// Tests for the `createAutoTruncateHook` factory and its integration with
// `wrapWithHooks` (the consumer of the `data.replaceResult` contract).
//
// Two test surfaces:
//   1. Direct handler invocation — pass a fake `HookContext` and assert
//      what the handler returns. Independent of the registry / wrapper.
//   2. End-to-end via `wrapWithHooks` — confirm that an oversized
//      tool output is actually replaced before being returned to the
//      caller. This validates the contract between the hook and the
//      wrapper (which is the load-bearing piece of the integration).

import { describe, it, expect } from 'vitest'
import {
  createAutoTruncateHook,
  DEFAULT_AUTO_TRUNCATE_MAX_CHARS,
} from '../../../src/core/toolResult/autoTruncateHook'
import { createHookRegistry } from '../../../src/core/hooks/registry'
import { wrapWithHooks } from '../../../src/core/hooks/wrapTool'
import type {
  HookContext,
  HookResult,
} from '../../../src/core/hooks/events'
import type { Tool, ToolContext, ToolResult } from '../../../src/core/tools/types'

/** Build a HookContext with the shape wrapTool.ts emits for afterToolCall. */
function makeAfterCtx(result: ToolResult | undefined, runError?: unknown): HookContext {
  return {
    event: 'afterToolCall',
    toolName: 'TestTool',
    payload: { input: {}, result, error: runError },
  }
}

/** Invoke a sync-or-async handler and normalise its return to a HookResult. */
async function call(handler: ReturnType<typeof createAutoTruncateHook>, ctx: HookContext): Promise<HookResult> {
  const ret = await handler(ctx)
  return ret ?? {}
}

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
  return { signal: new AbortController().signal, cwd: '/tmp' }
}

describe('createAutoTruncateHook — direct handler invocation', () => {
  it('passes through when output is under budget', async () => {
    const handler = createAutoTruncateHook({ maxChars: 100 })
    const result: ToolResult = { output: 'short output', isError: false }
    const ret = await call(handler, makeAfterCtx(result))
    expect(ret.data).toBeUndefined()
  })

  it('returns a replaceResult when output exceeds budget', async () => {
    const handler = createAutoTruncateHook({ maxChars: 50 })
    const long = 'x'.repeat(500)
    const result: ToolResult = { output: long, isError: false }
    const ret = await call(handler, makeAfterCtx(result))
    const replace = ret.data?.replaceResult as ToolResult | undefined
    expect(replace).toBeDefined()
    expect(replace!.isError).toBe(false)
    expect(typeof replace!.output).toBe('string')
    const truncatedOutput = replace!.output as string
    // Truncated body fits within budget (segmenter-counted).
    expect(truncatedOutput.length).toBeLessThanOrEqual(50)
    // And the omission marker is present.
    expect(truncatedOutput).toMatch(/chars omitted/)
    // And the metadata block records the sizes.
    const meta = ret.data?.autoTruncate as
      | { originalLength: number; truncatedLength: number; maxChars: number }
      | undefined
    expect(meta).toBeDefined()
    expect(meta!.originalLength).toBe(500)
    expect(meta!.maxChars).toBe(50)
  })

  it('respects a custom maxChars override (smaller)', async () => {
    const handler = createAutoTruncateHook({ maxChars: 30 })
    const long = 'a'.repeat(1000)
    const ret = await call(handler, makeAfterCtx({ output: long, isError: false }))
    const replace = ret.data?.replaceResult as ToolResult
    expect((replace.output as string).length).toBeLessThanOrEqual(30)
  })

  it('respects a custom maxChars override (larger than the default)', async () => {
    // Default would truncate at 8000; with 20000 budget the 10k input passes.
    const handler = createAutoTruncateHook({ maxChars: 20_000 })
    const long = 'b'.repeat(10_000)
    const ret = await call(handler, makeAfterCtx({ output: long, isError: false }))
    expect(ret.data).toBeUndefined()
  })

  it('uses the documented default budget when maxChars is omitted', async () => {
    const handler = createAutoTruncateHook()
    expect(DEFAULT_AUTO_TRUNCATE_MAX_CHARS).toBe(8000)
    // Just under the default → pass-through.
    const just = 'c'.repeat(DEFAULT_AUTO_TRUNCATE_MAX_CHARS)
    expect(await call(handler, makeAfterCtx({ output: just, isError: false }))).toEqual({})
    // Over the default → truncate.
    const over = 'd'.repeat(DEFAULT_AUTO_TRUNCATE_MAX_CHARS + 1)
    const ret = await call(handler, makeAfterCtx({ output: over, isError: false }))
    expect(ret.data?.replaceResult).toBeDefined()
  })

  it('throws at construction time for non-positive maxChars', () => {
    expect(() => createAutoTruncateHook({ maxChars: 0 })).toThrow(/maxChars/)
    expect(() => createAutoTruncateHook({ maxChars: -5 })).toThrow(/maxChars/)
  })

  it('passes through when result is undefined (tool threw)', async () => {
    const handler = createAutoTruncateHook({ maxChars: 10 })
    const ret = await call(handler, makeAfterCtx(undefined, new Error('boom')))
    expect(ret).toEqual({})
  })

  it('passes through when result.isError is true (preserve error text)', async () => {
    const handler = createAutoTruncateHook({ maxChars: 50 })
    const longErr: ToolResult = { output: 'x'.repeat(500), isError: true }
    const ret = await call(handler, makeAfterCtx(longErr))
    expect(ret).toEqual({})
  })

  it('passes through when output is a ContentBlock[] (non-string)', async () => {
    const handler = createAutoTruncateHook({ maxChars: 5 })
    // Cast: the ContentBlock shape is opaque to the hook; what matters is
    // that `typeof output !== 'string'`.
    const blocks = [{ type: 'text', text: 'x'.repeat(1000) }] as unknown as ToolResult['output']
    const ret = await call(handler, makeAfterCtx({ output: blocks, isError: false }))
    expect(ret).toEqual({})
  })

  it('passes through when payload is undefined', async () => {
    const handler = createAutoTruncateHook({ maxChars: 10 })
    const ret = await handler({
      event: 'afterToolCall',
      toolName: 'X',
    })
    expect(ret ?? {}).toEqual({})
  })

  it('passes through when payload.result is not a ToolResult-shaped object', async () => {
    const handler = createAutoTruncateHook({ maxChars: 10 })
    // Number, object-without-isError, plain string — all should be ignored.
    for (const candidate of [
      42,
      'just-a-string',
      { output: 'hi', isError: 'not-a-bool' },
      null,
    ] as unknown[]) {
      const ret = await handler({
        event: 'afterToolCall',
        toolName: 'X',
        payload: { result: candidate },
      })
      expect(ret ?? {}).toEqual({})
    }
  })
})

describe('createAutoTruncateHook — end-to-end via wrapWithHooks', () => {
  it('replaces oversized output before it reaches the caller', async () => {
    const registry = createHookRegistry()
    registry.register('afterToolCall', createAutoTruncateHook({ maxChars: 80 }), {
      id: 'auto-truncate-output',
    })
    const tool = makeTool({
      run: async () => ({ output: 'z'.repeat(1000), isError: false }),
    })
    const wrapped = wrapWithHooks(tool, registry)
    const result = await wrapped.run({}, makeCtx())
    expect(typeof result.output).toBe('string')
    expect((result.output as string).length).toBeLessThanOrEqual(80)
    expect((result.output as string)).toMatch(/chars omitted/)
    expect(result.isError).toBe(false)
  })

  it('leaves under-budget output untouched end-to-end', async () => {
    const registry = createHookRegistry()
    registry.register('afterToolCall', createAutoTruncateHook({ maxChars: 100 }), {
      id: 'auto-truncate-output',
    })
    const tool = makeTool({ run: async () => ({ output: 'ok', isError: false }) })
    const wrapped = wrapWithHooks(tool, registry)
    const result = await wrapped.run({}, makeCtx())
    expect(result.output).toBe('ok')
  })

  it('still re-throws when the underlying tool throws (replaceResult ignored on error)', async () => {
    const registry = createHookRegistry()
    registry.register('afterToolCall', createAutoTruncateHook({ maxChars: 10 }), {
      id: 'auto-truncate-output',
    })
    const tool = makeTool({
      run: async () => {
        throw new Error('boom')
      },
    })
    const wrapped = wrapWithHooks(tool, registry)
    await expect(wrapped.run({}, makeCtx())).rejects.toThrow('boom')
  })
})
