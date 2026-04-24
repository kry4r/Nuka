import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => {
  const failServers = new Set<string>()

  // Each created client gets tracked here
  const clients: Array<{
    name: string
    statusCb: ((s: unknown) => void) | undefined
    _status: { kind: string; toolCount?: number; resourceCount?: number; error?: string }
    connect: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    get status(): { kind: string }
  }> = []

  const FakeClientCtor = vi.fn().mockImplementation(
    (opts: { name: string; config: unknown; onStatusChange?: (s: unknown) => void }) => {
      const name = opts.name
      let status_: { kind: string; toolCount?: number; resourceCount?: number; error?: string } = {
        kind: 'idle',
      }
      const instance = {
        name,
        statusCb: opts.onStatusChange,
        get _status() { return status_ },
        get status() { return status_ },
        connect: vi.fn().mockImplementation(async () => {
          status_ = { kind: 'connecting' }
          opts.onStatusChange?.({ kind: 'connecting' })
          if (failServers.has(name)) {
            status_ = { kind: 'error', error: 'refused' }
            opts.onStatusChange?.({ kind: 'error', error: 'refused' })
            return
          }
          status_ = { kind: 'connected', toolCount: 1, resourceCount: 0 }
          opts.onStatusChange?.({ kind: 'connected', toolCount: 1, resourceCount: 0 })
        }),
        close: vi.fn().mockResolvedValue(undefined),
      }
      clients.push(instance)
      return instance
    },
  )

  return {
    FakeClientCtor,
    clients,
    failServers,
    reset() {
      failServers.clear()
      clients.length = 0
      FakeClientCtor.mockClear()
    },
  }
})

vi.mock('../../../src/core/mcp/client', () => ({
  McpClient: mocks.FakeClientCtor,
}))

import { McpManager } from '../../../src/core/mcp/manager'

describe('McpManager', () => {
  beforeEach(() => {
    mocks.reset()
    // Clear the static LRU cache between tests to prevent cross-test pollution.
    McpManager.clearServerCache()
  })

  it('startAll resolves even when one server fails to connect', async () => {
    mocks.failServers.add('bad')
    const mgr = new McpManager({
      servers: {
        good: { type: 'stdio', command: 'node', args: [] },
        bad: { type: 'stdio', command: 'missing', args: [] },
      },
    })
    await expect(mgr.startAll()).resolves.toBeUndefined()
  })

  it('status() reports outcomes for both servers after startAll', async () => {
    mocks.failServers.add('bad')
    const mgr = new McpManager({
      servers: {
        good: { type: 'stdio', command: 'node', args: [] },
        bad: { type: 'stdio', command: 'missing', args: [] },
      },
    })
    await mgr.startAll()
    const st = mgr.status()
    expect(st).toHaveLength(2)
    const goodEntry = st.find(s => s.name === 'good')
    const badEntry = st.find(s => s.name === 'bad')
    expect(goodEntry?.status.kind).toBe('connected')
    expect(badEntry?.status.kind).toBe('error')
  })

  it('onChange fires when a client status changes', async () => {
    const mgr = new McpManager({
      servers: { srv: { type: 'stdio', command: 'node', args: [] } },
    })
    const fired: number[] = []
    mgr.onChange(() => fired.push(1))
    await mgr.startAll()
    expect(fired.length).toBeGreaterThan(0)
  })

  it('onChange returns an unsubscriber that stops notifications', async () => {
    const mgr = new McpManager({
      servers: { srv: { type: 'stdio', command: 'node', args: [] } },
    })
    const fired: number[] = []
    const unsub = mgr.onChange(() => fired.push(1))
    unsub()
    await mgr.startAll()
    expect(fired).toHaveLength(0)
  })

  it('findClient returns the client by name', () => {
    const mgr = new McpManager({
      servers: { myServer: { type: 'stdio', command: 'node', args: [] } },
    })
    const c = mgr.findClient('myServer')
    expect(c).toBeDefined()
    expect(c?.name).toBe('myServer')
  })

  it('findClient returns undefined for unknown name', () => {
    const mgr = new McpManager({ servers: {} })
    expect(mgr.findClient('nope')).toBeUndefined()
  })

  it('listClients returns all clients', () => {
    const mgr = new McpManager({
      servers: {
        a: { type: 'stdio', command: 'node', args: [] },
        b: { type: 'http', url: 'http://localhost:4000' },
      },
    })
    expect(mgr.listClients()).toHaveLength(2)
  })

  it('closeAll settles even if close throws', async () => {
    const mgr = new McpManager({
      servers: { srv: { type: 'stdio', command: 'node', args: [] } },
    })
    await mgr.startAll()
    await expect(mgr.closeAll()).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// M1.17 — LRU connection cache
// ---------------------------------------------------------------------------
describe('McpManager LRU cache', () => {
  beforeEach(() => {
    mocks.reset()
    McpManager.clearServerCache()
  })

  it('startAll called twice with identical config reuses cached client (no new constructor call)', async () => {
    const config = { type: 'stdio' as const, command: 'node', args: [] as string[] }

    const mgr1 = new McpManager({ servers: { srv: config } })
    await mgr1.startAll()
    // First call: FakeClientCtor called once
    expect(mocks.FakeClientCtor).toHaveBeenCalledTimes(1)

    // Second manager with the same config should reuse the cached client.
    const mgr2 = new McpManager({ servers: { srv: config } })
    await mgr2.startAll()
    // Still only 1 constructor call total.
    expect(mocks.FakeClientCtor).toHaveBeenCalledTimes(1)
    // Both managers see the same client instance.
    expect(mgr1.findClient('srv')).toBe(mgr2.findClient('srv'))
  })

  it('config change between calls triggers a cache miss and new client', async () => {
    const config1 = { type: 'stdio' as const, command: 'node', args: [] as string[] }
    const config2 = { type: 'stdio' as const, command: 'python', args: [] as string[] }

    const mgr1 = new McpManager({ servers: { srv: config1 } })
    await mgr1.startAll()
    expect(mocks.FakeClientCtor).toHaveBeenCalledTimes(1)

    const mgr2 = new McpManager({ servers: { srv: config2 } })
    await mgr2.startAll()
    // Different config hash → new client.
    expect(mocks.FakeClientCtor).toHaveBeenCalledTimes(2)
    expect(mgr1.findClient('srv')).not.toBe(mgr2.findClient('srv'))
  })

  it('clearServerCache(name) removes only that server', async () => {
    const config = { type: 'stdio' as const, command: 'node', args: [] as string[] }

    // Populate cache with two servers.
    const mgr1 = new McpManager({ servers: { foo: config, bar: config } })
    await mgr1.startAll()
    expect(mocks.FakeClientCtor).toHaveBeenCalledTimes(2)

    // Clear only 'foo'.
    McpManager.clearServerCache('foo')

    const mgr2 = new McpManager({ servers: { foo: config, bar: config } })
    await mgr2.startAll()
    // 'foo' was cleared → new client; 'bar' was cached → reused.
    expect(mocks.FakeClientCtor).toHaveBeenCalledTimes(3)
  })

  it('clearServerCache() with no arg clears all', async () => {
    const config = { type: 'stdio' as const, command: 'node', args: [] as string[] }

    const mgr1 = new McpManager({ servers: { a: config, b: config } })
    await mgr1.startAll()
    expect(mocks.FakeClientCtor).toHaveBeenCalledTimes(2)

    McpManager.clearServerCache()

    const mgr2 = new McpManager({ servers: { a: config, b: config } })
    await mgr2.startAll()
    // Both cleared → 2 new clients.
    expect(mocks.FakeClientCtor).toHaveBeenCalledTimes(4)
  })

  it('discards cached client in error state and creates a new one', async () => {
    mocks.failServers.add('srv')
    const config = { type: 'stdio' as const, command: 'node', args: [] as string[] }

    const mgr1 = new McpManager({ servers: { srv: config } })
    await mgr1.startAll()
    expect(mocks.FakeClientCtor).toHaveBeenCalledTimes(1)
    // Client is in error state.
    expect(mgr1.findClient('srv')?.status.kind).toBe('error')

    // Second manager should NOT reuse the errored client.
    const mgr2 = new McpManager({ servers: { srv: config } })
    expect(mocks.FakeClientCtor).toHaveBeenCalledTimes(2)
    expect(mgr2.findClient('srv')).not.toBe(mgr1.findClient('srv'))
  })
})
