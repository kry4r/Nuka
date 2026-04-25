import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { pathToFileURL } from 'node:url'
import { makeLspDiagnosticsTool, makeLspDefinitionTool, makeLspReferencesTool } from '../../../src/core/lsp/tools'
import type { LspManager } from '../../../src/core/lsp/manager'
import type { LspClient } from '../../../src/core/lsp/client'
import type { DocumentTracker } from '../../../src/core/lsp/documentTracker'
import type { LspDiagnostic, LspLocation } from '../../../src/core/lsp/types'

// Stub tool context
const ctx = {
  signal: new AbortController().signal,
  cwd: '/tmp',
}

function makeUri(path: string): string {
  return pathToFileURL(path).href
}

function makeMockManager(opts: {
  client?: Partial<LspClient> | null
  tracker?: Partial<DocumentTracker>
}): LspManager {
  const tracker: DocumentTracker = {
    isOpen: vi.fn(() => false),
    versionOf: vi.fn(() => undefined),
    ensureOpen: vi.fn().mockResolvedValue(undefined),
    applyChange: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as DocumentTracker

  if (opts.tracker) {
    Object.assign(tracker, opts.tracker)
  }

  const client = opts.client === null
    ? null
    : {
        status: 'ready',
        diagnosticsFor: vi.fn(() => []),
        onDiagnostics: vi.fn(() => () => {}),
        request: vi.fn().mockResolvedValue([]),
        notify: vi.fn(),
        ...opts.client,
      } as unknown as LspClient

  const manager: LspManager = {
    clientFor: vi.fn().mockResolvedValue(client),
    trackerFor: vi.fn(() => tracker),
    list: vi.fn(() => []),
    register: vi.fn(),
    closeAll: vi.fn(),
    notifyFileChanged: vi.fn(),
  } as unknown as LspManager

  return manager
}

describe('makeLspDiagnosticsTool', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns formatted diagnostics for a known file', async () => {
    const diags: LspDiagnostic[] = [
      { range: { start: { line: 2, character: 4 }, end: { line: 2, character: 10 } }, severity: 1, message: 'Type error', source: 'ts' },
      { range: { start: { line: 5, character: 0 }, end: { line: 5, character: 5 } }, severity: 2, message: 'Implicit any' },
    ]

    const manager = makeMockManager({
      client: {
        diagnosticsFor: vi.fn(() => diags),
        onDiagnostics: vi.fn(() => () => {}),
      },
      tracker: { isOpen: vi.fn(() => true) },
    })

    const tool = makeLspDiagnosticsTool(manager)
    const result = await tool.run({ path: '/tmp/a.ts' }, ctx as any)

    expect(result.isError).toBe(false)
    expect(result.output).toContain('error 3:5 Type error [ts]')
    expect(result.output).toContain('warning 6:1 Implicit any')
  })

  it('returns "No diagnostics for <path>" when no diagnostics after 2s wait', async () => {
    const manager = makeMockManager({
      client: {
        diagnosticsFor: vi.fn(() => []),
        onDiagnostics: vi.fn((_uri, _cb) => () => {}),
      },
    })

    const tool = makeLspDiagnosticsTool(manager)
    const runPromise = tool.run({ path: '/tmp/a.ts' }, ctx as any)
    await vi.advanceTimersByTimeAsync(2_001)
    const result = await runPromise

    expect(result.isError).toBe(false)
    expect(result.output).toBe('No diagnostics for /tmp/a.ts')
  })

  it('returns "No LSP server registered" when no client matches', async () => {
    const manager = makeMockManager({ client: null })
    const tool = makeLspDiagnosticsTool(manager)
    const result = await tool.run({ path: '/tmp/foo.unknown' }, ctx as any)

    expect(result.isError).toBe(false)
    expect(result.output).toContain('No LSP server registered')
  })

  it('delivers diagnostics from onDiagnostics subscriber if initially empty', async () => {
    const diags: LspDiagnostic[] = [
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, severity: 1, message: 'Error!' },
    ]

    let subscriberCb: ((d: LspDiagnostic[]) => void) | undefined
    const manager = makeMockManager({
      client: {
        diagnosticsFor: vi.fn(() => []),
        onDiagnostics: vi.fn((_uri, cb) => {
          subscriberCb = cb
          return () => {}
        }),
      },
    })

    const tool = makeLspDiagnosticsTool(manager)
    const runPromise = tool.run({ path: '/tmp/a.ts' }, ctx as any)

    // Simulate server pushing diagnostics
    await new Promise(r => setImmediate(r))
    subscriberCb!(diags)

    const result = await runPromise
    expect(result.isError).toBe(false)
    expect(result.output).toContain('Error!')
  })

  it('has correct annotations', () => {
    const manager = makeMockManager({ client: null })
    const tool = makeLspDiagnosticsTool(manager)
    expect(tool.annotations?.readOnly).toBe(true)
    expect(tool.annotations?.destructive).toBe(false)
    expect(tool.annotations?.parallelSafe).toBe(true)
    expect(tool.needsPermission({ path: '' })).toBe('none')
  })
})

describe('makeLspDefinitionTool', () => {
  it('returns formatted location list from LSP definition response', async () => {
    const loc: LspLocation = {
      uri: 'file:///src/types.ts',
      range: { start: { line: 9, character: 14 }, end: { line: 9, character: 24 } },
    }

    const manager = makeMockManager({
      client: { request: vi.fn().mockResolvedValue([loc]) },
      tracker: { isOpen: vi.fn(() => true) },
    })

    const tool = makeLspDefinitionTool(manager)
    const result = await tool.run({ path: '/tmp/a.ts', line: 5, character: 3 }, ctx as any)

    expect(result.isError).toBe(false)
    expect(result.output).toContain('/src/types.ts:10:15')
  })

  it('handles null result as "No definition found"', async () => {
    const manager = makeMockManager({
      client: { request: vi.fn().mockResolvedValue(null) },
      tracker: { isOpen: vi.fn(() => true) },
    })

    const tool = makeLspDefinitionTool(manager)
    const result = await tool.run({ path: '/tmp/a.ts', line: 0, character: 0 }, ctx as any)

    expect(result.isError).toBe(false)
    expect(result.output).toContain('No definition found')
  })

  it('handles a single-location (non-array) response', async () => {
    const loc: LspLocation = {
      uri: 'file:///src/a.ts',
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
    }

    const manager = makeMockManager({
      client: { request: vi.fn().mockResolvedValue(loc) },
      tracker: { isOpen: vi.fn(() => true) },
    })

    const tool = makeLspDefinitionTool(manager)
    const result = await tool.run({ path: '/tmp/a.ts', line: 0, character: 0 }, ctx as any)

    expect(result.isError).toBe(false)
    expect(result.output).toContain('/src/a.ts:1:1')
  })

  it('returns isError:true when request throws', async () => {
    const manager = makeMockManager({
      client: { request: vi.fn().mockRejectedValue(new Error('server crashed')) },
      tracker: { isOpen: vi.fn(() => true) },
    })

    const tool = makeLspDefinitionTool(manager)
    const result = await tool.run({ path: '/tmp/a.ts', line: 0, character: 0 }, ctx as any)

    expect(result.isError).toBe(true)
    expect(result.output).toContain('server crashed')
  })

  it('has correct annotations', () => {
    const manager = makeMockManager({ client: null })
    const tool = makeLspDefinitionTool(manager)
    expect(tool.annotations?.readOnly).toBe(true)
    expect(tool.annotations?.destructive).toBe(false)
    expect(tool.annotations?.parallelSafe).toBe(true)
  })
})

describe('makeLspReferencesTool', () => {
  it('returns all references from LSP response', async () => {
    const locs: LspLocation[] = [
      { uri: 'file:///src/a.ts', range: { start: { line: 4, character: 2 }, end: { line: 4, character: 8 } } },
      { uri: 'file:///src/b.ts', range: { start: { line: 12, character: 0 }, end: { line: 12, character: 6 } } },
    ]

    const manager = makeMockManager({
      client: { request: vi.fn().mockResolvedValue(locs) },
      tracker: { isOpen: vi.fn(() => true) },
    })

    const tool = makeLspReferencesTool(manager)
    const result = await tool.run({ path: '/tmp/a.ts', line: 4, character: 2 }, ctx as any)

    expect(result.isError).toBe(false)
    expect(result.output).toContain('/src/a.ts:5:3')
    expect(result.output).toContain('/src/b.ts:13:1')
  })

  it('returns "No references found" when result is null', async () => {
    const manager = makeMockManager({
      client: { request: vi.fn().mockResolvedValue(null) },
      tracker: { isOpen: vi.fn(() => true) },
    })

    const tool = makeLspReferencesTool(manager)
    const result = await tool.run({ path: '/tmp/a.ts', line: 0, character: 0 }, ctx as any)

    expect(result.isError).toBe(false)
    expect(result.output).toContain('No references found')
  })

  it('has correct annotations', () => {
    const manager = makeMockManager({ client: null })
    const tool = makeLspReferencesTool(manager)
    expect(tool.annotations?.readOnly).toBe(true)
    expect(tool.annotations?.parallelSafe).toBe(true)
  })
})
