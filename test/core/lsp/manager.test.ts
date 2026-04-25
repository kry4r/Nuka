import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PassThrough } from 'node:stream'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { LspManager } from '../../../src/core/lsp/manager'
import { encodeMessage } from '../../../src/core/lsp/jsonrpc'
import type { LspServerDef } from '../../../src/core/lsp/types'

// Create a mock spawn function that auto-responds to initialize
function makeMockSpawn(opts?: { autoInit?: boolean }) {
  const autoInit = opts?.autoInit ?? true
  const processes: Array<{ cp: ChildProcess; stdout: PassThrough }> = []

  const spawnFn = vi.fn(() => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const emitter = new EventEmitter()
    const cp = Object.assign(emitter, { stdin, stdout, stderr, kill: vi.fn() }) as unknown as ChildProcess

    if (autoInit) {
      // Auto-respond to the initialize request
      stdin.once('data', () => {
        setImmediate(() => {
          stdout.push(encodeMessage({ jsonrpc: '2.0', id: 1, result: { capabilities: {} } }))
        })
      })
    }

    processes.push({ cp, stdout })
    return cp
  }) as unknown as typeof import('node:child_process').spawn

  return { spawnFn, processes }
}

const tsDef: LspServerDef = {
  name: 'test-ts',
  command: 'typescript-language-server',
  args: ['--stdio'],
  documentSelector: [{ language: 'typescript' }],
}

const jsDef: LspServerDef = {
  name: 'test-js',
  command: 'js-language-server',
  args: ['--stdio'],
  documentSelector: [{ language: 'javascript' }],
}

const pyDef: LspServerDef = {
  name: 'test-py',
  command: 'pylsp',
  args: [],
  documentSelector: [{ language: 'python' }],
}

describe('LspManager', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('register()', () => {
    it('registers a def and returns {ok:true}', () => {
      const mgr = new LspManager()
      expect(mgr.register(tsDef)).toEqual({ ok: true })
      expect(mgr.list()).toHaveLength(1)
    })

    it('returns {ok:false} when a later def has same language selector', () => {
      const mgr = new LspManager()
      mgr.register(tsDef)

      const dupe: LspServerDef = {
        ...tsDef,
        name: 'dupe-ts',
        command: 'other-ts-server',
      }
      const result = mgr.register(dupe)
      expect(result.ok).toBe(false)
      expect((result as { ok: false; reason: string }).reason).toMatch("language:'typescript'")
      expect(mgr.list()).toHaveLength(1)
    })

    it('returns {ok:false} when a later def has same pattern selector', () => {
      const mgr = new LspManager()
      const patDef: LspServerDef = {
        name: 'pat1',
        command: 'server1',
        documentSelector: [{ pattern: '*.ts' }],
      }
      const patDef2: LspServerDef = {
        name: 'pat2',
        command: 'server2',
        documentSelector: [{ pattern: '*.ts' }],
      }
      mgr.register(patDef)
      const result = mgr.register(patDef2)
      expect(result.ok).toBe(false)
    })

    it('allows two defs with non-overlapping selectors', () => {
      const mgr = new LspManager()
      expect(mgr.register(tsDef)).toEqual({ ok: true })
      expect(mgr.register(pyDef)).toEqual({ ok: true })
      expect(mgr.list()).toHaveLength(2)
    })
  })

  describe('clientFor()', () => {
    it('returns null for unmatched file path', async () => {
      const mgr = new LspManager()
      mgr.register(tsDef)
      const result = await mgr.clientFor('/tmp/foo.unknown')
      expect(result).toBeNull()
    })

    it('lazy-spawns a client for a matching .ts file', async () => {
      const { spawnFn } = makeMockSpawn()
      const mgr = new LspManager({ _spawnFn: spawnFn })
      mgr.register(tsDef)

      const client = await mgr.clientFor('/tmp/foo.ts')
      expect(client).not.toBeNull()
      expect(client!.status).toBe('ready')
      expect(spawnFn).toHaveBeenCalledOnce()
    })

    it('reuses the same client for subsequent calls', async () => {
      const { spawnFn } = makeMockSpawn()
      const mgr = new LspManager({ _spawnFn: spawnFn })
      mgr.register(tsDef)

      const c1 = await mgr.clientFor('/tmp/a.ts')
      const c2 = await mgr.clientFor('/tmp/b.ts')
      expect(c1).toBe(c2)
      expect(spawnFn).toHaveBeenCalledOnce()
    })

    it('returns the correct client for different file types', async () => {
      const { spawnFn } = makeMockSpawn()
      const mgr = new LspManager({ _spawnFn: spawnFn })
      mgr.register(tsDef)
      mgr.register(jsDef)

      const tsClient = await mgr.clientFor('/tmp/a.ts')
      const jsClient = await mgr.clientFor('/tmp/b.js')
      expect(tsClient).not.toBe(jsClient)
      expect(spawnFn).toHaveBeenCalledTimes(2)
    })

    it('matches .tsx files as typescript', async () => {
      const { spawnFn } = makeMockSpawn()
      const tsxDef: LspServerDef = {
        ...tsDef,
        documentSelector: [{ language: 'typescript' }, { language: 'typescriptreact' }],
      }
      const mgr = new LspManager({ _spawnFn: spawnFn })
      mgr.register(tsxDef)

      const client = await mgr.clientFor('/tmp/App.tsx')
      expect(client).not.toBeNull()
    })

    it('matches files by pattern selector', async () => {
      const { spawnFn } = makeMockSpawn()
      const patDef: LspServerDef = {
        name: 'pat-server',
        command: 'server',
        documentSelector: [{ pattern: '*.config.js' }],
      }
      const mgr = new LspManager({ _spawnFn: spawnFn })
      mgr.register(patDef)

      const client = await mgr.clientFor('/project/webpack.config.js')
      expect(client).not.toBeNull()
    })
  })

  describe('trackerFor()', () => {
    it('returns a DocumentTracker for a client', async () => {
      const { spawnFn } = makeMockSpawn()
      const mgr = new LspManager({ _spawnFn: spawnFn })
      mgr.register(tsDef)

      const client = await mgr.clientFor('/tmp/a.ts')
      const tracker = mgr.trackerFor(client!)
      expect(tracker).toBeDefined()
    })

    it('returns the same tracker on repeated calls', async () => {
      const { spawnFn } = makeMockSpawn()
      const mgr = new LspManager({ _spawnFn: spawnFn })
      mgr.register(tsDef)

      const client = await mgr.clientFor('/tmp/a.ts')
      expect(mgr.trackerFor(client!)).toBe(mgr.trackerFor(client!))
    })
  })

  describe('notifyFileChanged()', () => {
    it('sends applyChange to tracker for an open file', async () => {
      const { spawnFn } = makeMockSpawn()
      const mgr = new LspManager({ _spawnFn: spawnFn })
      mgr.register(tsDef)

      const client = await mgr.clientFor('/tmp/a.ts')
      const tracker = mgr.trackerFor(client!)

      // Simulate the client being ready (already is after clientFor)
      const { pathToFileURL } = await import('node:url')
      const uri = pathToFileURL('/tmp/a.ts').href
      await tracker.ensureOpen(uri, 'const x = 1', 'typescript')

      const applyChangeSpy = vi.spyOn(tracker, 'applyChange')
      mgr.notifyFileChanged('/tmp/a.ts', 'const x = 2')

      // Wait for microtask
      await new Promise(r => setImmediate(r))
      expect(applyChangeSpy).toHaveBeenCalledWith(uri, 'const x = 2')
    })

    it('is a no-op for files not tracked by any client', async () => {
      const { spawnFn } = makeMockSpawn()
      const mgr = new LspManager({ _spawnFn: spawnFn })
      mgr.register(tsDef)

      // Don't open any documents
      mgr.notifyFileChanged('/tmp/a.ts', 'new text')
      // No error should be thrown
    })
  })

  describe('closeAll()', () => {
    it('shuts down all spawned clients', async () => {
      const { spawnFn, processes } = makeMockSpawn()
      const mgr = new LspManager({ _spawnFn: spawnFn })
      mgr.register(tsDef)
      mgr.register(jsDef)

      await mgr.clientFor('/tmp/a.ts')
      await mgr.clientFor('/tmp/b.js')
      expect(spawnFn).toHaveBeenCalledTimes(2)

      // Respond to shutdown requests
      const closeAllPromise = mgr.closeAll()
      await new Promise(r => setImmediate(r))

      // Push shutdown responses for both clients (ids=2 for both since each has its own client)
      for (const { stdout } of processes) {
        stdout.push(encodeMessage({ jsonrpc: '2.0', id: 2, result: null }))
      }

      // Simulate exits
      setImmediate(() => {
        for (const { cp } of processes) {
          (cp as EventEmitter).emit('exit', 0, null)
        }
      })

      await closeAllPromise
    })

    it('is a no-op when no clients are spawned', async () => {
      const mgr = new LspManager()
      await expect(mgr.closeAll()).resolves.toBeUndefined()
    })
  })
})
