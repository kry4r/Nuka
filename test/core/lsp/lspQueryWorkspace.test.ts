// test/core/lsp/lspQueryWorkspace.test.ts
//
// Tests for the workspace-scoped LSPQuery actions added in
// Iter CCCC: `workspaceSymbol`, `implementation`, `callHierarchy`.
// Companion file to `lspQueryTool.test.ts` (which covers the four
// file-bound actions from Iter UUU).
//
// Mocks `LspClient.request` to feed responses without spinning up a
// real LSP server. The two-step `callHierarchy` flow
// (prepareCallHierarchy → incoming/outgoingCalls) is exercised by
// inspecting the sequence of `request()` calls.

import { describe, it, expect, vi } from 'vitest'
import { pathToFileURL } from 'node:url'
import {
  makeLspQueryTool,
} from '../../../src/core/lsp/lspQueryTool'
import type {
  LspQueryToolInput,
  LspQueryToolResult,
  LspQueryNotConfigured,
  LspCallHierarchyItem,
} from '../../../src/core/lsp/lspQueryTool'
import type { LspManager } from '../../../src/core/lsp/manager'
import type { LspClient } from '../../../src/core/lsp/client'
import type { DocumentTracker } from '../../../src/core/lsp/documentTracker'
import type { LspLocation } from '../../../src/core/lsp/types'

const ctx = {
  signal: new AbortController().signal,
  cwd: '/tmp',
} as unknown as Parameters<ReturnType<typeof makeLspQueryTool>['run']>[1]

/**
 * Lightweight mock for an `LspManager` that resolves a stub client
 * + tracker. Mirrors `makeMockManager` in `lspQueryTool.test.ts`.
 * Extracted here so the workspace tests stay self-contained.
 */
function makeMockManager(opts: {
  client?: Partial<LspClient> | null
  tracker?: Partial<DocumentTracker>
  defs?: unknown[]
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
    list: vi.fn(() => opts.defs ?? []),
    register: vi.fn(),
    closeAll: vi.fn(),
    notifyFileChanged: vi.fn(),
  } as unknown as LspManager
}

function parseOk<T extends LspQueryToolResult | LspQueryNotConfigured>(out: string): T {
  return JSON.parse(out) as T
}

// ─── workspaceSymbol ────────────────────────────────────────────────

describe('makeLspQueryTool — workspaceSymbol action', () => {
  it('returns symbols array on happy path', async () => {
    const wsSyms = [
      {
        name: 'foo',
        kind: 12,
        location: {
          uri: 'file:///src/a.ts',
          range: { start: { line: 4, character: 0 }, end: { line: 4, character: 3 } },
        },
        containerName: 'MyClass',
      },
      {
        name: 'bar',
        kind: 13,
        location: { uri: 'file:///src/b.ts' }, // modern WorkspaceSymbol (no range yet)
      },
    ]
    const manager = makeMockManager({
      client: { request: vi.fn().mockResolvedValue(wsSyms) },
    })
    const tool = makeLspQueryTool(manager)
    const result = await tool.run(
      { action: 'workspaceSymbol', filePath: '/tmp/a.ts', query: 'foo' },
      ctx,
    )
    expect(result.isError).toBe(false)
    const parsed = parseOk<LspQueryToolResult & { action: 'workspaceSymbol' }>(
      result.output as string,
    )
    expect(parsed.symbols).toHaveLength(2)
    expect(parsed.symbols[0].name).toBe('foo')
    expect(parsed.symbols[0].containerName).toBe('MyClass')
    expect(parsed.symbols[0].location.range).toBeDefined()
    expect(parsed.symbols[1].name).toBe('bar')
    expect(parsed.symbols[1].location.range).toBeUndefined()
  })

  it('sends the query verbatim (empty string allowed)', async () => {
    const requestFn = vi.fn().mockResolvedValue([])
    const manager = makeMockManager({ client: { request: requestFn } })
    const tool = makeLspQueryTool(manager)
    await tool.run(
      { action: 'workspaceSymbol', filePath: '/tmp/a.ts', query: '' },
      ctx,
    )
    expect(requestFn).toHaveBeenCalledWith(
      'workspace/symbol',
      { query: '' },
      15_000,
    )
  })

  it('returns empty symbols array on null response', async () => {
    const manager = makeMockManager({
      client: { request: vi.fn().mockResolvedValue(null) },
    })
    const tool = makeLspQueryTool(manager)
    const result = await tool.run(
      { action: 'workspaceSymbol', filePath: '/tmp/a.ts', query: 'anything' },
      ctx,
    )
    expect(result.isError).toBe(false)
    const parsed = parseOk<LspQueryToolResult & { action: 'workspaceSymbol' }>(
      result.output as string,
    )
    expect(parsed.symbols).toEqual([])
  })

  it('rejects missing query', async () => {
    const tool = makeLspQueryTool(makeMockManager({ client: { request: vi.fn() } }))
    const result = await tool.run(
      { action: 'workspaceSymbol', filePath: '/tmp/a.ts' } as LspQueryToolInput,
      ctx,
    )
    expect(result.isError).toBe(true)
    expect(result.output).toContain("'query' is required")
  })

  it('drops malformed entries silently', async () => {
    const mixed = [
      {
        name: 'valid',
        kind: 12,
        location: {
          uri: 'file:///src/a.ts',
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
        },
      },
      { name: 'no-location' }, // missing location
      { not_a_symbol: true },
      null,
      { name: 'no-uri', location: {} },
    ]
    const manager = makeMockManager({
      client: { request: vi.fn().mockResolvedValue(mixed) },
    })
    const tool = makeLspQueryTool(manager)
    const result = await tool.run(
      { action: 'workspaceSymbol', filePath: '/tmp/a.ts', query: 'v' },
      ctx,
    )
    expect(result.isError).toBe(false)
    const parsed = parseOk<LspQueryToolResult & { action: 'workspaceSymbol' }>(
      result.output as string,
    )
    expect(parsed.symbols).toHaveLength(1)
    expect(parsed.symbols[0].name).toBe('valid')
  })

  it('returns notConfigured when filePath omitted and no servers registered', async () => {
    const manager = makeMockManager({ client: null, defs: [] })
    const tool = makeLspQueryTool(manager)
    const result = await tool.run(
      { action: 'workspaceSymbol', query: 'foo' },
      ctx,
    )
    expect(result.isError).toBe(false)
    const parsed = parseOk<LspQueryNotConfigured>(result.output as string)
    expect(parsed.notConfigured).toBe(true)
    expect(parsed.action).toBe('workspaceSymbol')
    expect(parsed.filePath).toBe('')
  })

  it('surfaces server errors as isError:true', async () => {
    const manager = makeMockManager({
      client: { request: vi.fn().mockRejectedValue(new Error('LSP error -32601: Method not found')) },
    })
    const tool = makeLspQueryTool(manager)
    const result = await tool.run(
      { action: 'workspaceSymbol', filePath: '/tmp/a.ts', query: 'foo' },
      ctx,
    )
    expect(result.isError).toBe(true)
    expect(result.output).toContain('Method not found')
  })
})

// ─── implementation ─────────────────────────────────────────────────

describe('makeLspQueryTool — implementation action', () => {
  it('returns location array (array LSP shape)', async () => {
    const locs: LspLocation[] = [
      {
        uri: 'file:///src/impl.ts',
        range: { start: { line: 3, character: 0 }, end: { line: 3, character: 10 } },
      },
    ]
    const manager = makeMockManager({
      client: { request: vi.fn().mockResolvedValue(locs) },
    })
    const tool = makeLspQueryTool(manager)
    const result = await tool.run(
      { action: 'implementation', filePath: '/tmp/a.ts', line: 5, character: 3 },
      ctx,
    )
    expect(result.isError).toBe(false)
    const parsed = parseOk<LspQueryToolResult & { action: 'implementation' }>(
      result.output as string,
    )
    expect(parsed.locations).toEqual(locs)
  })

  it('wraps a single-location response into array', async () => {
    const loc: LspLocation = {
      uri: 'file:///src/impl.ts',
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    }
    const manager = makeMockManager({
      client: { request: vi.fn().mockResolvedValue(loc) },
    })
    const tool = makeLspQueryTool(manager)
    const result = await tool.run(
      { action: 'implementation', filePath: '/tmp/a.ts', line: 0, character: 0 },
      ctx,
    )
    expect(result.isError).toBe(false)
    const parsed = parseOk<LspQueryToolResult & { action: 'implementation' }>(
      result.output as string,
    )
    expect(parsed.locations).toHaveLength(1)
    expect(parsed.locations[0]).toEqual(loc)
  })

  it('returns empty locations on null response', async () => {
    const manager = makeMockManager({
      client: { request: vi.fn().mockResolvedValue(null) },
    })
    const tool = makeLspQueryTool(manager)
    const result = await tool.run(
      { action: 'implementation', filePath: '/tmp/a.ts', line: 0, character: 0 },
      ctx,
    )
    expect(result.isError).toBe(false)
    const parsed = parseOk<LspQueryToolResult & { action: 'implementation' }>(
      result.output as string,
    )
    expect(parsed.locations).toEqual([])
  })

  it('rejects missing line/character', async () => {
    const tool = makeLspQueryTool(makeMockManager({ client: { request: vi.fn() } }))
    const result = await tool.run(
      { action: 'implementation', filePath: '/tmp/a.ts' } as LspQueryToolInput,
      ctx,
    )
    expect(result.isError).toBe(true)
    expect(result.output).toContain("'line' is required")
  })

  it('routes through textDocument/implementation with correct payload', async () => {
    const requestFn = vi.fn().mockResolvedValue([])
    const manager = makeMockManager({ client: { request: requestFn } })
    const tool = makeLspQueryTool(manager)
    await tool.run(
      { action: 'implementation', filePath: '/tmp/a.ts', line: 7, character: 4 },
      ctx,
    )
    expect(requestFn).toHaveBeenCalledWith(
      'textDocument/implementation',
      expect.objectContaining({
        position: { line: 7, character: 4 },
        textDocument: { uri: pathToFileURL('/tmp/a.ts').href },
      }),
      10_000,
    )
  })
})

// ─── callHierarchy ─────────────────────────────────────────────────

/**
 * Build a stub `CallHierarchyItem` for prepare-step responses.
 */
function fakeItem(name: string, uri = 'file:///src/a.ts'): unknown {
  return {
    name,
    kind: 12,
    uri,
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: name.length } },
    selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: name.length } },
    data: { token: `${name}-token` },
  }
}

describe('makeLspQueryTool — callHierarchy action', () => {
  it('incoming: prepare → incomingCalls, returns aggregated calls', async () => {
    const item = fakeItem('myFn')
    const incomingCall = {
      from: fakeItem('caller', 'file:///src/caller.ts'),
      fromRanges: [
        { start: { line: 10, character: 4 }, end: { line: 10, character: 8 } },
      ],
    }
    const requestFn = vi.fn()
      // Step 1: prepareCallHierarchy
      .mockResolvedValueOnce([item])
      // Step 2: callHierarchy/incomingCalls
      .mockResolvedValueOnce([incomingCall])

    const manager = makeMockManager({ client: { request: requestFn } })
    const tool = makeLspQueryTool(manager)
    const result = await tool.run(
      {
        action: 'callHierarchy',
        filePath: '/tmp/a.ts',
        line: 0,
        character: 0,
        direction: 'incoming',
      },
      ctx,
    )
    expect(result.isError).toBe(false)
    const parsed = parseOk<LspQueryToolResult & { action: 'callHierarchy' }>(
      result.output as string,
    )
    expect(parsed.direction).toBe('incoming')
    expect(parsed.items).toHaveLength(1)
    expect(parsed.items[0].name).toBe('myFn')
    expect(parsed.incoming).toBeDefined()
    expect(parsed.incoming).toHaveLength(1)
    expect(parsed.incoming![0].from.name).toBe('caller')
    expect(parsed.incoming![0].fromRanges).toHaveLength(1)

    // Verify the two-step LSP method names.
    expect(requestFn).toHaveBeenNthCalledWith(
      1,
      'textDocument/prepareCallHierarchy',
      expect.any(Object),
      10_000,
    )
    expect(requestFn).toHaveBeenNthCalledWith(
      2,
      'callHierarchy/incomingCalls',
      expect.objectContaining({ item: expect.objectContaining({ name: 'myFn' }) }),
      10_000,
    )
  })

  it('outgoing: prepare → outgoingCalls', async () => {
    const item = fakeItem('myFn')
    const outgoingCall = {
      to: fakeItem('callee', 'file:///src/callee.ts'),
      fromRanges: [
        { start: { line: 2, character: 0 }, end: { line: 2, character: 6 } },
      ],
    }
    const requestFn = vi.fn()
      .mockResolvedValueOnce([item])
      .mockResolvedValueOnce([outgoingCall])

    const manager = makeMockManager({ client: { request: requestFn } })
    const tool = makeLspQueryTool(manager)
    const result = await tool.run(
      {
        action: 'callHierarchy',
        filePath: '/tmp/a.ts',
        line: 0,
        character: 0,
        direction: 'outgoing',
      },
      ctx,
    )
    expect(result.isError).toBe(false)
    const parsed = parseOk<LspQueryToolResult & { action: 'callHierarchy' }>(
      result.output as string,
    )
    expect(parsed.direction).toBe('outgoing')
    expect(parsed.outgoing).toBeDefined()
    expect(parsed.outgoing).toHaveLength(1)
    expect(parsed.outgoing![0].to.name).toBe('callee')

    expect(requestFn).toHaveBeenNthCalledWith(
      2,
      'callHierarchy/outgoingCalls',
      expect.any(Object),
      10_000,
    )
  })

  it('empty prepare → empty calls (no follow-up RPC)', async () => {
    const requestFn = vi.fn().mockResolvedValueOnce([])
    const manager = makeMockManager({ client: { request: requestFn } })
    const tool = makeLspQueryTool(manager)
    const result = await tool.run(
      {
        action: 'callHierarchy',
        filePath: '/tmp/a.ts',
        line: 0,
        character: 0,
        direction: 'incoming',
      },
      ctx,
    )
    expect(result.isError).toBe(false)
    const parsed = parseOk<LspQueryToolResult & { action: 'callHierarchy' }>(
      result.output as string,
    )
    expect(parsed.items).toEqual([])
    expect(parsed.incoming).toEqual([])
    // Only the prepare RPC should have been sent.
    expect(requestFn).toHaveBeenCalledTimes(1)
    expect(requestFn).toHaveBeenCalledWith(
      'textDocument/prepareCallHierarchy',
      expect.any(Object),
      10_000,
    )
  })

  it('null prepare → empty items + empty outgoing', async () => {
    const requestFn = vi.fn().mockResolvedValueOnce(null)
    const manager = makeMockManager({ client: { request: requestFn } })
    const tool = makeLspQueryTool(manager)
    const result = await tool.run(
      {
        action: 'callHierarchy',
        filePath: '/tmp/a.ts',
        line: 0,
        character: 0,
        direction: 'outgoing',
      },
      ctx,
    )
    expect(result.isError).toBe(false)
    const parsed = parseOk<LspQueryToolResult & { action: 'callHierarchy' }>(
      result.output as string,
    )
    expect(parsed.items).toEqual([])
    expect(parsed.outgoing).toEqual([])
    expect(requestFn).toHaveBeenCalledTimes(1)
  })

  it('prepare returns single item (not array) → normalised to array', async () => {
    const item = fakeItem('soloFn')
    const requestFn = vi.fn()
      // Older servers may return a single object instead of an array.
      .mockResolvedValueOnce(item)
      .mockResolvedValueOnce([])

    const manager = makeMockManager({ client: { request: requestFn } })
    const tool = makeLspQueryTool(manager)
    const result = await tool.run(
      {
        action: 'callHierarchy',
        filePath: '/tmp/a.ts',
        line: 0,
        character: 0,
        direction: 'incoming',
      },
      ctx,
    )
    expect(result.isError).toBe(false)
    const parsed = parseOk<LspQueryToolResult & { action: 'callHierarchy' }>(
      result.output as string,
    )
    expect(parsed.items).toHaveLength(1)
    expect(parsed.items[0].name).toBe('soloFn')
    expect(parsed.incoming).toEqual([])
  })

  it('invalid direction → isError', async () => {
    const tool = makeLspQueryTool(makeMockManager({ client: { request: vi.fn() } }))
    const result = await tool.run(
      {
        action: 'callHierarchy',
        filePath: '/tmp/a.ts',
        line: 0,
        character: 0,
        direction: 'sideways' as unknown as LspQueryToolInput['direction'],
      },
      ctx,
    )
    expect(result.isError).toBe(true)
    expect(result.output).toContain("'direction' must be 'incoming' or 'outgoing'")
  })

  it('missing direction → isError', async () => {
    const tool = makeLspQueryTool(makeMockManager({ client: { request: vi.fn() } }))
    const result = await tool.run(
      {
        action: 'callHierarchy',
        filePath: '/tmp/a.ts',
        line: 0,
        character: 0,
      } as LspQueryToolInput,
      ctx,
    )
    expect(result.isError).toBe(true)
    expect(result.output).toContain("'direction' is required")
  })

  it('preserves the server-provided `data` blob across step 1 → step 2', async () => {
    const item = fakeItem('myFn')
    const requestFn = vi.fn()
      .mockResolvedValueOnce([item])
      .mockResolvedValueOnce([])

    const manager = makeMockManager({ client: { request: requestFn } })
    const tool = makeLspQueryTool(manager)
    await tool.run(
      {
        action: 'callHierarchy',
        filePath: '/tmp/a.ts',
        line: 0,
        character: 0,
        direction: 'incoming',
      },
      ctx,
    )
    // Step 2 should pass the item object through with `data` intact.
    const stepTwoCall = requestFn.mock.calls[1]
    const payload = stepTwoCall?.[1] as { item: LspCallHierarchyItem }
    expect(payload.item.data).toEqual({ token: 'myFn-token' })
  })

  it('drops malformed prepare entries silently', async () => {
    const mixed = [
      fakeItem('valid'),
      { not_an_item: true },
      null,
      { name: 'no-uri', range: {}, selectionRange: {} },
    ]
    const requestFn = vi.fn()
      .mockResolvedValueOnce(mixed)
      .mockResolvedValueOnce([])
    const manager = makeMockManager({ client: { request: requestFn } })
    const tool = makeLspQueryTool(manager)
    const result = await tool.run(
      {
        action: 'callHierarchy',
        filePath: '/tmp/a.ts',
        line: 0,
        character: 0,
        direction: 'incoming',
      },
      ctx,
    )
    expect(result.isError).toBe(false)
    const parsed = parseOk<LspQueryToolResult & { action: 'callHierarchy' }>(
      result.output as string,
    )
    expect(parsed.items).toHaveLength(1)
    expect(parsed.items[0].name).toBe('valid')
  })

  it('surfaces server errors during prepare step', async () => {
    const manager = makeMockManager({
      client: {
        request: vi.fn().mockRejectedValue(new Error('LSP error -32601: Method not found')),
      },
    })
    const tool = makeLspQueryTool(manager)
    const result = await tool.run(
      {
        action: 'callHierarchy',
        filePath: '/tmp/a.ts',
        line: 0,
        character: 0,
        direction: 'incoming',
      },
      ctx,
    )
    expect(result.isError).toBe(true)
    expect(result.output).toContain('Method not found')
  })
})

// ─── action enum / required-params regression ──────────────────────

describe('makeLspQueryTool — extended action enum surface', () => {
  it('valid action list now includes the three new actions', async () => {
    const tool = makeLspQueryTool(makeMockManager({ client: { request: vi.fn() } }))
    const params = tool.parameters as {
      properties: Record<string, { enum?: string[] }>
    }
    const actionEnum = params.properties.action.enum
    expect(actionEnum).toContain('workspaceSymbol')
    expect(actionEnum).toContain('implementation')
    expect(actionEnum).toContain('callHierarchy')
  })

  it('rejects an unknown action with the new actions listed', async () => {
    const tool = makeLspQueryTool(makeMockManager({ client: { request: vi.fn() } }))
    const result = await tool.run(
      {
        action: 'bogus' as unknown as LspQueryToolInput['action'],
        filePath: '/tmp/a.ts',
      },
      ctx,
    )
    expect(result.isError).toBe(true)
    expect(result.output).toContain('workspaceSymbol')
    expect(result.output).toContain('implementation')
    expect(result.output).toContain('callHierarchy')
  })
})
