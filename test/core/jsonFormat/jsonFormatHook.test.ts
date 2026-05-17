// test/core/jsonFormat/jsonFormatHook.test.ts
//
// Tests for `createJsonFormatHandler` — the opt-in afterToolCall hook
// that pretty-prints raw compact JSON tool output.
//
// Surface covers:
//   1. Direct handler invocation — pass a fake `HookContext` and assert
//      what the handler returns. Independent of the registry / wrapper.
//   2. End-to-end via the real `HookRegistry` + `wrapWithHooks` — confirms
//      that the `data.replaceResult` contract is honoured and the
//      formatted text reaches the caller.

import { describe, it, expect } from 'vitest'
import {
  createJsonFormatHandler,
  DEFAULT_JSON_FORMAT_MIN_LENGTH,
} from '../../../src/core/jsonFormat/jsonFormatHook'
import { createHookRegistry } from '../../../src/core/hooks/registry'
import { wrapWithHooks } from '../../../src/core/hooks/wrapTool'
import type {
  HookContext,
  HookResult,
} from '../../../src/core/hooks/events'
import type { Tool, ToolContext, ToolResult } from '../../../src/core/tools/types'

/** Build a HookContext shaped like the one wrapTool.ts emits for afterToolCall. */
function makeAfterCtx(
  result: ToolResult | undefined,
  runError?: unknown,
  toolName = 'TestTool',
): HookContext {
  return {
    event: 'afterToolCall',
    toolName,
    payload: { input: {}, result, error: runError },
  }
}

/** Invoke a sync-or-async handler and normalise its return to a HookResult. */
async function call(
  handler: ReturnType<typeof createJsonFormatHandler>,
  ctx: HookContext,
): Promise<HookResult> {
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

/**
 * Build a long-enough compact JSON string by repeating a key. Useful for
 * exercising the minLength gate without writing ~80 chars by hand for
 * every test.
 */
function compactJsonObject(width: number): string {
  // Repeat `"k0":1,"k1":1,...` until we comfortably exceed `width`.
  const parts: string[] = []
  let i = 0
  let len = 2 // braces
  while (len < width + 20) {
    const segment = `"k${i}":${i}`
    parts.push(segment)
    len += segment.length + (parts.length > 1 ? 1 : 0)
    i++
  }
  return `{${parts.join(',')}}`
}

describe('createJsonFormatHandler — direct invocation', () => {
  it('reformats a compact JSON object that crosses minLength', async () => {
    const handler = createJsonFormatHandler({ minLength: 20 })
    const compact = compactJsonObject(40)
    expect(compact.length).toBeGreaterThan(20)
    const ret = await call(handler, makeAfterCtx({ output: compact, isError: false }))
    const replace = ret.data?.replaceResult as ToolResult | undefined
    expect(replace).toBeDefined()
    expect(replace!.isError).toBe(false)
    const out = replace!.output as string
    // Multi-line indented output.
    expect(out).toContain('\n  "k0": 0')
    // Round-trips back to the same parsed value.
    expect(JSON.parse(out)).toEqual(JSON.parse(compact))
  })

  it('reformats a compact JSON array', async () => {
    const handler = createJsonFormatHandler({ minLength: 10 })
    const compact = '[{"a":1,"b":2},{"a":3,"c":"hello world here"},{"a":5,"d":"more text"}]'
    expect(compact.length).toBeGreaterThan(10)
    const ret = await call(handler, makeAfterCtx({ output: compact, isError: false }))
    const replace = ret.data?.replaceResult as ToolResult | undefined
    expect(replace).toBeDefined()
    const out = replace!.output as string
    // Round-trip preserved.
    expect(JSON.parse(out)).toEqual(JSON.parse(compact))
    // Either inline (fits the 80-col budget) or multi-line — but at
    // minimum no longer a "raw single line with no leading bracket+spaces"
    // — `formatJSON` always normalises whitespace.
    expect(out).toMatch(/^\[/)
    expect(out).toMatch(/\]$/)
  })

  it('leaves non-JSON text unchanged (no false-positive detection)', async () => {
    const handler = createJsonFormatHandler({ minLength: 5 })
    // Plain prose — no opening bracket.
    const ret1 = await call(handler, makeAfterCtx({ output: 'hello world this is plain prose'.repeat(3), isError: false }))
    expect(ret1.data).toBeUndefined()
    // Code with curlies inside but not a top-level container.
    const ret2 = await call(
      handler,
      makeAfterCtx({ output: 'function foo() { return 1; } /* nope */ etc.', isError: false }),
    )
    expect(ret2.data).toBeUndefined()
  })

  it('leaves output starting with { but not valid JSON unchanged', async () => {
    const handler = createJsonFormatHandler({ minLength: 5 })
    // Valid JS object literal, invalid JSON (unquoted keys).
    const out = `{ foo: 1, bar: 2, baz: 'three', list: [1, 2, 3, 4, 5, 6] }`
    expect(out.length).toBeGreaterThan(5)
    const ret = await call(handler, makeAfterCtx({ output: out, isError: false }))
    expect(ret.data).toBeUndefined()
  })

  it('leaves already-pretty (multi-line indented) JSON unchanged', async () => {
    const handler = createJsonFormatHandler({ minLength: 5 })
    const pretty = `{\n  "a": 1,\n  "b": [\n    1,\n    2,\n    3\n  ]\n}`
    const ret = await call(handler, makeAfterCtx({ output: pretty, isError: false }))
    expect(ret.data).toBeUndefined()
  })

  it('respects the minLength floor', async () => {
    const handler = createJsonFormatHandler({ minLength: 200 })
    const compact = '{"a":1,"b":2,"c":3}'
    expect(compact.length).toBeLessThan(200)
    const ret = await call(handler, makeAfterCtx({ output: compact, isError: false }))
    expect(ret.data).toBeUndefined()
  })

  it('respects the maxLength ceiling', async () => {
    const handler = createJsonFormatHandler({ minLength: 5, maxLength: 50 })
    const compact = compactJsonObject(200)
    expect(compact.length).toBeGreaterThan(50)
    const ret = await call(handler, makeAfterCtx({ output: compact, isError: false }))
    expect(ret.data).toBeUndefined()
  })

  it('default minLength of 80 leaves short outputs alone', async () => {
    expect(DEFAULT_JSON_FORMAT_MIN_LENGTH).toBe(80)
    const handler = createJsonFormatHandler()
    const compact = '{"a":1,"b":2,"c":3}'
    const ret = await call(handler, makeAfterCtx({ output: compact, isError: false }))
    expect(ret.data).toBeUndefined()
  })

  it('respects toolNames allowlist (match → rewrite)', async () => {
    const handler = createJsonFormatHandler({
      minLength: 10,
      toolNames: ['MyJsonTool', 'OtherJsonTool'],
    })
    const compact = compactJsonObject(40)
    const matchCtx = makeAfterCtx({ output: compact, isError: false }, undefined, 'MyJsonTool')
    const matchRet = await call(handler, matchCtx)
    expect(matchRet.data?.replaceResult).toBeDefined()
  })

  it('respects toolNames allowlist (no match → pass through)', async () => {
    const handler = createJsonFormatHandler({
      minLength: 10,
      toolNames: ['ExclusiveTool'],
    })
    const compact = compactJsonObject(40)
    const otherCtx = makeAfterCtx({ output: compact, isError: false }, undefined, 'SomeOtherTool')
    const otherRet = await call(handler, otherCtx)
    expect(otherRet.data).toBeUndefined()
  })

  it('passes through ContentBlock[] output (non-string)', async () => {
    const handler = createJsonFormatHandler({ minLength: 5 })
    const blocks = [{ type: 'text', text: '{"x":1}' }] as unknown as ToolResult['output']
    const ret = await call(handler, makeAfterCtx({ output: blocks, isError: false }))
    expect(ret.data).toBeUndefined()
  })

  it('passes through isError result unchanged', async () => {
    const handler = createJsonFormatHandler({ minLength: 5 })
    const compact = compactJsonObject(40)
    const ret = await call(handler, makeAfterCtx({ output: compact, isError: true }))
    expect(ret.data).toBeUndefined()
  })

  it('passes through when payload is missing (no result yet)', async () => {
    const handler = createJsonFormatHandler({ minLength: 5 })
    const ret = await handler({ event: 'afterToolCall', toolName: 'X' })
    expect(ret ?? {}).toEqual({})
  })

  it('passes through when payload.result is undefined (tool threw)', async () => {
    const handler = createJsonFormatHandler({ minLength: 5 })
    const ret = await call(handler, makeAfterCtx(undefined, new Error('boom')))
    expect(ret).toEqual({})
  })

  it('handles deeply nested JSON', async () => {
    const handler = createJsonFormatHandler({ minLength: 10 })
    // 8 nesting levels — round-trip must preserve structure.
    const nested = {
      a: { b: { c: { d: { e: { f: { g: { h: { value: 42, list: [1, 2, 3] } } } } } } } },
    }
    const compact = JSON.stringify(nested)
    expect(compact.length).toBeGreaterThan(10)
    const ret = await call(handler, makeAfterCtx({ output: compact, isError: false }))
    const replace = ret.data?.replaceResult as ToolResult
    const out = replace.output as string
    expect(JSON.parse(out)).toEqual(nested)
    // Multi-line at this size.
    expect(out).toContain('\n')
  })

  it('handles JSON strings containing escaped braces / brackets', async () => {
    const handler = createJsonFormatHandler({ minLength: 10 })
    // Strings carrying brace characters — the final char of the trimmed
    // output is still `}` (the outermost object), but the interior holds
    // sentinel braces inside quoted strings.
    const compact = `{"message":"hello { world } [array] {nested}","count":3,"more":"yes [yes] and { yes }"}`
    expect(compact.length).toBeGreaterThan(10)
    const ret = await call(handler, makeAfterCtx({ output: compact, isError: false }))
    const replace = ret.data?.replaceResult as ToolResult
    const out = replace.output as string
    expect(JSON.parse(out)).toEqual(JSON.parse(compact))
  })

  it('preserves leading/trailing whitespace tolerance', async () => {
    const handler = createJsonFormatHandler({ minLength: 5 })
    // Use only spaces/CRs (no `\n\t` / `\n ` prefix) so the
    // already-pretty heuristic (newline followed by indent) doesn't
    // trip — the goal here is to confirm the trimming logic finds the
    // real JSON bounds, NOT to test the already-pretty bypass.
    const compact = `   \r${compactJsonObject(40)}\r   `
    const ret = await call(handler, makeAfterCtx({ output: compact, isError: false }))
    const replace = ret.data?.replaceResult as ToolResult
    expect(replace).toBeDefined()
    // Should round-trip via parse.
    expect(JSON.parse(replace.output as string)).toEqual(JSON.parse(compact.trim()))
  })

  it('does not change isError flag on replacement', async () => {
    const handler = createJsonFormatHandler({ minLength: 5 })
    const compact = compactJsonObject(40)
    const ret = await call(handler, makeAfterCtx({ output: compact, isError: false }))
    const replace = ret.data?.replaceResult as ToolResult
    expect(replace.isError).toBe(false)
  })
})

describe('createJsonFormatHandler — end-to-end via HookRegistry + wrapWithHooks', () => {
  it('substitutes the formatted output before it reaches the caller', async () => {
    const registry = createHookRegistry()
    registry.register('afterToolCall', createJsonFormatHandler({ minLength: 10 }), {
      id: 'json-format-pretty-printer',
    })
    const compact = compactJsonObject(60)
    const tool = makeTool({
      run: async () => ({ output: compact, isError: false }),
    })
    const wrapped = wrapWithHooks(tool, registry)
    const result = await wrapped.run({}, makeCtx())
    expect(typeof result.output).toBe('string')
    const out = result.output as string
    // Round-trip preserved.
    expect(JSON.parse(out)).toEqual(JSON.parse(compact))
    // Multi-line indented (different from the compact input).
    expect(out).toContain('\n')
    expect(result.isError).toBe(false)
  })

  it('leaves non-JSON output untouched end-to-end', async () => {
    const registry = createHookRegistry()
    registry.register('afterToolCall', createJsonFormatHandler({ minLength: 10 }), {
      id: 'json-format-pretty-printer',
    })
    const prose = 'lorem ipsum dolor sit amet '.repeat(10)
    const tool = makeTool({ run: async () => ({ output: prose, isError: false }) })
    const wrapped = wrapWithHooks(tool, registry)
    const result = await wrapped.run({}, makeCtx())
    expect(result.output).toBe(prose)
  })
})
