import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mock for McpClient — same pattern as manager.test.ts
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const failNames = new Set<string>()
  const clients: Array<{
    name: string
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
        get _status() { return status_ },
        get status() { return status_ },
        connect: vi.fn().mockImplementation(async () => {
          if (failNames.has(name)) {
            status_ = { kind: 'error', error: 'refused' }
            opts.onStatusChange?.({ kind: 'error', error: 'refused' })
            return
          }
          status_ = { kind: 'connected', toolCount: 2, resourceCount: 0 }
          opts.onStatusChange?.({ kind: 'connected', toolCount: 2, resourceCount: 0 })
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
    failNames,
    reset() {
      failNames.clear()
      clients.length = 0
      FakeClientCtor.mockClear()
    },
  }
})

vi.mock('../../../src/core/mcp/client', () => ({
  McpClient: mocks.FakeClientCtor,
}))

import { McpManager } from '../../../src/core/mcp/manager'

describe('McpManager.addServer / removeServer', () => {
  beforeEach(() => {
    mocks.reset()
    McpManager.clearServerCache()
  })

  it('addServer creates a new client and connects it', async () => {
    const mgr = new McpManager({ servers: {} })
    await mgr.addServer('myIde', { type: 'sse', url: 'http://localhost:4096/mcp' })

    expect(mocks.FakeClientCtor).toHaveBeenCalledTimes(1)
    const client = mgr.findClient('myIde')
    expect(client).toBeDefined()
    expect(client?.status.kind).toBe('connected')
  })

  it('addServer replaces an existing client with the same name', async () => {
    const mgr = new McpManager({ servers: {} })
    await mgr.addServer('myIde', { type: 'sse', url: 'http://localhost:4096/mcp' })
    expect(mocks.FakeClientCtor).toHaveBeenCalledTimes(1)

    // Add again with a different URL — should replace.
    await mgr.addServer('myIde', { type: 'sse', url: 'http://localhost:4097/mcp' })
    expect(mocks.FakeClientCtor).toHaveBeenCalledTimes(2)
    expect(mgr.listClients().filter(c => c.name === 'myIde')).toHaveLength(1)
  })

  it('addServer closes the old client before creating a new one', async () => {
    const mgr = new McpManager({ servers: {} })
    await mgr.addServer('myIde', { type: 'sse', url: 'http://localhost:4096/mcp' })
    const oldClient = mocks.clients[0]!

    await mgr.addServer('myIde', { type: 'sse', url: 'http://localhost:4097/mcp' })
    expect(oldClient.close).toHaveBeenCalledTimes(1)
  })

  it('addServer does not throw when connect fails', async () => {
    mocks.failNames.add('badIde')
    const mgr = new McpManager({ servers: {} })
    await expect(
      mgr.addServer('badIde', { type: 'sse', url: 'http://localhost:4096/mcp' }),
    ).resolves.toBeUndefined()
    expect(mgr.findClient('badIde')?.status.kind).toBe('error')
  })

  it('removeServer shuts down and removes the client', async () => {
    const mgr = new McpManager({ servers: {} })
    await mgr.addServer('myIde', { type: 'sse', url: 'http://localhost:4096/mcp' })
    const client = mocks.clients[0]!

    await mgr.removeServer('myIde')
    expect(client.close).toHaveBeenCalledTimes(1)
    expect(mgr.findClient('myIde')).toBeUndefined()
    expect(mgr.listClients()).toHaveLength(0)
  })

  it('removeServer is a no-op for unknown names', async () => {
    const mgr = new McpManager({ servers: {} })
    await expect(mgr.removeServer('ghost')).resolves.toBeUndefined()
  })

  it('addServer notifies onChange listeners', async () => {
    const mgr = new McpManager({ servers: {} })
    const fired: number[] = []
    mgr.onChange(() => fired.push(1))

    await mgr.addServer('myIde', { type: 'sse', url: 'http://localhost:4096/mcp' })
    expect(fired.length).toBeGreaterThan(0)
  })

  it('removeServer notifies onChange listeners', async () => {
    const mgr = new McpManager({ servers: {} })
    await mgr.addServer('myIde', { type: 'sse', url: 'http://localhost:4096/mcp' })

    const fired: number[] = []
    mgr.onChange(() => fired.push(1))
    await mgr.removeServer('myIde')
    expect(fired.length).toBeGreaterThan(0)
  })

  it('addServer appends alongside existing clients', async () => {
    const mgr = new McpManager({
      servers: { existing: { type: 'stdio', command: 'node', args: [] } },
    })
    await mgr.addServer('dynamic', { type: 'sse', url: 'http://localhost:4096/mcp' })
    expect(mgr.listClients()).toHaveLength(2)
    expect(mgr.findClient('existing')).toBeDefined()
    expect(mgr.findClient('dynamic')).toBeDefined()
  })
})
