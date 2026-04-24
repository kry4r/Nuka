import { describe, it, expect, vi, beforeEach } from 'vitest'

// Use vi.hoisted to declare mocks that will be referenced in vi.mock factory
const mocks = vi.hoisted(() => {
  let fakeConnectError: Error | null = null
  let fakeCallToolResult: { content: unknown[]; isError?: boolean } = {
    content: [{ type: 'text', text: 'hello' }],
  }
  let fakeReadResourceResult: { contents: unknown[] } = {
    contents: [{ uri: 'res://a', text: 'body text' }],
  }
  const fakeListToolsResult = {
    tools: [{ name: 'foo', description: 'does foo', inputSchema: { type: 'object', properties: {} } }],
  }
  const fakeListResourcesResult = {
    resources: [{ uri: 'res://a', name: 'a', mimeType: 'text/plain', description: 'resource a' }],
  }

  const sdkInstances: Array<{
    connect: ReturnType<typeof vi.fn>
    listTools: ReturnType<typeof vi.fn>
    listResources: ReturnType<typeof vi.fn>
    callTool: ReturnType<typeof vi.fn>
    readResource: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
  }> = []

  const FakeClient = vi.fn().mockImplementation(() => {
    const instance = {
      connect: vi.fn().mockImplementation(async () => {
        if (fakeConnectError) throw fakeConnectError
      }),
      listTools: vi.fn().mockResolvedValue(fakeListToolsResult),
      listResources: vi.fn().mockResolvedValue(fakeListResourcesResult),
      callTool: vi.fn().mockImplementation(async () => fakeCallToolResult),
      readResource: vi.fn().mockImplementation(async () => fakeReadResourceResult),
      close: vi.fn().mockResolvedValue(undefined),
    }
    sdkInstances.push(instance)
    return instance
  })

  const FakeStdio = vi.fn().mockImplementation(() => ({}))
  const FakeHttp = vi.fn().mockImplementation(() => ({}))

  return {
    FakeClient,
    FakeStdio,
    FakeHttp,
    sdkInstances,
    setConnectError(e: Error | null) { fakeConnectError = e },
    setCallToolResult(r: { content: unknown[]; isError?: boolean }) { fakeCallToolResult = r },
    setReadResourceResult(r: { contents: unknown[] }) { fakeReadResourceResult = r },
    clearInstances() { sdkInstances.length = 0 },
  }
})

vi.mock('../../../src/core/mcp/sdkBridge', () => ({
  Client: mocks.FakeClient,
  StdioClientTransport: mocks.FakeStdio,
  StreamableHTTPClientTransport: mocks.FakeHttp,
}))

import { McpClient } from '../../../src/core/mcp/client'

describe('McpClient status transitions', () => {
  beforeEach(() => {
    mocks.setConnectError(null)
    mocks.FakeClient.mockClear()
    mocks.FakeStdio.mockClear()
    mocks.FakeHttp.mockClear()
    mocks.clearInstances()
  })

  it('transitions idle → connecting → connected on successful connect', async () => {
    const statuses: string[] = []
    const client = new McpClient({
      name: 'srv',
      config: { type: 'stdio', command: 'node', args: [] },
      onStatusChange: s => statuses.push(s.kind),
    })
    expect(client.status.kind).toBe('idle')
    await client.connect()
    expect(statuses).toEqual(['connecting', 'connected'])
    expect(client.status.kind).toBe('connected')
  })

  it('sets connected with tool and resource counts', async () => {
    const client = new McpClient({
      name: 'srv',
      config: { type: 'stdio', command: 'node', args: [] },
    })
    await client.connect()
    const s = client.status
    expect(s.kind).toBe('connected')
    if (s.kind === 'connected') {
      expect(s.toolCount).toBe(1)
      expect(s.resourceCount).toBe(1)
    }
  })

  it('transitions to error and does NOT throw when connect fails', async () => {
    mocks.setConnectError(new Error('spawn failed'))
    const statuses: string[] = []
    const client = new McpClient({
      name: 'srv',
      config: { type: 'stdio', command: 'missing', args: [] },
      onStatusChange: s => statuses.push(s.kind),
    })
    await expect(client.connect()).resolves.toBeUndefined()
    expect(statuses).toEqual(['connecting', 'error'])
    const s = client.status
    expect(s.kind).toBe('error')
    if (s.kind === 'error') {
      expect(s.error).toContain('spawn failed')
    }
  })

  it('uses http transport for http config', async () => {
    const client = new McpClient({
      name: 'remote',
      config: { type: 'http', url: 'http://localhost:4000/mcp', headers: { 'x-key': 'v' } },
    })
    await client.connect()
    expect(mocks.FakeHttp).toHaveBeenCalledOnce()
    expect(mocks.FakeStdio).not.toHaveBeenCalled()
  })
})

describe('McpClient listTools caching', () => {
  beforeEach(() => {
    mocks.setConnectError(null)
    mocks.FakeClient.mockClear()
    mocks.clearInstances()
  })

  it('caches the result — second call does not re-hit the SDK', async () => {
    const client = new McpClient({
      name: 'srv',
      config: { type: 'stdio', command: 'node', args: [] },
    })
    await client.connect()
    const sdkInstance = mocks.sdkInstances[0]!
    sdkInstance.listTools.mockClear()

    const t1 = await client.listTools()
    const t2 = await client.listTools()
    expect(t1).toBe(t2)
    expect(sdkInstance.listTools).toHaveBeenCalledTimes(0) // populated during connect
  })
})

describe('McpClient callTool', () => {
  beforeEach(() => {
    mocks.setConnectError(null)
    mocks.FakeClient.mockClear()
    mocks.clearInstances()
  })

  it('translates mixed text + image content blocks to a string', async () => {
    mocks.setCallToolResult({
      content: [
        { type: 'text', text: 'line1' },
        { type: 'image', mimeType: 'image/png', data: 'abc123' },
        { type: 'resource_link', uri: 'res://x' },
        { type: 'mystery' },
      ],
      isError: false,
    })
    const client = new McpClient({
      name: 'srv',
      config: { type: 'stdio', command: 'node', args: [] },
    })
    await client.connect()
    const result = await client.callTool('foo', {})
    expect(result.output).toBe('line1\n[binary: image/png len=6]\n[resource: res://x]\n[unknown content block]')
    expect(result.isError).toBe(false)
  })

  it('preserves isError: true from the SDK', async () => {
    mocks.setCallToolResult({
      content: [{ type: 'text', text: 'bad input' }],
      isError: true,
    })
    const client = new McpClient({
      name: 'srv',
      config: { type: 'stdio', command: 'node', args: [] },
    })
    await client.connect()
    const result = await client.callTool('foo', {})
    expect(result.isError).toBe(true)
  })
})

describe('McpClient readResource', () => {
  beforeEach(() => {
    mocks.setConnectError(null)
    mocks.FakeClient.mockClear()
    mocks.clearInstances()
  })

  it('joins text contents', async () => {
    mocks.setReadResourceResult({
      contents: [
        { uri: 'res://a', text: 'part one' },
        { uri: 'res://a', text: 'part two' },
      ],
    })
    const client = new McpClient({
      name: 'srv',
      config: { type: 'stdio', command: 'node', args: [] },
    })
    await client.connect()
    const result = await client.readResource('res://a')
    expect(result.output).toBe('part one\npart two')
    expect(result.isError).toBe(false)
  })

  it('summarizes blob contents', async () => {
    mocks.setReadResourceResult({
      contents: [{ uri: 'res://b', mimeType: 'application/octet-stream', blob: 'AABBCC' }],
    })
    const client = new McpClient({
      name: 'srv',
      config: { type: 'stdio', command: 'node', args: [] },
    })
    await client.connect()
    const result = await client.readResource('res://b')
    expect(result.output).toBe('[blob: application/octet-stream len=6]')
  })
})
