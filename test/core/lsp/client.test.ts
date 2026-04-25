import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PassThrough } from 'node:stream'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { LspClient } from '../../../src/core/lsp/client'
import { encodeMessage } from '../../../src/core/lsp/jsonrpc'
import type { LspServerDef } from '../../../src/core/lsp/types'

// Create a fake ChildProcess for testing
function makeMockProcess(): {
  cp: ChildProcess
  stdin: PassThrough
  stdout: PassThrough
  stderr: PassThrough
  emit: (event: string, ...args: unknown[]) => void
} {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const emitter = new EventEmitter()
  const cp = Object.assign(emitter, { stdin, stdout, stderr, kill: vi.fn() }) as unknown as ChildProcess
  return { cp, stdin, stdout, stderr, emit: (ev, ...args) => emitter.emit(ev, ...args) }
}

function makeSpawnFn(mock: ReturnType<typeof makeMockProcess>) {
  return vi.fn(() => mock.cp) as unknown as typeof import('node:child_process').spawn
}

const baseDef: LspServerDef = {
  name: 'test-lsp',
  command: 'test-language-server',
  args: ['--stdio'],
  documentSelector: [{ language: 'typescript' }],
}

// Helper: push a response to stdout after a microtask delay
function pushResponse(stdout: PassThrough, msg: object): void {
  // Use setImmediate so the client's stdin write finishes first
  setImmediate(() => stdout.push(encodeMessage(msg)))
}

describe('LspClient', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('start()', () => {
    it('resolves and sets status=ready when initialize succeeds', async () => {
      const mock = makeMockProcess()
      const client = new LspClient({ def: baseDef, _spawnFn: makeSpawnFn(mock) })

      expect(client.status).toBe('idle')

      const startPromise = client.start()

      // Wait for the initialize request to be written to stdin, then respond
      await new Promise<void>((resolve) => {
        mock.stdin.once('data', () => resolve())
      })

      // Push a valid initialize result
      mock.stdout.push(encodeMessage({
        jsonrpc: '2.0',
        id: 1,
        result: { capabilities: { textDocumentSync: 1 } },
      }))

      await startPromise
      expect(client.status).toBe('ready')
    })

    it('rejects and sets status=error when spawn emits error (ENOENT)', async () => {
      const mock = makeMockProcess()
      const client = new LspClient({ def: baseDef, _spawnFn: makeSpawnFn(mock) })

      const startPromise = client.start()

      // Simulate ENOENT
      setImmediate(() => mock.emit('error', new Error('spawn ENOENT')))

      await expect(startPromise).rejects.toThrow('spawn ENOENT')
      expect(client.status).toBe('error')
    })

    it('rejects and sets status=error when process exits prematurely', async () => {
      const mock = makeMockProcess()
      const client = new LspClient({ def: baseDef, _spawnFn: makeSpawnFn(mock) })

      const startPromise = client.start()

      // Simulate early exit
      setImmediate(() => mock.emit('exit', 1, null))

      await expect(startPromise).rejects.toThrow('exited prematurely')
      expect(client.status).toBe('closed')
    })

    it('rejects after 10s initialize timeout', async () => {
      const mock = makeMockProcess()
      const client = new LspClient({ def: baseDef, _spawnFn: makeSpawnFn(mock) })

      // Start but never respond with initialize result
      const startPromise = client.start().catch(e => e)

      // Advance time past the 10s timeout
      await vi.advanceTimersByTimeAsync(10_001)

      const err = await startPromise
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toMatch('timed out')
      expect(client.status).toBe('error')
    })

    it('rejects if start() is called twice', async () => {
      const mock = makeMockProcess()
      const client = new LspClient({ def: baseDef, _spawnFn: makeSpawnFn(mock) })

      const startPromise = client.start().catch(e => e)
      // Second call should reject immediately
      await expect(client.start()).rejects.toThrow("called in state 'starting'")

      // Clean up by advancing past timeout to drain the first start()
      await vi.advanceTimersByTimeAsync(10_001)
      await startPromise
    })
  })

  describe('diagnostics', () => {
    it('publishes diagnostics when publishDiagnostics notification arrives', async () => {
      const mock = makeMockProcess()
      const client = new LspClient({ def: baseDef, _spawnFn: makeSpawnFn(mock) })

      const startPromise = client.start()
      await new Promise<void>(r => mock.stdin.once('data', () => r()))
      mock.stdout.push(encodeMessage({ jsonrpc: '2.0', id: 1, result: { capabilities: {} } }))
      await startPromise

      const uri = 'file:///test.ts'
      const diags = [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, severity: 1 as const, message: 'Type error', source: 'ts' }]

      mock.stdout.push(encodeMessage({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: { uri, diagnostics: diags },
      }))

      // Wait for async stream processing
      await new Promise(r => setImmediate(r))

      expect(client.diagnosticsFor(uri)).toEqual(diags)
    })

    it('fires onDiagnostics subscribers', async () => {
      const mock = makeMockProcess()
      const client = new LspClient({ def: baseDef, _spawnFn: makeSpawnFn(mock) })

      const startPromise = client.start()
      await new Promise<void>(r => mock.stdin.once('data', () => r()))
      mock.stdout.push(encodeMessage({ jsonrpc: '2.0', id: 1, result: { capabilities: {} } }))
      await startPromise

      const uri = 'file:///test.ts'
      const received: unknown[] = []
      client.onDiagnostics(uri, (d) => received.push(d))

      mock.stdout.push(encodeMessage({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: { uri, diagnostics: [{ range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } }, severity: 2 as const, message: 'warn' }] },
      }))

      await new Promise(r => setImmediate(r))
      expect(received).toHaveLength(1)
    })

    it('onDiagnostics unsubscribe stops callbacks', async () => {
      const mock = makeMockProcess()
      const client = new LspClient({ def: baseDef, _spawnFn: makeSpawnFn(mock) })

      const startPromise = client.start()
      await new Promise<void>(r => mock.stdin.once('data', () => r()))
      mock.stdout.push(encodeMessage({ jsonrpc: '2.0', id: 1, result: { capabilities: {} } }))
      await startPromise

      const uri = 'file:///test.ts'
      let calls = 0
      const unsub = client.onDiagnostics(uri, () => calls++)
      unsub()

      mock.stdout.push(encodeMessage({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: { uri, diagnostics: [] },
      }))
      await new Promise(r => setImmediate(r))
      expect(calls).toBe(0)
    })

    it('diagnosticsFor returns empty array for unknown uri', async () => {
      const mock = makeMockProcess()
      const client = new LspClient({ def: baseDef, _spawnFn: makeSpawnFn(mock) })
      expect(client.diagnosticsFor('file:///unknown.ts')).toEqual([])
    })
  })

  describe('shutdown()', () => {
    it('sends shutdown request and exit notification, sets status=closed', async () => {
      const mock = makeMockProcess()
      const client = new LspClient({ def: baseDef, _spawnFn: makeSpawnFn(mock) })

      const startPromise = client.start()
      await new Promise<void>(r => mock.stdin.once('data', () => r()))
      mock.stdout.push(encodeMessage({ jsonrpc: '2.0', id: 1, result: { capabilities: {} } }))
      await startPromise
      expect(client.status).toBe('ready')

      // Collect all stdin writes after start
      const writes: Buffer[] = []
      mock.stdin.on('data', (chunk: Buffer) => writes.push(chunk))

      // Respond to shutdown request
      const shutdownPromise = client.shutdown()
      await new Promise(r => setImmediate(r))
      // Push shutdown response (id=2, the first post-init request)
      mock.stdout.push(encodeMessage({ jsonrpc: '2.0', id: 2, result: null }))
      // Also simulate the process exiting
      setImmediate(() => mock.emit('exit', 0, null))

      await shutdownPromise
      expect(client.status).toBe('closed')

      // Verify shutdown request was sent
      const allData = Buffer.concat(writes).toString()
      expect(allData).toContain('"method":"shutdown"')
      expect(allData).toContain('"method":"exit"')
    })

    it('is idempotent — calling shutdown twice is safe', async () => {
      const mock = makeMockProcess()
      const client = new LspClient({ def: baseDef, _spawnFn: makeSpawnFn(mock) })

      // Never started — shutdown on idle should be a no-op
      await expect(client.shutdown()).resolves.toBeUndefined()
      await expect(client.shutdown()).resolves.toBeUndefined()
    })
  })

  describe('request()', () => {
    it('sends request and resolves with result', async () => {
      const mock = makeMockProcess()
      const client = new LspClient({ def: baseDef, _spawnFn: makeSpawnFn(mock) })

      const startPromise = client.start()
      await new Promise<void>(r => mock.stdin.once('data', () => r()))
      mock.stdout.push(encodeMessage({ jsonrpc: '2.0', id: 1, result: { capabilities: {} } }))
      await startPromise

      const reqPromise = client.request<{ uri: string }>('textDocument/definition', { textDocument: { uri: 'file:///a.ts' }, position: { line: 0, character: 0 } })
      await new Promise(r => setImmediate(r))
      mock.stdout.push(encodeMessage({ jsonrpc: '2.0', id: 2, result: { uri: 'file:///b.ts' } }))

      const result = await reqPromise
      expect(result).toEqual({ uri: 'file:///b.ts' })
    })

    it('rejects if called when not ready', async () => {
      const mock = makeMockProcess()
      const client = new LspClient({ def: baseDef, _spawnFn: makeSpawnFn(mock) })
      await expect(client.request('foo')).rejects.toThrow("not ready")
    })

    it('rejects on LSP error response', async () => {
      const mock = makeMockProcess()
      const client = new LspClient({ def: baseDef, _spawnFn: makeSpawnFn(mock) })

      const startPromise = client.start()
      await new Promise<void>(r => mock.stdin.once('data', () => r()))
      mock.stdout.push(encodeMessage({ jsonrpc: '2.0', id: 1, result: { capabilities: {} } }))
      await startPromise

      const reqPromise = client.request('textDocument/definition', {})
      await new Promise(r => setImmediate(r))
      mock.stdout.push(encodeMessage({ jsonrpc: '2.0', id: 2, error: { code: -32601, message: 'Method not found' } }))

      await expect(reqPromise).rejects.toThrow('Method not found')
    })
  })
})
