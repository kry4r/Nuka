// test/core/tools/lazy.test.ts
//
// Phase P2 #12 — Lazy tool proxy + sidecar drift tests.
//
// The bundle-size guard catches the OUTPUT regression. These tests
// catch the BEHAVIOUR regressions:
//
//  1. The proxy is a fully-valid `Tool` — all metadata (name, params,
//     tags, source, permission hint, search hint, aliases, annotations)
//     is visible at boot WITHOUT loading the implementation.
//  2. First call lazy-loads the real tool and delegates correctly.
//  3. Subsequent calls reuse the cached impl (no re-load).
//  4. The proxy composes with `wrapWithHooks` — every metadata field
//     survives wrapping; the wrapper's `run` calls the proxy's `run`,
//     which calls the real tool's `run`.
//  5. Metadata in `lazyMetas.ts` matches the real tool's metadata
//     (drift guard). If a contributor updates the implementation but
//     forgets the lazy table, this test fails with a precise diff.

import { describe, it, expect } from 'vitest'
import { makeLazyTool } from '../../../src/core/tools/lazy'
import { createHookRegistry, wrapWithHooks } from '../../../src/core/hooks'
import type { Tool, ToolResult } from '../../../src/core/tools/types'
import {
  LAZY_TOOL_ENTRIES,
  whitespaceToolMeta,
  lspQueryToolMeta,
} from '../../../src/core/tools/extra/lazyMetas'
import {
  loadToolFromSidecar,
  __resetSidecarCacheForTests,
} from '../../../src/core/tools/extra/loader'

// ---------------------------------------------------------------------------
// 1 + 2 + 3 — proxy mechanics with a synthetic loader.
// ---------------------------------------------------------------------------

describe('makeLazyTool — proxy mechanics', () => {
  it('exposes metadata synchronously without invoking the loader', () => {
    let loaded = 0
    const proxy = makeLazyTool(whitespaceToolMeta, async () => {
      loaded += 1
      // Return an obviously-fake tool — we don't expect this to fire
      // during metadata-only inspection.
      return {
        ...whitespaceToolMeta,
        async run() {
          return { output: 'unreachable', isError: false }
        },
      } as Tool<unknown>
    })

    expect(proxy.name).toBe('Whitespace')
    expect(proxy.source).toBe('builtin')
    expect(proxy.tags).toEqual(['core', 'whitespace', 'text', 'format'])
    expect(proxy.needsPermission!({} as never)).toBe('none')
    expect(proxy.searchHint).toContain('dedent')
    expect(proxy.aliases).toContain('clean_whitespace')
    expect(proxy.annotations?.readOnly).toBe(true)
    expect(loaded).toBe(0)
  })

  it('first call lazy-loads the real implementation', async () => {
    let loaded = 0
    let ran = 0
    const proxy = makeLazyTool(whitespaceToolMeta, async () => {
      loaded += 1
      return {
        ...whitespaceToolMeta,
        async run() {
          ran += 1
          return { output: 'STUB-OK', isError: false }
        },
      } as Tool<unknown>
    })

    const r = await proxy.run({} as never, {
      signal: new AbortController().signal,
      cwd: process.cwd(),
    })
    expect(loaded).toBe(1)
    expect(ran).toBe(1)
    expect(r.output).toBe('STUB-OK')
  })

  it('subsequent calls reuse the cached impl (single load)', async () => {
    let loaded = 0
    let ran = 0
    const proxy = makeLazyTool(whitespaceToolMeta, async () => {
      loaded += 1
      return {
        ...whitespaceToolMeta,
        async run() {
          ran += 1
          return { output: `call-${ran}`, isError: false }
        },
      } as Tool<unknown>
    })

    const ctx = { signal: new AbortController().signal, cwd: process.cwd() }
    const r1 = await proxy.run({} as never, ctx)
    const r2 = await proxy.run({} as never, ctx)
    const r3 = await proxy.run({} as never, ctx)
    expect(loaded).toBe(1)
    expect(ran).toBe(3)
    expect(r1.output).toBe('call-1')
    expect(r2.output).toBe('call-2')
    expect(r3.output).toBe('call-3')
  })

  it('concurrent first calls share a single load promise', async () => {
    let loaded = 0
    const proxy = makeLazyTool(whitespaceToolMeta, async () => {
      loaded += 1
      // Simulate a slow sidecar load — both callers should arrive at
      // `loaded === 1` and the second await must NOT trigger a second
      // dynamic import.
      await new Promise(r => setTimeout(r, 10))
      return {
        ...whitespaceToolMeta,
        async run() {
          return { output: 'ok', isError: false }
        },
      } as Tool<unknown>
    })

    const ctx = { signal: new AbortController().signal, cwd: process.cwd() }
    await Promise.all([proxy.run({} as never, ctx), proxy.run({} as never, ctx)])
    expect(loaded).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 4 — composes with wrapWithHooks.
// ---------------------------------------------------------------------------

describe('makeLazyTool — wraps cleanly with hooks', () => {
  it('hook events fire around the lazy load + delegated run', async () => {
    const before: string[] = []
    const after: Array<{ result?: ToolResult; error?: unknown }> = []
    const hooks = createHookRegistry()
    hooks.register('beforeToolCall', async (ctx) => {
      before.push(ctx.toolName ?? '')
      return {}
    })
    hooks.register('afterToolCall', async (ctx) => {
      after.push({
        result: ctx.payload?.result as ToolResult | undefined,
        error: ctx.payload?.error,
      })
      return {}
    })

    const proxy = makeLazyTool(whitespaceToolMeta, async () => ({
      ...whitespaceToolMeta,
      async run() {
        return { output: 'wrapped-ok', isError: false }
      },
    } as Tool<unknown>))
    const wrapped = wrapWithHooks(proxy, hooks)

    expect(wrapped.name).toBe('Whitespace')
    expect(wrapped.searchHint).toEqual(proxy.searchHint)

    const r = await wrapped.run({} as never, {
      signal: new AbortController().signal,
      cwd: process.cwd(),
    })
    expect(r.output).toBe('wrapped-ok')
    expect(before).toEqual(['Whitespace'])
    expect(after).toHaveLength(1)
    expect((after[0].result as ToolResult).output).toBe('wrapped-ok')
  })
})

// ---------------------------------------------------------------------------
// 5 — drift: every entry in LAZY_TOOL_ENTRIES matches the real tool.
//
// Loads the sidecar entry module (which pulls in every real Tool) and
// compares the metadata side-by-side. Each field that affects the
// agent / registry / search surface must match exactly.
// ---------------------------------------------------------------------------

describe('lazyMetas — drift guard against real Tool implementations', () => {
  it('each LAZY_TOOL_ENTRIES.meta matches its sidecar tool', async () => {
    // Cold-load the sidecar source module so the import below is the
    // SAME edge esbuild follows when packing `dist/tools-extra.js`.
    __resetSidecarCacheForTests()
    const sidecar = await import('../../../src/core/tools/extra/entry')

    const compareKeys = [
      'name',
      'description',
      'parameters',
      'source',
      'tags',
      'annotations',
      'searchHint',
      'aliases',
    ] as const

    // Tools whose `needsPermission` reads `input.<field>` without
    // optional-chaining are skipped from the no-input comparison
    // (covered by the input-dependent test below with realistic
    // payloads).
    const inputDependent = new Set(['ApplyDiffTool', 'FindReplaceTool'])

    for (const entry of LAZY_TOOL_ENTRIES) {
      const real = sidecar[entry.exportName] as Tool<unknown>
      expect(
        real,
        `missing sidecar export for ${entry.exportName}`,
      ).toBeDefined()

      for (const key of compareKeys) {
        expect(
          (entry.meta as unknown as Record<string, unknown>)[key],
          `${entry.exportName}.${key} drift`,
        ).toEqual((real as unknown as Record<string, unknown>)[key])
      }

      if (!inputDependent.has(entry.exportName)) {
        // Sample the no-input case — text-utility tools all return
        // 'none' regardless of input shape.
        expect(
          entry.meta.needsPermission(undefined as never),
          `${entry.exportName}.needsPermission(undefined) drift`,
        ).toEqual((real.needsPermission as (i: unknown) => string)(undefined))
      }
    }
  })

  it('ApplyDiff / FindReplace lazy permission predicates match impl', async () => {
    const sidecar = await import('../../../src/core/tools/extra/entry')
    const cases: Array<{ name: 'ApplyDiffTool' | 'FindReplaceTool'; inputs: unknown[] }> = [
      { name: 'ApplyDiffTool', inputs: [{ dryRun: true }, { dryRun: false }, {}] },
      { name: 'FindReplaceTool', inputs: [{ dryRun: true }, { dryRun: false }, {}] },
    ]
    for (const c of cases) {
      const real = sidecar[c.name] as Tool<unknown>
      const meta = LAZY_TOOL_ENTRIES.find(e => e.exportName === c.name)!.meta
      for (const input of c.inputs) {
        const a = meta.needsPermission(input as never)
        const b = (real.needsPermission as (i: unknown) => string)(input)
        expect(a, `${c.name}(${JSON.stringify(input)}) drift`).toBe(b)
      }
    }
  })

  it('LSPQuery meta matches the factory-built real tool', async () => {
    const sidecar = await import('../../../src/core/tools/extra/entry')
    // The factory needs an LspManager. We don't run the tool — only
    // check its metadata — so any callable shape suffices.
    const fakeManager = {} as unknown as Parameters<typeof sidecar.makeLspQueryTool>[0]
    const real = sidecar.makeLspQueryTool(fakeManager)
    for (const key of [
      'name',
      'description',
      'parameters',
      'source',
      'tags',
      'annotations',
      'searchHint',
      'aliases',
    ] as const) {
      expect(
        (lspQueryToolMeta as unknown as Record<string, unknown>)[key],
        `LSPQuery.${key} drift`,
      ).toEqual((real as unknown as Record<string, unknown>)[key])
    }
    expect(lspQueryToolMeta.needsPermission(undefined as never)).toBe(
      (real.needsPermission as (i: unknown) => string)(undefined),
    )
  })
})

// ---------------------------------------------------------------------------
// First-call ergonomics — the cli.tsx wiring path. Round-trip a real
// sidecar load through `loadToolFromSidecar` (the same call cli.tsx
// makes inside makeLazyTool) and assert the returned tool behaves.
// ---------------------------------------------------------------------------

describe('sidecar loader — first-call ergonomics', () => {
  it('resolves a real tool from the in-tree fallback path', async () => {
    __resetSidecarCacheForTests()
    const real = await loadToolFromSidecar('WhitespaceTool')
    expect(real.name).toBe('Whitespace')
    expect(real.needsPermission!({} as never)).toBe('none')
    // Run the actual implementation to confirm we got the function, not
    // a stub. `dedent` on a tab-prefixed line yields the trimmed text.
    const r = await real.run(
      { action: 'dedent', text: '  hello\n  world' } as never,
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
      },
    )
    expect(r.isError).toBe(false)
    expect(typeof r.output).toBe('string')
  })
})
