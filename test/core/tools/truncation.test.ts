// test/core/tools/truncation.test.ts
// Focused tests for the per-tool maxResultSizeChars feature (M2.6).
// The implementation lives in src/core/agent/loop.ts and
// src/core/tools/types.ts (the maxResultSizeChars field on Tool).
// These tests validate the contract via the loop (integration) and
// also document the expected truncation notice format.

import { describe, it, expect } from 'vitest'
import { runAgent } from '../../../src/core/agent/loop'
import { createSession } from '../../../src/core/session/session'
import type { LLMProvider, ProviderEvent } from '../../../src/core/provider/types'
import { ToolRegistry } from '../../../src/core/tools/registry'
import { PermissionChecker } from '../../../src/core/permission/checker'
import type { Tool } from '../../../src/core/tools/types'

function oneToolTurn(toolName: string, input: unknown = {}): LLMProvider {
  let turn = 0
  return {
    id: 'p', format: 'openai',
    async *stream(): AsyncIterable<ProviderEvent> {
      if (turn === 0) {
        turn++
        yield { type: 'tool_use_start', id: 'mx1', name: toolName }
        yield { type: 'tool_use_stop', id: 'mx1', input }
        yield { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 } }
      } else {
        yield { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } }
      }
    },
    async listRemoteModels() { return [] },
  } as LLMProvider
}

async function runTool(tool: Tool, output: string): Promise<{ eventOutput: string; sessionContent: string | import('../../../src/core/tools/content').ContentBlock[] }> {
  const session = createSession({ providerId: 'p', model: 'm' })
  const provider = oneToolTurn(tool.name)
  const tools = new ToolRegistry()
  const runTool = { ...tool, run: async () => ({ output, isError: false }) }
  tools.register(runTool)
  const permission = new PermissionChecker(() => session.permissionCache, async () => ({ allowed: true }))
  const events: ProviderEvent[] = []
  for await (const ev of runAgent(
    { text: 'go' },
    session,
    { provider: { resolveFor: () => ({ provider, model: 'm' }) } as any, tools, permission },
    new AbortController().signal,
  )) {
    events.push(ev as any)
  }
  const resultEv = (events as any[]).find(e => e.type === 'tool_result' && e.id === 'mx1')
  const toolMsg = session.messages.find(m => m.role === 'tool') as any
  return {
    eventOutput: resultEv?.output ?? '',
    sessionContent: toolMsg?.content ?? '',
  }
}

describe('maxResultSizeChars truncation', () => {
  it('does NOT truncate when output is within the limit', async () => {
    const tool: Tool = {
      name: 'Small',
      description: 'small output',
      parameters: { type: 'object', properties: {} },
      source: 'builtin',
      maxResultSizeChars: 100,
      needsPermission: () => 'none',
      run: async () => ({ output: '', isError: false }),
    }
    const result = await runTool(tool, 'x'.repeat(100))
    expect(result.eventOutput).toBe('x'.repeat(100))
    expect(result.sessionContent).toBe('x'.repeat(100))
  })

  it('truncates when output exceeds the limit', async () => {
    const tool: Tool = {
      name: 'Big',
      description: 'big output',
      parameters: { type: 'object', properties: {} },
      source: 'builtin',
      maxResultSizeChars: 100,
      needsPermission: () => 'none',
      run: async () => ({ output: '', isError: false }),
    }
    const bigOutput = 'a'.repeat(500)
    const result = await runTool(tool, bigOutput)
    expect(result.eventOutput.length).toBeLessThan(bigOutput.length)
    expect(result.eventOutput).toContain('[truncated')
    expect(result.eventOutput).toContain('400 chars')
    expect(result.eventOutput.startsWith('a'.repeat(100))).toBe(true)
  })

  it('truncation notice shows exact char count removed', async () => {
    const tool: Tool = {
      name: 'Precise',
      description: 'precise',
      parameters: { type: 'object', properties: {} },
      source: 'builtin',
      maxResultSizeChars: 50,
      needsPermission: () => 'none',
      run: async () => ({ output: '', isError: false }),
    }
    const result = await runTool(tool, 'x'.repeat(200))
    // 200 - 50 = 150 truncated
    expect(result.eventOutput).toContain('150 chars')
  })

  it('does not truncate when maxResultSizeChars is not set', async () => {
    const tool: Tool = {
      name: 'NoLimit',
      description: 'no limit',
      parameters: { type: 'object', properties: {} },
      source: 'builtin',
      needsPermission: () => 'none',
      run: async () => ({ output: '', isError: false }),
    }
    const bigOutput = 'z'.repeat(10000)
    const result = await runTool(tool, bigOutput)
    expect(result.eventOutput).toBe(bigOutput)
    expect(result.eventOutput).not.toContain('[truncated')
  })

  it('truncated output is stored in session message (not just event)', async () => {
    const tool: Tool = {
      name: 'Persist',
      description: 'test persistence',
      parameters: { type: 'object', properties: {} },
      source: 'builtin',
      maxResultSizeChars: 20,
      needsPermission: () => 'none',
      run: async () => ({ output: '', isError: false }),
    }
    const result = await runTool(tool, 'y'.repeat(100))
    // Session message content must also be truncated
    expect(typeof result.sessionContent).toBe('string')
    expect((result.sessionContent as string).length).toBeLessThan(100)
    expect((result.sessionContent as string)).toContain('[truncated')
  })
})
