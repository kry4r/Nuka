import { describe, it, expect, vi, beforeEach } from 'vitest'

// Reuse the sdkBridge mock pattern from client.test.ts but tailored for
// elicitation: we need to capture the ElicitRequestSchema handler so we can
// trigger it ourselves.
const mocks = vi.hoisted(() => {
  const sdkInstances: Array<{
    connect: ReturnType<typeof vi.fn>
    listTools: ReturnType<typeof vi.fn>
    listResources: ReturnType<typeof vi.fn>
    callTool: ReturnType<typeof vi.fn>
    readResource: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    getInstructions: ReturnType<typeof vi.fn>
    setRequestHandler: ReturnType<typeof vi.fn>
  }> = []

  const FakeClient = vi.fn().mockImplementation(() => {
    const instance = {
      connect: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({ tools: [] }),
      listResources: vi.fn().mockResolvedValue({ resources: [] }),
      callTool: vi.fn(),
      readResource: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      getInstructions: vi.fn().mockReturnValue(undefined),
      setRequestHandler: vi.fn(),
    }
    sdkInstances.push(instance)
    return instance
  })

  const FakeStdio = vi.fn().mockImplementation(() => ({}))
  const FakeHttp = vi.fn().mockImplementation(() => ({}))
  const FakeSse = vi.fn().mockImplementation(() => ({}))
  const FakeListRootsRequestSchema = { __schema: 'ListRootsRequestSchema' }
  const FakeElicitRequestSchema = { __schema: 'ElicitRequestSchema' }

  return {
    FakeClient,
    FakeStdio,
    FakeHttp,
    FakeSse,
    FakeListRootsRequestSchema,
    FakeElicitRequestSchema,
    sdkInstances,
    clearInstances() { sdkInstances.length = 0 },
  }
})

vi.mock('../../../src/core/mcp/sdkBridge', () => ({
  Client: mocks.FakeClient,
  StdioClientTransport: mocks.FakeStdio,
  StreamableHTTPClientTransport: mocks.FakeHttp,
  SSEClientTransport: mocks.FakeSse,
  ListRootsRequestSchema: mocks.FakeListRootsRequestSchema,
  ElicitRequestSchema: mocks.FakeElicitRequestSchema,
}))

import { McpClient } from '../../../src/core/mcp/client'
import { PermissionBridge } from '../../../src/core/permission/bridge'
import { parseElicitationParams } from '../../../src/core/mcp/elicitation'

describe('parseElicitationParams', () => {
  it('defaults mode to "form" when omitted', () => {
    const p = parseElicitationParams({ message: 'hi', requestedSchema: {} })
    expect(p.mode).toBe('form')
    expect(p.message).toBe('hi')
  })

  it('preserves url mode + url field', () => {
    const p = parseElicitationParams({ message: 'go', requestedSchema: {}, mode: 'url', url: 'https://x' })
    expect(p.mode).toBe('url')
    expect(p.url).toBe('https://x')
  })

  it('handles missing params gracefully', () => {
    const p = parseElicitationParams(undefined)
    expect(p.message).toBe('')
    expect(p.mode).toBe('form')
  })
})

describe('McpClient elicitation handler', () => {
  beforeEach(() => {
    mocks.FakeClient.mockClear()
    mocks.clearInstances()
  })

  it('registers an ElicitRequestSchema handler when a permissionBridge is provided', async () => {
    const bridge = new PermissionBridge()
    const client = new McpClient({
      name: 'srv',
      config: { type: 'stdio', command: 'node', args: [] },
      permissionBridge: bridge,
    })
    await client.connect()
    const sdkInstance = mocks.sdkInstances[0]!
    const hasElicit = sdkInstance.setRequestHandler.mock.calls.some(
      ([schema]) => schema === mocks.FakeElicitRequestSchema,
    )
    expect(hasElicit).toBe(true)
  })

  it('does NOT register an elicit handler when no bridge is provided', async () => {
    const client = new McpClient({
      name: 'srv',
      config: { type: 'stdio', command: 'node', args: [] },
    })
    await client.connect()
    const sdkInstance = mocks.sdkInstances[0]!
    const hasElicit = sdkInstance.setRequestHandler.mock.calls.some(
      ([schema]) => schema === mocks.FakeElicitRequestSchema,
    )
    expect(hasElicit).toBe(false)
  })

  it('routes elicitation/create → bridge.elicit → user accept and returns content', async () => {
    const bridge = new PermissionBridge()
    bridge.setElicitationHandler((_payload, resolve) => {
      resolve({ action: 'accept', content: { name: 'value' } })
    })
    const client = new McpClient({
      name: 'srv',
      config: { type: 'stdio', command: 'node', args: [] },
      permissionBridge: bridge,
    })
    await client.connect()
    const sdkInstance = mocks.sdkInstances[0]!
    const [, handler] = sdkInstance.setRequestHandler.mock.calls.find(
      ([schema]) => schema === mocks.FakeElicitRequestSchema,
    )!
    const result = await (handler as (req: unknown) => Promise<unknown>)({
      method: 'elicitation/create',
      params: { message: 'name please', requestedSchema: { type: 'object', properties: { name: { type: 'string' } } } },
    })
    expect(result).toEqual({ action: 'accept', content: { name: 'value' } })
  })

  it('forwards decline when the handler declines', async () => {
    const bridge = new PermissionBridge()
    bridge.setElicitationHandler((_payload, resolve) => {
      resolve({ action: 'decline' })
    })
    const client = new McpClient({
      name: 'srv',
      config: { type: 'stdio', command: 'node', args: [] },
      permissionBridge: bridge,
    })
    await client.connect()
    const sdkInstance = mocks.sdkInstances[0]!
    const [, handler] = sdkInstance.setRequestHandler.mock.calls.find(
      ([schema]) => schema === mocks.FakeElicitRequestSchema,
    )!
    const result = await (handler as (req: unknown) => Promise<unknown>)({
      method: 'elicitation/create',
      params: { message: 'x', requestedSchema: {} },
    })
    expect(result).toEqual({ action: 'decline' })
  })

  it('returns { action: "decline" } when no elicitation handler is attached to the bridge', async () => {
    const bridge = new PermissionBridge()
    // no setElicitationHandler call
    const client = new McpClient({
      name: 'srv',
      config: { type: 'stdio', command: 'node', args: [] },
      permissionBridge: bridge,
    })
    await client.connect()
    const sdkInstance = mocks.sdkInstances[0]!
    const [, handler] = sdkInstance.setRequestHandler.mock.calls.find(
      ([schema]) => schema === mocks.FakeElicitRequestSchema,
    )!
    const result = await (handler as (req: unknown) => Promise<unknown>)({
      method: 'elicitation/create',
      params: { message: 'x', requestedSchema: {} },
    })
    expect(result).toEqual({ action: 'decline' })
  })
})
