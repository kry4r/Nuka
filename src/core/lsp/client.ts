// src/core/lsp/client.ts
// LspClient — manages the lifecycle of a single LSP server child process
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { MessageStream } from './jsonrpc'
import { encodeMessage } from './jsonrpc'
import type { JsonRpcResponse, JsonRpcNotification } from './jsonrpc'
import type { LspServerDef, LspDiagnostic } from './types'

export type LspClientStatus = 'idle' | 'starting' | 'ready' | 'error' | 'closed'

type SpawnFn = typeof spawn

export class LspClient {
  private readonly _def: LspServerDef
  private readonly _rootUri: string
  private readonly _spawnFn: SpawnFn

  private _cp: ChildProcess | null = null
  private _stream: MessageStream = new MessageStream()
  private _nextId = 1
  private _pending: Map<number, { resolve: (r: unknown) => void; reject: (e: Error) => void }> = new Map()
  private _diagnostics: Map<string, LspDiagnostic[]> = new Map()
  private _subscribers: Map<string, Set<(diags: LspDiagnostic[]) => void>> = new Map()
  private _status: LspClientStatus = 'idle'

  constructor(opts: {
    def: LspServerDef
    rootUri?: string
    /** @internal for testing only */
    _spawnFn?: SpawnFn
  }) {
    this._def = opts.def
    this._rootUri = opts.rootUri ?? pathToFileURL(process.cwd()).href
    this._spawnFn = opts._spawnFn ?? spawn
  }

  get status(): LspClientStatus {
    return this._status
  }

  /** Spawn the child process, send initialize, await response, send initialized. */
  async start(): Promise<void> {
    if (this._status !== 'idle') {
      throw new Error(`LspClient.start() called in state '${this._status}'`)
    }
    this._status = 'starting'

    const { command, args = [], env } = this._def
    const cp = this._spawnFn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    })
    this._cp = cp

    // Pipe stderr to our stderr with a prefix (best-effort logging)
    cp.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(`[lsp:${this._def.name}] ${chunk.toString()}`)
    })

    // Attach stream to stdout
    cp.stdout?.on('data', (chunk: Buffer) => {
      this._stream.push(chunk)
      for (const msg of this._stream.read()) {
        this._dispatch(msg)
      }
    })

    return new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (err?: Error) => {
        if (settled) return
        settled = true
        if (err) {
          this._status = 'error'
          reject(err)
        } else {
          this._status = 'ready'
          resolve()
        }
      }

      cp.on('error', (err: Error) => {
        finish(new Error(`LSP server '${this._def.name}' failed to spawn: ${err.message}`))
      })

      cp.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
        if (this._status !== 'ready' && this._status !== 'closed') {
          finish(new Error(`LSP server '${this._def.name}' exited prematurely: code=${code} signal=${signal}`))
        }
        this._onExit()
      })

      const initId = this._nextId++
      const timeout = setTimeout(() => {
        this._pending.delete(initId)
        finish(new Error(`LSP server '${this._def.name}' initialize timed out after 10s`))
      }, 10_000)

      this._pending.set(initId, {
        resolve: () => {
          clearTimeout(timeout)
          // Send initialized notification
          this._writeRaw(encodeMessage({ jsonrpc: '2.0', method: 'initialized', params: {} }))
          finish()
        },
        reject: (err: Error) => {
          clearTimeout(timeout)
          finish(err)
        },
      })

      // Send initialize request
      const initRequest = {
        jsonrpc: '2.0',
        id: initId,
        method: 'initialize',
        params: {
          processId: process.pid,
          rootUri: this._rootUri,
          initializationOptions: this._def.initializationOptions,
          capabilities: {
            textDocument: {
              synchronization: {
                dynamicRegistration: false,
                didOpen: true,
                didChange: 2, // Full sync
                didClose: true,
              },
              publishDiagnostics: { relatedInformation: false },
              definition: { dynamicRegistration: false },
              references: { dynamicRegistration: false },
            },
          },
        },
      }
      this._writeRaw(encodeMessage(initRequest))
    })
  }

  /** Send a JSON-RPC request and await the response. */
  async request<T>(method: string, params?: unknown, timeoutMs = 30_000): Promise<T> {
    if (this._status !== 'ready') {
      throw new Error(`LspClient not ready (status='${this._status}')`)
    }
    const id = this._nextId++
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._pending.delete(id)
        reject(new Error(`LSP request '${method}' timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      this._pending.set(id, {
        resolve: (r: unknown) => { clearTimeout(timeout); resolve(r as T) },
        reject: (e: Error) => { clearTimeout(timeout); reject(e) },
      })

      this._writeRaw(encodeMessage({ jsonrpc: '2.0', id, method, params }))
    })
  }

  /** Send a JSON-RPC notification (fire-and-forget). */
  notify(method: string, params?: unknown): void {
    if (this._status !== 'ready') {
      throw new Error(`LspClient not ready (status='${this._status}')`)
    }
    this._writeRaw(encodeMessage({ jsonrpc: '2.0', method, params }))
  }

  /** Returns buffered diagnostics for a URI (populated by publishDiagnostics notifications). */
  diagnosticsFor(uri: string): LspDiagnostic[] {
    return this._diagnostics.get(uri) ?? []
  }

  /**
   * Subscribe to diagnostics updates for a URI.
   * Returns an unsubscribe function.
   */
  onDiagnostics(uri: string, cb: (diags: LspDiagnostic[]) => void): () => void {
    let set = this._subscribers.get(uri)
    if (!set) {
      set = new Set()
      this._subscribers.set(uri, set)
    }
    set.add(cb)
    return () => set!.delete(cb)
  }

  /** Send shutdown request + exit notification; SIGKILL after 3s if process doesn't die. */
  async shutdown(): Promise<void> {
    if (this._status === 'closed' || this._status === 'idle') return

    if (this._status === 'ready') {
      try {
        await this.request('shutdown', undefined, 5_000)
      } catch {
        // Best-effort — proceed regardless
      }
      // Send exit notification directly (not via notify() which checks status)
      this._writeRaw(encodeMessage({ jsonrpc: '2.0', method: 'exit', params: undefined }))
    }

    this._status = 'closed'
    this._rejectPending(new Error('LspClient shutting down'))

    if (this._cp) {
      const cp = this._cp
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => { cp.kill('SIGKILL'); resolve() }, 3_000)
        cp.once('exit', () => { clearTimeout(timer); resolve() })
      })
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private _writeRaw(buf: Buffer): void {
    this._cp?.stdin?.write(buf)
  }

  private _onExit(): void {
    this._status = 'closed'
    this._rejectPending(new Error(`LSP server '${this._def.name}' process exited`))
  }

  private _rejectPending(err: Error): void {
    for (const { reject } of this._pending.values()) {
      reject(err)
    }
    this._pending.clear()
  }

  private _dispatch(msg: JsonRpcResponse | JsonRpcNotification): void {
    if ('id' in msg && typeof msg.id === 'number') {
      // Response
      const handler = this._pending.get(msg.id)
      if (handler) {
        this._pending.delete(msg.id)
        if (msg.error) {
          handler.reject(new Error(`LSP error ${msg.error.code}: ${msg.error.message}`))
        } else {
          handler.resolve(msg.result)
        }
      }
    } else if ('method' in msg) {
      // Notification
      this._handleNotification(msg as JsonRpcNotification)
    }
  }

  private _handleNotification(notif: JsonRpcNotification): void {
    if (notif.method === 'textDocument/publishDiagnostics') {
      const params = notif.params as { uri: string; diagnostics: LspDiagnostic[] } | undefined
      if (!params) return
      const { uri, diagnostics } = params
      this._diagnostics.set(uri, diagnostics)
      const subs = this._subscribers.get(uri)
      if (subs) {
        for (const cb of subs) {
          cb(diagnostics)
        }
      }
    }
    // Other notifications ignored for now
  }
}
