// test/core/wordWrap/wordWrapHook.test.ts
//
// Tests for `createWordWrapHandler` — the opt-in afterToolCall hook that
// re-flows long single-line tool output to fit a column budget.
//
// Coverage spans:
//   1. Direct handler invocation — pass a fake `HookContext` and assert
//      what the handler returns. Independent of the registry / wrapper.
//   2. End-to-end via the real `HookRegistry` + `wrapWithHooks` — confirms
//      that the `data.replaceResult` contract is honoured and the wrapped
//      text reaches the caller.

import { describe, it, expect } from 'vitest'
import {
  createWordWrapHandler,
  DEFAULT_WORD_WRAP_HOOK_WIDTH,
  DEFAULT_WORD_WRAP_HOOK_MIN_LENGTH,
} from '../../../src/core/wordWrap/wordWrapHook'
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
  handler: ReturnType<typeof createWordWrapHandler>,
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
 * Build a single-line string of approximately `chars` characters by
 * repeating a 12-char "word group" (`"the quick "`). The result is
 * deterministic so the wrap pass produces predictable line counts in
 * the assertions.
 */
function longSingleLine(chars: number): string {
  const word = 'the quick brown fox jumps over the lazy dog '
  let s = ''
  while (s.length < chars) s += word
  return s.slice(0, chars).trimEnd()
}

describe('createWordWrapHandler — direct invocation', () => {
  it('wraps a long single-line string to the configured width', async () => {
    const handler = createWordWrapHandler({ width: 40, minLength: 50 })
    const long = longSingleLine(300)
    expect(long.length).toBeGreaterThan(50)
    const ret = await call(handler, makeAfterCtx({ output: long, isError: false }))
    const replace = ret.data?.replaceResult as ToolResult | undefined
    expect(replace).toBeDefined()
    expect(replace!.isError).toBe(false)
    const out = replace!.output as string
    // Multi-line output, every line within budget.
    const lines = out.split('\n')
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(40)
    }
  })

  it('leaves short text unchanged (under minLength)', async () => {
    const handler = createWordWrapHandler({ width: 40, minLength: 200 })
    const short = longSingleLine(100)
    expect(short.length).toBeLessThan(200)
    const ret = await call(handler, makeAfterCtx({ output: short, isError: false }))
    expect(ret.data).toBeUndefined()
  })

  it('leaves already-wrapped text unchanged (every line within budget)', async () => {
    const handler = createWordWrapHandler({ width: 40, minLength: 50 })
    // 6 short lines, each well within 40 chars. Total > minLength.
    const wrapped = ['line one is here', 'line two is here', 'line three is here', 'line four is here', 'line five is here', 'line six is here'].join('\n')
    expect(wrapped.length).toBeGreaterThan(50)
    const ret = await call(handler, makeAfterCtx({ output: wrapped, isError: false }))
    expect(ret.data).toBeUndefined()
  })

  it('skipIfAlreadyWrapped: false forces re-wrap of within-budget text', async () => {
    // Wrap at 80, but every input line is already ≤ 30. With default
    // (skip=true), the hook would no-op. Setting skip=false makes the
    // wrap pass run anyway. The resulting `wrapText` output should be
    // observably different — `wrapText` normalises whitespace.
    const handler = createWordWrapHandler({
      width: 80,
      minLength: 10,
      skipIfAlreadyWrapped: false,
    })
    // Each source line ≤ 30 chars (already fits), but contains
    // double-spaces that `wrapText` will collapse.
    const input = ['line  one  is  here', 'line  two  is  here', 'line  three  is  here'].join('\n')
    const ret = await call(handler, makeAfterCtx({ output: input, isError: false }))
    const replace = ret.data?.replaceResult as ToolResult | undefined
    expect(replace).toBeDefined()
    expect(replace!.output).not.toBe(input)
  })

  it('respects toolNames allowlist (match → rewrite)', async () => {
    const handler = createWordWrapHandler({
      width: 40,
      minLength: 50,
      toolNames: ['Bash', 'Read'],
    })
    const long = longSingleLine(300)
    const matchCtx = makeAfterCtx({ output: long, isError: false }, undefined, 'Bash')
    const matchRet = await call(handler, matchCtx)
    expect(matchRet.data?.replaceResult).toBeDefined()
  })

  it('respects toolNames allowlist (no match → pass through)', async () => {
    const handler = createWordWrapHandler({
      width: 40,
      minLength: 50,
      toolNames: ['ExclusiveTool'],
    })
    const long = longSingleLine(300)
    const otherCtx = makeAfterCtx({ output: long, isError: false }, undefined, 'SomeOtherTool')
    const otherRet = await call(handler, otherCtx)
    expect(otherRet.data).toBeUndefined()
  })

  it('returns {} (no churn) when output produces no observable change', async () => {
    // Input already wraps at exactly the budget on every line. With
    // skipIfAlreadyWrapped true (default), we hit the cheap path. With
    // false, the wrap-output comparison guard still fires when
    // `wrapText` is a no-op. Use a single-paragraph string just under
    // the budget so the wrap is identity.
    const handler = createWordWrapHandler({
      width: 80,
      minLength: 10,
      skipIfAlreadyWrapped: false,
    })
    // 60 chars, no double-spaces, no newlines — `wrapText` returns it
    // verbatim because the single line fits the 80-cell budget.
    const fits = 'the quick brown fox jumps over the lazy dog and a chicken'
    expect(fits.length).toBeLessThanOrEqual(80)
    expect(fits.length).toBeGreaterThanOrEqual(10)
    const ret = await call(handler, makeAfterCtx({ output: fits, isError: false }))
    expect(ret.data).toBeUndefined()
  })

  it('passes through ContentBlock[] output (non-string)', async () => {
    const handler = createWordWrapHandler({ width: 40, minLength: 10 })
    const blocks = [{ type: 'text', text: longSingleLine(300) }] as unknown as ToolResult['output']
    const ret = await call(handler, makeAfterCtx({ output: blocks, isError: false }))
    expect(ret.data).toBeUndefined()
  })

  it('passes through isError result unchanged', async () => {
    const handler = createWordWrapHandler({ width: 40, minLength: 50 })
    const long = longSingleLine(300)
    const ret = await call(handler, makeAfterCtx({ output: long, isError: true }))
    expect(ret.data).toBeUndefined()
  })

  it('passes through when payload is missing', async () => {
    const handler = createWordWrapHandler({ width: 40, minLength: 10 })
    const ret = await handler({ event: 'afterToolCall', toolName: 'X' })
    expect(ret ?? {}).toEqual({})
  })

  it('passes through when payload.result is undefined (tool threw)', async () => {
    const handler = createWordWrapHandler({ width: 40, minLength: 10 })
    const ret = await call(handler, makeAfterCtx(undefined, new Error('boom')))
    expect(ret).toEqual({})
  })

  it('respects custom width', async () => {
    const handler = createWordWrapHandler({ width: 20, minLength: 50 })
    const long = longSingleLine(300)
    const ret = await call(handler, makeAfterCtx({ output: long, isError: false }))
    const replace = ret.data?.replaceResult as ToolResult | undefined
    expect(replace).toBeDefined()
    const out = replace!.output as string
    for (const line of out.split('\n')) {
      // wrapText guarantees ≤ width unless a single word exceeds it. Our
      // test input has 5-letter max words, so 20 is comfortably safe.
      expect(line.length).toBeLessThanOrEqual(20)
    }
  })

  it('default width is 100 and default minLength is 200', async () => {
    expect(DEFAULT_WORD_WRAP_HOOK_WIDTH).toBe(100)
    expect(DEFAULT_WORD_WRAP_HOOK_MIN_LENGTH).toBe(200)
    const handler = createWordWrapHandler()
    // Just under default minLength → pass through.
    const justUnder = longSingleLine(199)
    const ret = await call(handler, makeAfterCtx({ output: justUnder, isError: false }))
    expect(ret.data).toBeUndefined()
    // Just over default minLength + over default width → wrapped.
    const justOver = longSingleLine(500)
    const ret2 = await call(handler, makeAfterCtx({ output: justOver, isError: false }))
    const replace = ret2.data?.replaceResult as ToolResult | undefined
    expect(replace).toBeDefined()
    const out = replace!.output as string
    for (const line of out.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(100)
    }
  })

  it('wraps each paragraph independently in multi-paragraph text', async () => {
    const handler = createWordWrapHandler({ width: 30, minLength: 50 })
    // Two long single-line paragraphs separated by a blank line.
    const para1 = longSingleLine(120)
    const para2 = longSingleLine(140)
    const input = `${para1}\n\n${para2}`
    const ret = await call(handler, makeAfterCtx({ output: input, isError: false }))
    const replace = ret.data?.replaceResult as ToolResult | undefined
    expect(replace).toBeDefined()
    const out = replace!.output as string
    // The blank-line paragraph boundary survives.
    expect(out).toMatch(/\n\n/)
    // Every line fits the budget.
    for (const line of out.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(30)
    }
  })

  it('records original / wrapped length and width in the data payload', async () => {
    const handler = createWordWrapHandler({ width: 40, minLength: 50 })
    const long = longSingleLine(300)
    const ret = await call(handler, makeAfterCtx({ output: long, isError: false }))
    const meta = ret.data?.wordWrap as
      | { originalLength: number; wrappedLength: number; width: number }
      | undefined
    expect(meta).toBeDefined()
    expect(meta!.originalLength).toBe(long.length)
    expect(meta!.width).toBe(40)
    // `wrapText` normalises whitespace + adds newlines — the wrapped
    // length can land slightly above OR below the original. We only
    // assert it's a positive number, since the precise value depends on
    // word boundaries that landed against the budget.
    expect(meta!.wrappedLength).toBeGreaterThan(0)
    const replace = ret.data?.replaceResult as ToolResult
    expect((replace.output as string).length).toBe(meta!.wrappedLength)
  })

  it('preserves isError flag on replacement', async () => {
    const handler = createWordWrapHandler({ width: 40, minLength: 50 })
    const long = longSingleLine(300)
    const ret = await call(handler, makeAfterCtx({ output: long, isError: false }))
    const replace = ret.data?.replaceResult as ToolResult
    expect(replace.isError).toBe(false)
  })

  it('throws at construction time for non-positive width', () => {
    expect(() => createWordWrapHandler({ width: 0 })).toThrow(RangeError)
    expect(() => createWordWrapHandler({ width: -5 })).toThrow(RangeError)
  })

  it('throws at construction time for negative minLength', () => {
    expect(() => createWordWrapHandler({ minLength: -1 })).toThrow(RangeError)
  })
})

describe('createWordWrapHandler — end-to-end via HookRegistry + wrapWithHooks', () => {
  it('substitutes the wrapped output before it reaches the caller', async () => {
    const registry = createHookRegistry()
    registry.register('afterToolCall', createWordWrapHandler({ width: 40, minLength: 50 }), {
      id: 'word-wrap-rewriter',
    })
    const long = longSingleLine(300)
    const tool = makeTool({
      run: async () => ({ output: long, isError: false }),
    })
    const wrapped = wrapWithHooks(tool, registry)
    const result = await wrapped.run({}, makeCtx())
    expect(typeof result.output).toBe('string')
    const out = result.output as string
    // Multi-line, every line within budget.
    expect(out).toContain('\n')
    for (const line of out.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(40)
    }
    expect(result.isError).toBe(false)
  })

  it('leaves short output untouched end-to-end', async () => {
    const registry = createHookRegistry()
    registry.register('afterToolCall', createWordWrapHandler({ width: 40, minLength: 500 }), {
      id: 'word-wrap-rewriter',
    })
    const short = longSingleLine(100)
    const tool = makeTool({ run: async () => ({ output: short, isError: false }) })
    const wrapped = wrapWithHooks(tool, registry)
    const result = await wrapped.run({}, makeCtx())
    expect(result.output).toBe(short)
  })
})
