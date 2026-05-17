// test/core/lsp/lspQueryTool.test.ts
//
// Tests for the unified LSPQuery tool. Covers each action's success
// path, the notConfigured branch, the error-path for request
// failures, input-validation errors, and the hover/documentSymbol
// normalisation logic for the variant response shapes from the LSP
// spec.

import { describe, it, expect, vi } from 'vitest'
import { pathToFileURL } from 'node:url'
import { makeLspQueryTool, LSP_QUERY_TOOL_NAME } from '../../../src/core/lsp/lspQueryTool'
import type { LspQueryToolInput, LspQueryToolResult, LspQueryNotConfigured } from '../../../src/core/lsp/lspQueryTool'
import type { LspManager } from '../../../src/core/lsp/manager'
import type { LspClient } from '../../../src/core/lsp/client'
import type { DocumentTracker } from '../../../src/core/lsp/documentTracker'
import type { LspLocation } from '../../../src/core/lsp/types'

const ctx = {
  signal: new AbortController().signal,
  cwd: '/tmp',
} as unknown as Parameters<ReturnType<typeof makeLspQueryTool>['run']>[1]

function makeMockManager(opts: {
  client?: Partial<LspClient> | null
  tracker?: Partial<DocumentTracker>
}): LspManager {
  const tracker: DocumentTracker = {
    isOpen: vi.fn(() => true),
    versionOf: vi.fn(() => 1),
    ensureOpen: vi.fn().mockResolvedValue(undefined),
    applyChange: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as DocumentTracker

  if (opts.tracker) {
    Object.assign(tracker, opts.tracker)
  }

  const client =
    opts.client === null
      ? null
      : ({
          status: 'ready',
          diagnosticsFor: vi.fn(() => []),
          onDiagnostics: vi.fn(() => () => {}),
          request: vi.fn().mockResolvedValue(null),
          notify: vi.fn(),
          ...opts.client,
        } as unknown as LspClient)

  return {
    clientFor: vi.fn().mockResolvedValue(client),
    trackerFor: vi.fn(() => tracker),
    list: vi.fn(() => []),
    register: vi.fn(),
    closeAll: vi.fn(),
    notifyFileChanged: vi.fn(),
  } as unknown as LspManager
}

function parseOk<T extends LspQueryToolResult | LspQueryNotConfigured>(out: string): T {
  return JSON.parse(out) as T
}

describe('makeLspQueryTool — surface', () => {
  it('exposes the expected name + always-registered schema', () => {
    const tool = makeLspQueryTool(makeMockManager({ client: null }))
    expect(tool.name).toBe(LSP_QUERY_TOOL_NAME)
    expect(tool.name).toBe('LSPQuery')
    expect(tool.annotations?.readOnly).toBe(true)
    expect(tool.annotations?.parallelSafe).toBe(true)
    expect(tool.needsPermission({ action: 'hover', filePath: '/tmp/a.ts', line: 0, character: 0 })).toBe('none')
    const params = tool.parameters as { properties: Record<string, { enum?: string[] }>; required: string[] }
    expect(params.required).toContain('action')
    // filePath is enforced inside run() per-action so workspaceSymbol can omit it.
    expect(params.required).not.toContain('filePath')
    expect(params.properties.action.enum).toEqual([
      'definition',
      'references',
      'hover',
      'documentSymbols',
      'workspaceSymbol',
      'implementation',
      'callHierarchy',
    ])
  })
})

describe('makeLspQueryTool — input validation', () => {
  it('rejects an unknown action', async () => {
    const tool = makeLspQueryTool(makeMockManager({ client: null }))
    const result = await tool.run(
      { action: 'unknown' as unknown as LspQueryToolInput['action'], filePath: '/tmp/a.ts' },
      ctx,
    )
    expect(result.isError).toBe(true)
    expect(result.output).toContain("unknown action 'unknown'")
  })

  it('rejects a missing filePath', async () => {
    const tool = makeLspQueryTool(makeMockManager({ client: null }))
    const result = await tool.run(
      { action: 'definition', filePath: '', line: 0, character: 0 } as LspQueryToolInput,
      ctx,
    )
    expect(result.isError).toBe(true)
    expect(result.output).toContain("'filePath' must be a non-empty string")
  })

  it('rejects definition without line/character', async () => {
    const tool = makeLspQueryTool(makeMockManager({ client: null }))
    const result = await tool.run(
      { action: 'definition', filePath: '/tmp/a.ts' } as LspQueryToolInput,
      ctx,
    )
    expect(result.isError).toBe(true)
    expect(result.output).toContain("'line' is required")
  })

  it('rejects negative line for hover', async () => {
    const tool = makeLspQueryTool(makeMockManager({ client: null }))
    const result = await tool.run(
      { action: 'hover', filePath: '/tmp/a.ts', line: -1, character: 0 },
      ctx,
    )
    expect(result.isError).toBe(true)
    expect(result.output).toContain("'line' must be non-negative")
  })

  it('rejects non-integer character for references', async () => {
    const tool = makeLspQueryTool(makeMockManager({ client: null }))
    const result = await tool.run(
      { action: 'references', filePath: '/tmp/a.ts', line: 0, character: 1.5 },
      ctx,
    )
    expect(result.isError).toBe(true)
    expect(result.output).toContain("'character' must be an integer")
  })

  it('does NOT require line/character for documentSymbols', async () => {
    const symbolPayload = [
      {
        name: 'foo',
        kind: 12,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
        selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
      },
    ]
    const manager = makeMockManager({
      client: { request: vi.fn().mockResolvedValue(symbolPayload) },
    })
    const tool = makeLspQueryTool(manager)
    const result = await tool.run({ action: 'documentSymbols', filePath: '/tmp/a.ts' }, ctx)
    expect(result.isError).toBe(false)
    const parsed = parseOk<LspQueryToolResult & { action: 'documentSymbols' }>(result.output as string)
    expect(parsed.symbols).toHaveLength(1)
    expect(parsed.symbols[0].name).toBe('foo')
  })
})

describe('makeLspQueryTool — notConfigured branch', () => {
  it('returns notConfigured payload (isError:false) when no server matches', async () => {
    const manager = makeMockManager({ client: null })
    const tool = makeLspQueryTool(manager)
    const result = await tool.run(
      { action: 'hover', filePath: '/tmp/anything.unknown', line: 1, character: 2 },
      ctx,
    )
    expect(result.isError).toBe(false)
    const parsed = parseOk<LspQueryNotConfigured>(result.output as string)
    expect(parsed.notConfigured).toBe(true)
    expect(parsed.action).toBe('hover')
    expect(parsed.filePath).toBe('/tmp/anything.unknown')
  })
})

describe('makeLspQueryTool — definition action', () => {
  it('returns location array (single-location LSP shape)', async () => {
    const loc: LspLocation = {
      uri: 'file:///src/types.ts',
      range: { start: { line: 9, character: 14 }, end: { line: 9, character: 24 } },
    }
    const manager = makeMockManager({
      client: { request: vi.fn().mockResolvedValue(loc) },
    })
    const tool = makeLspQueryTool(manager)
    const result = await tool.run(
      { action: 'definition', filePath: '/tmp/a.ts', line: 5, character: 3 },
      ctx,
    )
    expect(result.isError).toBe(false)
    const parsed = parseOk<LspQueryToolResult & { action: 'definition' }>(result.output as string)
    expect(parsed.locations).toHaveLength(1)
    expect(parsed.locations[0]).toEqual(loc)
  })

  it('returns empty locations on null response', async () => {
    const manager = makeMockManager({
      client: { request: vi.fn().mockResolvedValue(null) },
    })
    const tool = makeLspQueryTool(manager)
    const result = await tool.run(
      { action: 'definition', filePath: '/tmp/a.ts', line: 0, character: 0 },
      ctx,
    )
    expect(result.isError).toBe(false)
    const parsed = parseOk<LspQueryToolResult & { action: 'definition' }>(result.output as string)
    expect(parsed.locations).toEqual([])
  })

  it('returns isError on request rejection', async () => {
    const manager = makeMockManager({
      client: { request: vi.fn().mockRejectedValue(new Error('server crashed')) },
    })
    const tool = makeLspQueryTool(manager)
    const result = await tool.run(
      { action: 'definition', filePath: '/tmp/a.ts', line: 0, character: 0 },
      ctx,
    )
    expect(result.isError).toBe(true)
    expect(result.output).toContain('server crashed')
  })

  it('passes line/character through verbatim (0-based)', async () => {
    const requestFn = vi.fn().mockResolvedValue([])
    const manager = makeMockManager({ client: { request: requestFn } })
    const tool = makeLspQueryTool(manager)
    await tool.run({ action: 'definition', filePath: '/tmp/a.ts', line: 7, character: 4 }, ctx)
    expect(requestFn).toHaveBeenCalledWith(
      'textDocument/definition',
      expect.objectContaining({
        position: { line: 7, character: 4 },
        textDocument: { uri: pathToFileURL('/tmp/a.ts').href },
      }),
      10_000,
    )
  })
})

describe('makeLspQueryTool — references action', () => {
  it('returns flat location array', async () => {
    const locs: LspLocation[] = [
      { uri: 'file:///src/a.ts', range: { start: { line: 4, character: 2 }, end: { line: 4, character: 8 } } },
      { uri: 'file:///src/b.ts', range: { start: { line: 12, character: 0 }, end: { line: 12, character: 6 } } },
    ]
    const manager = makeMockManager({ client: { request: vi.fn().mockResolvedValue(locs) } })
    const tool = makeLspQueryTool(manager)
    const result = await tool.run(
      { action: 'references', filePath: '/tmp/a.ts', line: 4, character: 2 },
      ctx,
    )
    expect(result.isError).toBe(false)
    const parsed = parseOk<LspQueryToolResult & { action: 'references' }>(result.output as string)
    expect(parsed.locations).toEqual(locs)
  })

  it('sends includeDeclaration:true in context', async () => {
    const requestFn = vi.fn().mockResolvedValue([])
    const manager = makeMockManager({ client: { request: requestFn } })
    const tool = makeLspQueryTool(manager)
    await tool.run({ action: 'references', filePath: '/tmp/a.ts', line: 0, character: 0 }, ctx)
    expect(requestFn).toHaveBeenCalledWith(
      'textDocument/references',
      expect.objectContaining({
        context: { includeDeclaration: true },
      }),
      10_000,
    )
  })

  it('returns empty locations on null result', async () => {
    const manager = makeMockManager({ client: { request: vi.fn().mockResolvedValue(null) } })
    const tool = makeLspQueryTool(manager)
    const result = await tool.run(
      { action: 'references', filePath: '/tmp/a.ts', line: 0, character: 0 },
      ctx,
    )
    expect(result.isError).toBe(false)
    const parsed = parseOk<LspQueryToolResult & { action: 'references' }>(result.output as string)
    expect(parsed.locations).toEqual([])
  })
})

describe('makeLspQueryTool — hover action', () => {
  it('normalises MarkupContent into {value, kind:"markdown"}', async () => {
    const manager = makeMockManager({
      client: {
        request: vi.fn().mockResolvedValue({
          contents: { kind: 'markdown', value: '**hello**' },
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
        }),
      },
    })
    const tool = makeLspQueryTool(manager)
    const result = await tool.run(
      { action: 'hover', filePath: '/tmp/a.ts', line: 0, character: 0 },
      ctx,
    )
    expect(result.isError).toBe(false)
    const parsed = parseOk<LspQueryToolResult & { action: 'hover' }>(result.output as string)
    expect(parsed.hover).not.toBeNull()
    expect(parsed.hover?.kind).toBe('markdown')
    expect(parsed.hover?.value).toBe('**hello**')
    expect(parsed.hover?.range).toBeDefined()
  })

  it('normalises raw-string contents into plaintext', async () => {
    const manager = makeMockManager({
      client: { request: vi.fn().mockResolvedValue({ contents: 'plain text' }) },
    })
    const tool = makeLspQueryTool(manager)
    const result = await tool.run(
      { action: 'hover', filePath: '/tmp/a.ts', line: 0, character: 0 },
      ctx,
    )
    expect(result.isError).toBe(false)
    const parsed = parseOk<LspQueryToolResult & { action: 'hover' }>(result.output as string)
    expect(parsed.hover?.value).toBe('plain text')
    expect(parsed.hover?.kind).toBe('plaintext')
  })

  it('normalises legacy MarkedString[] (mixed string + {language,value}) into joined markdown', async () => {
    const manager = makeMockManager({
      client: {
        request: vi.fn().mockResolvedValue({
          contents: ['intro', { language: 'typescript', value: 'const x: number' }],
        }),
      },
    })
    const tool = makeLspQueryTool(manager)
    const result = await tool.run(
      { action: 'hover', filePath: '/tmp/a.ts', line: 0, character: 0 },
      ctx,
    )
    expect(result.isError).toBe(false)
    const parsed = parseOk<LspQueryToolResult & { action: 'hover' }>(result.output as string)
    expect(parsed.hover?.kind).toBe('markdown')
    expect(parsed.hover?.value).toContain('intro')
    expect(parsed.hover?.value).toContain('```typescript')
    expect(parsed.hover?.value).toContain('const x: number')
  })

  it('returns hover:null when server replies null', async () => {
    const manager = makeMockManager({ client: { request: vi.fn().mockResolvedValue(null) } })
    const tool = makeLspQueryTool(manager)
    const result = await tool.run(
      { action: 'hover', filePath: '/tmp/a.ts', line: 0, character: 0 },
      ctx,
    )
    expect(result.isError).toBe(false)
    const parsed = parseOk<LspQueryToolResult & { action: 'hover' }>(result.output as string)
    expect(parsed.hover).toBeNull()
  })

  it('returns hover:null when contents is missing/garbage', async () => {
    const manager = makeMockManager({
      client: { request: vi.fn().mockResolvedValue({ contents: 123 }) },
    })
    const tool = makeLspQueryTool(manager)
    const result = await tool.run(
      { action: 'hover', filePath: '/tmp/a.ts', line: 0, character: 0 },
      ctx,
    )
    expect(result.isError).toBe(false)
    const parsed = parseOk<LspQueryToolResult & { action: 'hover' }>(result.output as string)
    expect(parsed.hover).toBeNull()
  })

  it('surfaces server errors as isError:true', async () => {
    const manager = makeMockManager({
      client: { request: vi.fn().mockRejectedValue(new Error('LSP error -32601: Method not found')) },
    })
    const tool = makeLspQueryTool(manager)
    const result = await tool.run(
      { action: 'hover', filePath: '/tmp/a.ts', line: 0, character: 0 },
      ctx,
    )
    expect(result.isError).toBe(true)
    expect(result.output).toContain('Method not found')
  })
})

describe('makeLspQueryTool — documentSymbols action', () => {
  it('returns hierarchical DocumentSymbol[] with children preserved', async () => {
    const symbols = [
      {
        name: 'MyClass',
        kind: 5,
        detail: 'class declaration',
        range: { start: { line: 0, character: 0 }, end: { line: 10, character: 0 } },
        selectionRange: { start: { line: 0, character: 6 }, end: { line: 0, character: 13 } },
        children: [
          {
            name: 'method',
            kind: 6,
            range: { start: { line: 1, character: 2 }, end: { line: 3, character: 2 } },
            selectionRange: { start: { line: 1, character: 2 }, end: { line: 1, character: 8 } },
          },
        ],
      },
    ]
    const manager = makeMockManager({ client: { request: vi.fn().mockResolvedValue(symbols) } })
    const tool = makeLspQueryTool(manager)
    const result = await tool.run({ action: 'documentSymbols', filePath: '/tmp/a.ts' }, ctx)
    expect(result.isError).toBe(false)
    const parsed = parseOk<LspQueryToolResult & { action: 'documentSymbols' }>(result.output as string)
    expect(parsed.symbols).toHaveLength(1)
    expect(parsed.symbols[0].name).toBe('MyClass')
    expect(parsed.symbols[0].detail).toBe('class declaration')
    expect(parsed.symbols[0].children).toHaveLength(1)
    expect(parsed.symbols[0].children?.[0].name).toBe('method')
  })

  it('normalises flat SymbolInformation[] into shared shape (selectionRange == range)', async () => {
    const flat = [
      {
        name: 'foo',
        kind: 12,
        location: {
          uri: 'file:///tmp/a.ts',
          range: { start: { line: 4, character: 0 }, end: { line: 4, character: 8 } },
        },
      },
    ]
    const manager = makeMockManager({ client: { request: vi.fn().mockResolvedValue(flat) } })
    const tool = makeLspQueryTool(manager)
    const result = await tool.run({ action: 'documentSymbols', filePath: '/tmp/a.ts' }, ctx)
    expect(result.isError).toBe(false)
    const parsed = parseOk<LspQueryToolResult & { action: 'documentSymbols' }>(result.output as string)
    expect(parsed.symbols).toHaveLength(1)
    expect(parsed.symbols[0].name).toBe('foo')
    expect(parsed.symbols[0].range).toEqual(parsed.symbols[0].selectionRange)
  })

  it('drops malformed entries silently and returns the valid ones', async () => {
    const mixed = [
      { name: 'valid', kind: 12, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } } },
      { not_a_symbol: true }, // garbage
      null,
      { name: 123 }, // wrong name type
    ]
    const manager = makeMockManager({ client: { request: vi.fn().mockResolvedValue(mixed) } })
    const tool = makeLspQueryTool(manager)
    const result = await tool.run({ action: 'documentSymbols', filePath: '/tmp/a.ts' }, ctx)
    expect(result.isError).toBe(false)
    const parsed = parseOk<LspQueryToolResult & { action: 'documentSymbols' }>(result.output as string)
    expect(parsed.symbols).toHaveLength(1)
    expect(parsed.symbols[0].name).toBe('valid')
  })

  it('returns empty symbols array on null response', async () => {
    const manager = makeMockManager({ client: { request: vi.fn().mockResolvedValue(null) } })
    const tool = makeLspQueryTool(manager)
    const result = await tool.run({ action: 'documentSymbols', filePath: '/tmp/a.ts' }, ctx)
    expect(result.isError).toBe(false)
    const parsed = parseOk<LspQueryToolResult & { action: 'documentSymbols' }>(result.output as string)
    expect(parsed.symbols).toEqual([])
  })

  it('does not send a position field (matches LSP spec)', async () => {
    const requestFn = vi.fn().mockResolvedValue([])
    const manager = makeMockManager({ client: { request: requestFn } })
    const tool = makeLspQueryTool(manager)
    await tool.run({ action: 'documentSymbols', filePath: '/tmp/a.ts' }, ctx)
    expect(requestFn).toHaveBeenCalledWith(
      'textDocument/documentSymbol',
      expect.not.objectContaining({ position: expect.anything() }),
      15_000,
    )
  })
})
