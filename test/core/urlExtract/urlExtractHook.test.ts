// test/core/urlExtract/urlExtractHook.test.ts
//
// Tests for `createUrlExtractHandler` — the opt-in afterToolCall hook
// that scans STRING tool output for URLs and adds them as a sibling
// `urls: string[]` field on the surfaced ToolResult.
//
// Coverage spans:
//   1. Direct handler invocation — pass a fake `HookContext` and assert
//      what the handler returns. Independent of the registry / wrapper.
//   2. End-to-end via the real `HookRegistry` + `wrapWithHooks` —
//      confirms that the `data.replaceResult` contract is honoured and
//      the sibling `urls` field reaches the caller intact even though
//      it isn't part of the `ToolResult` type.

import { describe, it, expect } from 'vitest'
import {
  createUrlExtractHandler,
  DEFAULT_URL_EXTRACT_HOOK_MAX_URLS,
  DEFAULT_URL_EXTRACT_HOOK_MIN_LENGTH,
} from '../../../src/core/urlExtract/urlExtractHook'
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
  handler: ReturnType<typeof createUrlExtractHandler>,
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

/** Pad an arbitrary URL-bearing snippet so it clears the minLength gate. */
function padForMinLength(snippet: string, target = 80): string {
  if (snippet.length >= target) return snippet
  return snippet + ' '.repeat(target - snippet.length)
}

describe('createUrlExtractHandler — direct invocation', () => {
  it('extracts http and https URLs from string output', async () => {
    const handler = createUrlExtractHandler()
    const text = padForMinLength(
      'Visit https://example.com or http://b.org for more details',
    )
    const ret = await call(handler, makeAfterCtx({ output: text, isError: false }))
    const replace = ret.data?.replaceResult as
      | { output: string; isError: boolean; urls: string[] }
      | undefined
    expect(replace).toBeDefined()
    expect(replace!.urls).toContain('https://example.com')
    expect(replace!.urls).toContain('http://b.org')
  })

  it('preserves the original output byte-for-byte', async () => {
    const handler = createUrlExtractHandler()
    const text = padForMinLength('Try https://example.com today!')
    const ret = await call(handler, makeAfterCtx({ output: text, isError: false }))
    const replace = ret.data?.replaceResult as
      | { output: string; isError: boolean }
      | undefined
    expect(replace).toBeDefined()
    expect(replace!.output).toBe(text)
  })

  it('dedupes URLs that appear multiple times', async () => {
    const handler = createUrlExtractHandler()
    const text = padForMinLength(
      'See https://x.com and https://x.com and https://x.com again',
    )
    const ret = await call(handler, makeAfterCtx({ output: text, isError: false }))
    const replace = ret.data?.replaceResult as
      | { urls: string[] }
      | undefined
    expect(replace!.urls).toEqual(['https://x.com'])
  })

  it('respects maxUrls cap and records truncation metadata', async () => {
    const handler = createUrlExtractHandler({ maxUrls: 2 })
    const text = padForMinLength(
      'See https://a.com https://b.com https://c.com https://d.com',
    )
    const ret = await call(handler, makeAfterCtx({ output: text, isError: false }))
    const replace = ret.data?.replaceResult as
      | { urls: string[] }
      | undefined
    expect(replace!.urls.length).toBe(2)
    // Preserves first-seen order.
    expect(replace!.urls[0]).toBe('https://a.com')
    expect(replace!.urls[1]).toBe('https://b.com')
    const meta = ret.data?.urlExtract as
      | { totalFound: number; recorded: number; maxUrls: number; truncated: boolean }
      | undefined
    expect(meta).toBeDefined()
    expect(meta!.totalFound).toBe(4)
    expect(meta!.recorded).toBe(2)
    expect(meta!.maxUrls).toBe(2)
    expect(meta!.truncated).toBe(true)
  })

  it('returns {} when no URLs are found', async () => {
    const handler = createUrlExtractHandler()
    const text = padForMinLength('No links here, just prose about v1.2.3')
    const ret = await call(handler, makeAfterCtx({ output: text, isError: false }))
    expect(ret).toEqual({})
  })

  it('returns {} when output is shorter than minLength', async () => {
    const handler = createUrlExtractHandler({ minLength: 200 })
    // Below the 200-char gate — even with URLs, the hook should skip.
    const text = 'Short text with https://example.com'
    expect(text.length).toBeLessThan(200)
    const ret = await call(handler, makeAfterCtx({ output: text, isError: false }))
    expect(ret).toEqual({})
  })

  it('passes through ContentBlock[] output (non-string)', async () => {
    const handler = createUrlExtractHandler()
    const blocks = [
      { type: 'text', text: padForMinLength('See https://example.com here') },
    ] as unknown as ToolResult['output']
    const ret = await call(handler, makeAfterCtx({ output: blocks, isError: false }))
    expect(ret).toEqual({})
  })

  it('skips error results by default', async () => {
    const handler = createUrlExtractHandler()
    const text = padForMinLength('Server failed at https://example.com unfortunately')
    const ret = await call(handler, makeAfterCtx({ output: text, isError: true }))
    expect(ret).toEqual({})
  })

  it('with includeErrors=true, scans error results too', async () => {
    const handler = createUrlExtractHandler({ includeErrors: true })
    const text = padForMinLength('Server failed at https://example.com unfortunately')
    const ret = await call(handler, makeAfterCtx({ output: text, isError: true }))
    const replace = ret.data?.replaceResult as
      | { isError: boolean; urls: string[] }
      | undefined
    expect(replace).toBeDefined()
    expect(replace!.isError).toBe(true) // preserved
    expect(replace!.urls).toContain('https://example.com')
  })

  it('respects toolNames allowlist (match → annotate)', async () => {
    const handler = createUrlExtractHandler({ toolNames: ['Bash', 'Read'] })
    const text = padForMinLength('See https://example.com for context')
    const ctx = makeAfterCtx({ output: text, isError: false }, undefined, 'Bash')
    const ret = await call(handler, ctx)
    expect(ret.data?.replaceResult).toBeDefined()
  })

  it('respects toolNames allowlist (no match → pass through)', async () => {
    const handler = createUrlExtractHandler({ toolNames: ['Bash'] })
    const text = padForMinLength('See https://example.com for context')
    const ctx = makeAfterCtx({ output: text, isError: false }, undefined, 'OtherTool')
    const ret = await call(handler, ctx)
    expect(ret).toEqual({})
  })

  it('passes through when payload is missing', async () => {
    const handler = createUrlExtractHandler()
    const ret = await handler({ event: 'afterToolCall', toolName: 'X' })
    expect(ret ?? {}).toEqual({})
  })

  it('passes through when payload.result is undefined (tool threw)', async () => {
    const handler = createUrlExtractHandler()
    const ret = await call(handler, makeAfterCtx(undefined, new Error('boom')))
    expect(ret).toEqual({})
  })

  it('default maxUrls is 50 and default minLength is 50', () => {
    expect(DEFAULT_URL_EXTRACT_HOOK_MAX_URLS).toBe(50)
    expect(DEFAULT_URL_EXTRACT_HOOK_MIN_LENGTH).toBe(50)
  })

  it('throws at construction time for non-positive maxUrls', () => {
    expect(() => createUrlExtractHandler({ maxUrls: 0 })).toThrow(RangeError)
    expect(() => createUrlExtractHandler({ maxUrls: -1 })).toThrow(RangeError)
  })

  it('throws at construction time for negative minLength', () => {
    expect(() => createUrlExtractHandler({ minLength: -1 })).toThrow(RangeError)
  })

  it('preserves isError flag on the annotated replacement', async () => {
    const handler = createUrlExtractHandler({ includeErrors: true })
    const text = padForMinLength('Error: see https://docs.example.com for help')
    const ret = await call(handler, makeAfterCtx({ output: text, isError: true }))
    const replace = ret.data?.replaceResult as
      | { isError: boolean }
      | undefined
    expect(replace!.isError).toBe(true)
  })
})

describe('createUrlExtractHandler — end-to-end via HookRegistry + wrapWithHooks', () => {
  it('substitutes the annotated result before it reaches the caller', async () => {
    const registry = createHookRegistry()
    registry.register('afterToolCall', createUrlExtractHandler(), {
      id: 'url-extract-annotator',
    })
    const text = padForMinLength(
      'Try https://example.com or https://other.org for details',
    )
    const tool = makeTool({
      run: async () => ({ output: text, isError: false }),
    })
    const wrapped = wrapWithHooks(tool, registry)
    const result = await wrapped.run({}, makeCtx())
    expect(result.output).toBe(text)
    expect(result.isError).toBe(false)
    // The sibling `urls` field rides along at runtime even though it's
    // not part of the ToolResult type. Read defensively via a record cast.
    const urls = (result as unknown as Record<string, unknown>).urls
    expect(Array.isArray(urls)).toBe(true)
    expect(urls).toContain('https://example.com')
    expect(urls).toContain('https://other.org')
  })

  it('leaves output untouched end-to-end when no URLs are present', async () => {
    const registry = createHookRegistry()
    registry.register('afterToolCall', createUrlExtractHandler(), {
      id: 'url-extract-annotator',
    })
    const text = padForMinLength('Just prose, no links whatsoever in here')
    const tool = makeTool({ run: async () => ({ output: text, isError: false }) })
    const wrapped = wrapWithHooks(tool, registry)
    const result = await wrapped.run({}, makeCtx())
    expect(result.output).toBe(text)
    expect(result.isError).toBe(false)
    const urls = (result as unknown as Record<string, unknown>).urls
    expect(urls).toBeUndefined()
  })

  it('end-to-end respects toolNames allowlist', async () => {
    const registry = createHookRegistry()
    registry.register(
      'afterToolCall',
      createUrlExtractHandler({ toolNames: ['AllowedTool'] }),
      { id: 'url-extract-annotator' },
    )
    const text = padForMinLength('See https://example.com here for the docs')
    const allowed = makeTool({
      name: 'AllowedTool',
      run: async () => ({ output: text, isError: false }),
    })
    const blocked = makeTool({
      name: 'BlockedTool',
      run: async () => ({ output: text, isError: false }),
    })
    const wrappedAllowed = wrapWithHooks(allowed, registry)
    const wrappedBlocked = wrapWithHooks(blocked, registry)
    const r1 = await wrappedAllowed.run({}, makeCtx())
    const r2 = await wrappedBlocked.run({}, makeCtx())
    const urls1 = (r1 as unknown as Record<string, unknown>).urls
    const urls2 = (r2 as unknown as Record<string, unknown>).urls
    expect(Array.isArray(urls1)).toBe(true)
    expect(urls2).toBeUndefined()
  })
})
