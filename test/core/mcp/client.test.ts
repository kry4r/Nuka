import { describe, it, expect, vi, beforeEach } from 'vitest'
import os from 'node:os'
import path from 'node:path'

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

  let fakeInstructions: string | undefined = undefined

  const sdkInstances: Array<{
    connect: ReturnType<typeof vi.fn>
    listTools: ReturnType<typeof vi.fn>
    listResources: ReturnType<typeof vi.fn>
    callTool: ReturnType<typeof vi.fn>
    readResource: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    getInstructions: ReturnType<typeof vi.fn>
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
      getInstructions: vi.fn().mockImplementation(() => fakeInstructions),
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
    setInstructions(s: string | undefined) { fakeInstructions = s },
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

  it('returns ContentBlock[] when response contains image blocks', async () => {
    // PNG 1x1 pixel in base64
    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    mocks.setCallToolResult({
      content: [
        { type: 'text', text: 'line1' },
        { type: 'image', mimeType: 'image/png', data: pngBase64 },
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
    expect(Array.isArray(result.output)).toBe(true)
    const blocks = result.output as import('../../../src/core/tools/content').ContentBlock[]
    expect(blocks[0]).toMatchObject({ type: 'text', text: 'line1' })
    expect(blocks[1]).toMatchObject({ type: 'image', mimeType: 'image/png' })
    const imageBlock = blocks[1] as { type: 'image'; path: string; mimeType: string }
    // File should have been written to ~/.nuka/tmp
    const expectedDir = path.join(os.homedir(), '.nuka', 'tmp')
    expect(imageBlock.path).toContain(expectedDir)
    expect(imageBlock.path).toMatch(/\.png$/)
    // File should exist on disk with correct binary content
    const { readFileSync } = await import('node:fs')
    const written = readFileSync(imageBlock.path)
    expect(written).toEqual(Buffer.from(pngBase64, 'base64'))
    expect(blocks[2]).toMatchObject({ type: 'resource', uri: 'res://x' })
    expect(blocks[3]).toMatchObject({ type: 'text', text: '[unknown content block]' })
    expect(result.isError).toBe(false)
  })

  it('returns plain string when no image blocks are present', async () => {
    mocks.setCallToolResult({
      content: [
        { type: 'text', text: 'line1' },
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
    expect(typeof result.output).toBe('string')
    expect(result.output).toBe('line1\n[resource: res://x]\n[unknown content block]')
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

describe('McpClient serverInstructions', () => {
  beforeEach(() => {
    mocks.setConnectError(null)
    mocks.setInstructions(undefined)
    mocks.FakeClient.mockClear()
    mocks.clearInstances()
  })

  it('captures instructions from the SDK after connect', async () => {
    mocks.setInstructions('use this server wisely')
    const client = new McpClient({
      name: 'srv',
      config: { type: 'stdio', command: 'node', args: [] },
    })
    await client.connect()
    expect(client.serverInstructions).toBe('use this server wisely')
  })

  it('truncates instructions to MAX_MCP_DESCRIPTION_CHARS', async () => {
    mocks.setInstructions('x'.repeat(5000))
    const client = new McpClient({
      name: 'srv',
      config: { type: 'stdio', command: 'node', args: [] },
    })
    await client.connect()
    const instructions = client.serverInstructions!
    expect(instructions.length).toBe(2048)
    expect(instructions.endsWith('…')).toBe(true)
  })

  it('leaves serverInstructions undefined when server provides none', async () => {
    const client = new McpClient({
      name: 'srv',
      config: { type: 'stdio', command: 'node', args: [] },
    })
    await client.connect()
    expect(client.serverInstructions).toBeUndefined()
  })
})

describe('McpClient timeouts', () => {
  beforeEach(() => {
    mocks.setConnectError(null)
    mocks.FakeClient.mockClear()
    mocks.clearInstances()
  })

  it('transitions to error with "connect timeout" when connect never resolves', async () => {
    // Swap FakeClient's connect with one that hangs.
    mocks.FakeClient.mockImplementationOnce(() => {
      const instance = {
        connect: vi.fn().mockImplementation(() => new Promise<void>(() => {})),
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
        listResources: vi.fn().mockResolvedValue({ resources: [] }),
        callTool: vi.fn(),
        readResource: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      }
      mocks.sdkInstances.push(instance as any)
      return instance
    })
    const client = new McpClient({
      name: 'srv',
      config: { type: 'stdio', command: 'node', args: [] },
      connectTimeoutMs: 20,
    })
    await client.connect()
    const s = client.status
    expect(s.kind).toBe('error')
    if (s.kind === 'error') expect(s.error).toBe('connect timeout')
  })

  it('returns a timeout tool result when callTool never resolves', async () => {
    mocks.setCallToolResult({ content: [{ type: 'text', text: 'ok' }] })
    mocks.FakeClient.mockImplementationOnce(() => {
      const instance = {
        connect: vi.fn().mockResolvedValue(undefined),
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
        listResources: vi.fn().mockResolvedValue({ resources: [] }),
        callTool: vi.fn().mockImplementation(() => new Promise(() => {})),
        readResource: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      }
      mocks.sdkInstances.push(instance as any)
      return instance
    })
    const client = new McpClient({
      name: 'srv',
      config: { type: 'stdio', command: 'node', args: [] },
      requestTimeoutMs: 20,
    })
    await client.connect()
    const res = await client.callTool('foo', {})
    expect(res.isError).toBe(true)
    expect(res.output).toBe('request timeout (20ms)')
  })

  it('returns a timeout tool result when readResource never resolves', async () => {
    mocks.FakeClient.mockImplementationOnce(() => {
      const instance = {
        connect: vi.fn().mockResolvedValue(undefined),
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
        listResources: vi.fn().mockResolvedValue({ resources: [] }),
        callTool: vi.fn(),
        readResource: vi.fn().mockImplementation(() => new Promise(() => {})),
        close: vi.fn().mockResolvedValue(undefined),
      }
      mocks.sdkInstances.push(instance as any)
      return instance
    })
    const client = new McpClient({
      name: 'srv',
      config: { type: 'stdio', command: 'node', args: [] },
      requestTimeoutMs: 20,
    })
    await client.connect()
    const res = await client.readResource('res://a')
    expect(res.isError).toBe(true)
    expect(res.output).toBe('request timeout (20ms)')
  })
})

describe('McpClient callTool truncation', () => {
  beforeEach(() => {
    mocks.setConnectError(null)
    mocks.FakeClient.mockClear()
    mocks.clearInstances()
  })

  it('truncates huge results to maxResultChars with a notice', async () => {
    const huge = 'a'.repeat(250_000)
    mocks.setCallToolResult({ content: [{ type: 'text', text: huge }], isError: false })
    const client = new McpClient({
      name: 'srv',
      config: { type: 'stdio', command: 'node', args: [] },
      maxResultChars: 100_000,
    })
    await client.connect()
    const result = await client.callTool('foo', {})
    expect(result.output.length).toBeGreaterThan(100_000)
    expect(result.output.length).toBeLessThan(100_100)
    expect(result.output).toMatch(/\.\.\.\[truncated 150000 chars of 250000\]\.\.\.$/)
  })

  it('passes below-limit results through unchanged', async () => {
    mocks.setCallToolResult({ content: [{ type: 'text', text: 'tiny' }], isError: false })
    const client = new McpClient({
      name: 'srv',
      config: { type: 'stdio', command: 'node', args: [] },
      maxResultChars: 100_000,
    })
    await client.connect()
    const result = await client.callTool('foo', {})
    expect(result.output).toBe('tiny')
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
