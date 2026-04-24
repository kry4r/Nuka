import { describe, it, expect, vi } from 'vitest'
import { mcpToolsFor } from '../../../src/core/mcp/toolAdapter'
import type { McpToolDescriptor } from '../../../src/core/mcp/types'
import { MAX_MCP_DESCRIPTION_CHARS } from '../../../src/core/mcp/truncate'

function makeMockClient(
  name: string,
  tools: McpToolDescriptor[],
  callToolResult: { output: string; isError: boolean } = { output: 'ok', isError: false },
) {
  return {
    name,
    listTools: vi.fn().mockResolvedValue(tools),
    callTool: vi.fn().mockResolvedValue(callToolResult),
  } as unknown as import('../../../src/core/mcp/client').McpClient
}

describe('mcpToolsFor', () => {
  it('returns a tool with name=mcp__srv__foo', async () => {
    const client = makeMockClient('srv', [{ name: 'foo', description: 'd', inputSchema: { type: 'object', properties: {} } }])
    const tools = await mcpToolsFor(client)
    expect(tools).toHaveLength(1)
    expect(tools[0]?.name).toBe('mcp__srv__foo')
  })

  it('sets source to "mcp"', async () => {
    const client = makeMockClient('srv', [{ name: 'foo' }])
    const tools = await mcpToolsFor(client)
    expect(tools[0]?.source).toBe('mcp')
  })

  it('sets needsPermission to return "exec"', async () => {
    const client = makeMockClient('srv', [{ name: 'foo' }])
    const tools = await mcpToolsFor(client)
    expect(tools[0]?.needsPermission({})).toBe('exec')
  })

  it('uses description from descriptor', async () => {
    const client = makeMockClient('srv', [{ name: 'foo', description: 'my desc' }])
    const tools = await mcpToolsFor(client)
    expect(tools[0]?.description).toBe('my desc')
  })

  it('defaults description to empty string when missing', async () => {
    const client = makeMockClient('srv', [{ name: 'foo' }])
    const tools = await mcpToolsFor(client)
    expect(tools[0]?.description).toBe('')
  })

  it('uses inputSchema as parameters', async () => {
    const schema = { type: 'object', properties: { x: { type: 'number' } } }
    const client = makeMockClient('srv', [{ name: 'foo', inputSchema: schema }])
    const tools = await mcpToolsFor(client)
    expect(tools[0]?.parameters).toEqual(schema)
  })

  it('defaults parameters to {type:object,properties:{}} when no inputSchema', async () => {
    const client = makeMockClient('srv', [{ name: 'foo' }])
    const tools = await mcpToolsFor(client)
    expect(tools[0]?.parameters).toEqual({ type: 'object', properties: {} })
  })

  it('tool.run delegates to client.callTool with the raw tool name and signal', async () => {
    const client = makeMockClient('srv', [{ name: 'foo' }], { output: 'result', isError: false })
    const tools = await mcpToolsFor(client)
    const tool = tools[0]!
    const signal = new AbortController().signal
    const ctx = { signal, cwd: '/tmp', onProgress: undefined }
    const result = await tool.run({ x: 1 }, ctx)
    expect(client.callTool).toHaveBeenCalledWith('foo', { x: 1 }, signal)
    expect(result).toEqual({ output: 'result', isError: false })
  })

  it('normalizes server name with hyphens in tool name', async () => {
    const client = makeMockClient('my-server', [{ name: 'read-file' }])
    const tools = await mcpToolsFor(client)
    expect(tools[0]?.name).toBe('mcp__my_server__read_file')
  })

  it('maps readOnlyHint → annotations.readOnly', async () => {
    const client = makeMockClient('srv', [{
      name: 'foo',
      annotations: { readOnlyHint: true },
    }])
    const tools = await mcpToolsFor(client)
    expect(tools[0]?.annotations?.readOnly).toBe(true)
    expect(tools[0]?.annotations?.destructive).toBeUndefined()
    expect(tools[0]?.annotations?.openWorld).toBeUndefined()
  })

  it('maps destructiveHint → annotations.destructive', async () => {
    const client = makeMockClient('srv', [{
      name: 'bar',
      annotations: { destructiveHint: true },
    }])
    const tools = await mcpToolsFor(client)
    expect(tools[0]?.annotations?.destructive).toBe(true)
    expect(tools[0]?.annotations?.readOnly).toBeUndefined()
  })

  it('maps openWorldHint → annotations.openWorld', async () => {
    const client = makeMockClient('srv', [{
      name: 'baz',
      annotations: { openWorldHint: true },
    }])
    const tools = await mcpToolsFor(client)
    expect(tools[0]?.annotations?.openWorld).toBe(true)
  })

  it('maps all three hints simultaneously', async () => {
    const client = makeMockClient('srv', [{
      name: 'all',
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    }])
    const tools = await mcpToolsFor(client)
    const ann = tools[0]?.annotations
    expect(ann?.readOnly).toBe(false)
    expect(ann?.destructive).toBe(true)
    expect(ann?.openWorld).toBe(true)
  })

  it('produces undefined annotations when descriptor has no annotations', async () => {
    const client = makeMockClient('srv', [{ name: 'plain' }])
    const tools = await mcpToolsFor(client)
    expect(tools[0]?.annotations).toBeUndefined()
  })

  it('truncates 5000-char descriptions to MAX_MCP_DESCRIPTION_CHARS with an ellipsis', async () => {
    const huge = 'x'.repeat(5000)
    const client = makeMockClient('srv', [{ name: 'foo', description: huge }])
    const tools = await mcpToolsFor(client)
    expect(tools[0]!.description.length).toBe(MAX_MCP_DESCRIPTION_CHARS)
    expect(tools[0]!.description.endsWith('…')).toBe(true)
  })

  // M1.16 — _meta → Tool field mapping
  it('maps _meta.searchHint to Tool.searchHint', async () => {
    const client = makeMockClient('srv', [{
      name: 'foo',
      _meta: { searchHint: ['git', 'version-control'] },
    }])
    const tools = await mcpToolsFor(client)
    expect(tools[0]?.searchHint).toEqual(['git', 'version-control'])
  })

  it('maps _meta.alwaysLoad to Tool.alwaysLoad', async () => {
    const client = makeMockClient('srv', [{
      name: 'foo',
      _meta: { alwaysLoad: true },
    }])
    const tools = await mcpToolsFor(client)
    expect(tools[0]?.alwaysLoad).toBe(true)
  })

  it('maps both _meta fields simultaneously', async () => {
    const client = makeMockClient('srv', [{
      name: 'foo',
      _meta: { searchHint: ['git'], alwaysLoad: true },
    }])
    const tools = await mcpToolsFor(client)
    expect(tools[0]?.searchHint).toEqual(['git'])
    expect(tools[0]?.alwaysLoad).toBe(true)
  })

  it('leaves searchHint and alwaysLoad undefined when _meta is absent', async () => {
    const client = makeMockClient('srv', [{ name: 'foo' }])
    const tools = await mcpToolsFor(client)
    expect(tools[0]?.searchHint).toBeUndefined()
    expect(tools[0]?.alwaysLoad).toBeUndefined()
  })

  it('leaves alwaysLoad undefined when only searchHint is in _meta', async () => {
    const client = makeMockClient('srv', [{
      name: 'foo',
      _meta: { searchHint: ['search'] },
    }])
    const tools = await mcpToolsFor(client)
    expect(tools[0]?.alwaysLoad).toBeUndefined()
    expect(tools[0]?.searchHint).toEqual(['search'])
  })
})
