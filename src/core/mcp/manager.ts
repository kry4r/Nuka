import type { McpServerConfig, McpConnectionStatus } from './types'
import type { PermissionBridge } from '../permission/bridge'
import { McpClient } from './client'
import { LruMap, configHash } from './lruCache'

/** Default capacity for the connection cache. */
const DEFAULT_CACHE_MAX = 32

export class McpManager {
  private clients: McpClient[]
  private listeners: Array<() => void> = []
  private opts: {
    maxResultChars?: number
    connectTimeoutMs?: number
    requestTimeoutMs?: number
    permissionBridge?: PermissionBridge
  }

  /**
   * LRU cache keyed by `name::configHash`.  Stores live `McpClient` instances
   * so that `startAll` can reuse an already-connected client when the server
   * configuration has not changed between calls.
   */
  private static cache = new LruMap<string, McpClient>(DEFAULT_CACHE_MAX)

  constructor(opts: {
    servers: Record<string, McpServerConfig>
    maxResultChars?: number
    connectTimeoutMs?: number
    requestTimeoutMs?: number
    permissionBridge?: PermissionBridge
  }) {
    this.opts = {
      maxResultChars: opts.maxResultChars,
      connectTimeoutMs: opts.connectTimeoutMs,
      requestTimeoutMs: opts.requestTimeoutMs,
      permissionBridge: opts.permissionBridge,
    }
    this.clients = Object.entries(opts.servers).map(([name, config]) => {
      const cacheKey = `${name}::${configHash(config)}`
      const cached = McpManager.cache.get(cacheKey)
      // Reuse a live cached client; discard stale (error/idle) entries.
      if (cached && cached.status.kind !== 'error' && cached.status.kind !== 'idle') {
        return cached
      }
      const client = new McpClient({
        name,
        config,
        onStatusChange: () => this.notify(),
        maxResultChars: opts.maxResultChars,
        connectTimeoutMs: opts.connectTimeoutMs,
        requestTimeoutMs: opts.requestTimeoutMs,
        permissionBridge: opts.permissionBridge,
      })
      McpManager.cache.set(cacheKey, client)
      return client
    })
  }

  async startAll(): Promise<void> {
    await Promise.allSettled(
      this.clients.map(c => {
        // Already connected — skip reconnect to honour cache reuse.
        if (c.status.kind === 'connected') return Promise.resolve()
        return c.connect()
      }),
    )
  }

  status(): Array<{ name: string; status: McpConnectionStatus }> {
    return this.clients.map(c => ({ name: c.name, status: c.status }))
  }

  listClients(): McpClient[] {
    return [...this.clients]
  }

  findClient(name: string): McpClient | undefined {
    return this.clients.find(c => c.name === name)
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled(this.clients.map(c => c.close()))
  }

  /**
   * Dynamically register a new MCP server at runtime.
   *
   * If a client with the same `name` already exists it is closed first so the
   * call is idempotent / re-runnable with a new config.  The new client is
   * connected immediately (best-effort; errors are swallowed — the client
   * enters the `error` state but does not throw).
   */
  async addServer(name: string, def: McpServerConfig): Promise<void> {
    // Remove any existing client with this name first.
    await this._removeClientByName(name)

    const cacheKey = `${name}::${configHash(def)}`
    const cached = McpManager.cache.get(cacheKey)
    let client: McpClient
    if (cached && cached.status.kind !== 'error' && cached.status.kind !== 'idle') {
      client = cached
    } else {
      client = new McpClient({
        name,
        config: def,
        onStatusChange: () => this.notify(),
        ...this.opts,
      })
      McpManager.cache.set(cacheKey, client)
    }

    this.clients.push(client)
    this.notify()

    // Connect best-effort — errors land in client.status, not thrown.
    await client.connect().catch(() => {/* swallowed */})
  }

  /**
   * Shut down and remove a previously registered server by name.
   * No-op if the name is unknown.
   */
  async removeServer(name: string): Promise<void> {
    await this._removeClientByName(name)
    this.notify()
  }

  /** Internal helper: find, close, and splice out a client by name. */
  private async _removeClientByName(name: string): Promise<void> {
    const idx = this.clients.findIndex(c => c.name === name)
    if (idx === -1) return
    const [client] = this.clients.splice(idx, 1) as [McpClient]
    await client.close().catch(() => {/* swallowed */})
    McpManager.clearServerCache(name)
  }

  onChange(listener: () => void): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener)
    }
  }

  private notify(): void {
    for (const l of this.listeners) l()
  }

  /**
   * Invalidate cached connections.
   *
   * @param name  If provided, clears only the cache entries for that server
   *              name (all config hashes).  If omitted, clears the entire
   *              cache.
   */
  static clearServerCache(name?: string): void {
    if (name === undefined) {
      McpManager.cache.clear()
      return
    }
    // Collect keys to delete (can't mutate while iterating in all engines,
    // so build the list first).
    const toDelete: string[] = []
    for (const key of McpManager.cache.keys()) {
      if (key.startsWith(`${name}::`)) {
        toDelete.push(key)
      }
    }
    for (const key of toDelete) {
      McpManager.cache.delete(key)
    }
  }
}
