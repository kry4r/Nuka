import { describe, it, expect, vi } from 'vitest'
import { makeListMcpResourcesTool, makeReadMcpResourceTool } from '../../../src/core/mcp/resourceTools'
import type { McpManager } from '../../../src/core/mcp/manager'
import type { McpClient } from '../../../src/core/mcp/client'

function makeClient(
  name: string,
  connected: boolean,
  resources: Array<{ uri: string; name: string; server: string }> = [],
  readResult: { output: string; isError: boolean } = { output: 'content', isError: false },
): McpClient {
  return {
    name,
    status: connected ? { kind: 'connected', toolCount: 0, resourceCount: resources.length } : { kind: 'idle' },
    listResources: vi.fn().mockResolvedValue(resources),
    readResource: vi.fn().mockResolvedValue(readResult),
  } as unknown as McpClient
}

function makeManager(clients: McpClient[]): McpManager {
  return {
    listClients: () => clients,
    findClient: (name: string) => clients.find(c => c.name === name),
    status: () => clients.map(c => ({ name: c.name, status: c.status })),
  } as unknown as McpManager
}

const ctx = { signal: new AbortController().signal, cwd: '/tmp' }

describe('makeListMcpResourcesTool', () => {
  it('flattens resources from all connected clients', async () => {
    const r1 = { uri: 'file://a', name: 'A', server: 'srv1' }
    const r2 = { uri: 'file://b', name: 'B', server: 'srv2' }
    const manager = makeManager([
      makeClient('srv1', true, [r1]),
      makeClient('srv2', true, [r2]),
    ])
    const tool = makeListMcpResourcesTool(manager)
    const result = await tool.run({}, ctx)
    expect(result.isError).toBe(false)
    const parsed = JSON.parse(result.output)
    expect(parsed).toHaveLength(2)
    expect(parsed).toEqual(expect.arrayContaining([r1, r2]))
  })

  it('skips disconnected clients', async () => {
    const r1 = { uri: 'file://a', name: 'A', server: 'srv1' }
    const manager = makeManager([
      makeClient('srv1', true, [r1]),
      makeClient('srv2', false),
    ])
    const tool = makeListMcpResourcesTool(manager)
    const result = await tool.run({}, ctx)
    expect(result.isError).toBe(false)
    const parsed = JSON.parse(result.output)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toEqual(r1)
  })

  it('filters by server name when provided', async () => {
    const r1 = { uri: 'file://a', name: 'A', server: 'srv1' }
    const r2 = { uri: 'file://b', name: 'B', server: 'srv2' }
    const manager = makeManager([
      makeClient('srv1', true, [r1]),
      makeClient('srv2', true, [r2]),
    ])
    const tool = makeListMcpResourcesTool(manager)
    const result = await tool.run({ server: 'srv1' }, ctx)
    expect(result.isError).toBe(false)
    const parsed = JSON.parse(result.output)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toEqual(r1)
  })

  it('returns error when server filter matches nothing', async () => {
    const manager = makeManager([makeClient('srv1', true, [])])
    const tool = makeListMcpResourcesTool(manager)
    const result = await tool.run({ server: 'unknown' }, ctx)
    expect(result.isError).toBe(true)
    expect(result.output).toContain("server 'unknown' not found")
    expect(result.output).toContain('srv1')
  })

  it('returns error mentioning (none) when no clients at all', async () => {
    const manager = makeManager([])
    const tool = makeListMcpResourcesTool(manager)
    const result = await tool.run({ server: 'missing' }, ctx)
    expect(result.isError).toBe(true)
    expect(result.output).toContain('(none)')
  })
})

describe('makeReadMcpResourceTool', () => {
  it('routes to the matching client and returns its result', async () => {
    const client = makeClient('srv1', true, [], { output: 'hello', isError: false })
    const manager = makeManager([client])
    const tool = makeReadMcpResourceTool(manager)
    const result = await tool.run({ server: 'srv1', uri: 'file://x' }, ctx)
    expect(result.isError).toBe(false)
    expect(result.output).toBe('hello')
    expect(client.readResource).toHaveBeenCalledWith('file://x', ctx.signal)
  })

  it('returns error for unknown server', async () => {
    const manager = makeManager([makeClient('srv1', true)])
    const tool = makeReadMcpResourceTool(manager)
    const result = await tool.run({ server: 'nope', uri: 'file://x' }, ctx)
    expect(result.isError).toBe(true)
    expect(result.output).toContain('unknown server: nope')
  })

  it('returns error when server is not connected', async () => {
    const client = makeClient('srv1', false)
    const manager = makeManager([client])
    const tool = makeReadMcpResourceTool(manager)
    const result = await tool.run({ server: 'srv1', uri: 'file://x' }, ctx)
    expect(result.isError).toBe(true)
    expect(result.output).toContain("server 'srv1' is not connected")
  })
})
