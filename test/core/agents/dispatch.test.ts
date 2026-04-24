import { describe, it, expect } from 'vitest'
import { dispatchAgent } from '../../../src/core/agents/dispatch'
import type { ResolvedAgentDef } from '../../../src/core/agents/types'
import { ToolRegistry } from '../../../src/core/tools/registry'
import type { LLMProvider, ProviderEvent } from '../../../src/core/provider/types'
import type { ProviderResolver } from '../../../src/core/provider/resolver'
import { PermissionChecker } from '../../../src/core/permission/checker'
import { PermissionCache } from '../../../src/core/permission/cache'
import type { Tool } from '../../../src/core/tools/types'

function stubProvider(scripts: ProviderEvent[][]): LLMProvider {
  let i = 0
  return {
    id: 'p',
    format: 'openai',
    async *stream() {
      const script = scripts[i++] ?? []
      for (const ev of script) yield ev
    },
    async listRemoteModels() {
      return []
    },
  } as LLMProvider
}

function makeResolver(provider: LLMProvider): ProviderResolver {
  return {
    resolveFor: () => ({ provider, model: 'm' }),
    listProviders: () => [{ id: 'p' } as unknown as never],
  } as unknown as ProviderResolver
}

function makeAgent(overrides: Partial<ResolvedAgentDef> = {}): ResolvedAgentDef {
  return {
    name: 'reviewer',
    description: 'reviews code',
    systemPrompt: 'You are a reviewer.',
    maxTurns: 20,
    pluginName: 'core',
    ...overrides,
  }
}

function makeTool(name: string, run?: Tool['run']): Tool {
  return {
    name,
    description: name,
    parameters: { type: 'object', properties: {} },
    source: 'builtin',
    needsPermission: () => 'none',
    run: run ?? (async () => ({ output: `${name}-ok`, isError: false })),
  }
}

describe('dispatchAgent', () => {
  const permissionCache = new PermissionCache()
  const permission = new PermissionChecker(() => permissionCache, async () => ({ allowed: true }))

  it('returns the final assistant text on a text-only turn', async () => {
    const provider = stubProvider([
      [
        { type: 'text_delta', text: 'hello ' },
        { type: 'text_delta', text: 'world' },
        { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 3, outputTokens: 2 } },
      ],
    ])
    const result = await dispatchAgent({
      agent: makeAgent(),
      task: 'say hi',
      registry: new ToolRegistry(),
      providerResolver: makeResolver(provider),
      permission,
      signal: new AbortController().signal,
      parentSession: { providerId: 'p', model: 'm' },
    })
    expect(result.output).toBe('hello world')
    expect(result.isError).toBe(false)
    expect(result.turns).toBe(1)
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 2 })
  })

  it('runs a tool call and returns the final text', async () => {
    const registry = new ToolRegistry()
    registry.register(makeTool('Read'))
    const provider = stubProvider([
      [
        { type: 'tool_use_start', id: 't1', name: 'Read' },
        { type: 'tool_use_stop', id: 't1', input: { path: '/x' } },
        { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 2, outputTokens: 1 } },
      ],
      [
        { type: 'text_delta', text: 'done' },
        { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } },
      ],
    ])
    const result = await dispatchAgent({
      agent: makeAgent({ allowedTools: ['Read'] }),
      task: 'read it',
      registry,
      providerResolver: makeResolver(provider),
      permission,
      signal: new AbortController().signal,
      parentSession: { providerId: 'p', model: 'm' },
    })
    expect(result.output).toBe('done')
    expect(result.isError).toBe(false)
    expect(result.turns).toBe(2)
    expect(result.usage.inputTokens).toBe(3)
  })

  it('returns isError=true when maxTurns is exceeded (provider loops)', async () => {
    const registry = new ToolRegistry()
    registry.register(makeTool('Read'))
    // Provider always returns a tool_use — never ends.
    const provider: LLMProvider = {
      id: 'p',
      format: 'openai',
      async *stream() {
        let i = 0
        yield { type: 'tool_use_start', id: `t${i}`, name: 'Read' }
        yield { type: 'tool_use_stop', id: `t${i}`, input: {} }
        yield { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 } }
        i++
      },
      async listRemoteModels() { return [] },
    } as LLMProvider
    const result = await dispatchAgent({
      agent: makeAgent({ allowedTools: ['Read'] }),
      task: 'loop',
      registry,
      providerResolver: makeResolver(provider),
      permission,
      signal: new AbortController().signal,
      parentSession: { providerId: 'p', model: 'm' },
      maxTurns: 2,
    })
    expect(result.isError).toBe(true)
    expect(result.turns).toBe(2)
  })

  it('denies tools not in allowedTools — unknown tool error returned to sub-agent', async () => {
    const registry = new ToolRegistry()
    registry.register(makeTool('Read'))
    registry.register(makeTool('Bash', async () => ({ output: 'exec', isError: false })))
    // Sub-agent asks for Bash, which is NOT in its allowedTools.
    // Turn 1: assistant requests Bash → dispatch injects a "Unknown tool" error.
    // Turn 2: assistant gives up with text.
    const provider = stubProvider([
      [
        { type: 'tool_use_start', id: 't1', name: 'Bash' },
        { type: 'tool_use_stop', id: 't1', input: { cmd: 'ls' } },
        { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 } },
      ],
      [
        { type: 'text_delta', text: 'cannot' },
        { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } },
      ],
    ])
    const result = await dispatchAgent({
      agent: makeAgent({ allowedTools: ['Read'] }),
      task: 'please shell',
      registry,
      providerResolver: makeResolver(provider),
      permission,
      signal: new AbortController().signal,
      parentSession: { providerId: 'p', model: 'm' },
    })
    expect(result.output).toBe('cannot')
    expect(result.isError).toBe(false)
    expect(result.turns).toBe(2)
  })

  it('includes context after task when provided', async () => {
    // We verify context flows by intercepting the stream call via a spy-provider.
    let seenMessages: unknown
    const provider: LLMProvider = {
      id: 'p',
      format: 'openai',
      async *stream(req) {
        seenMessages = req.messages
        yield { type: 'text_delta', text: 'ok' }
        yield { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } }
      },
      async listRemoteModels() { return [] },
    } as LLMProvider
    await dispatchAgent({
      agent: makeAgent(),
      task: 'do the thing',
      context: 'some background',
      registry: new ToolRegistry(),
      providerResolver: makeResolver(provider),
      permission,
      signal: new AbortController().signal,
      parentSession: { providerId: 'p', model: 'm' },
    })
    const msgs = seenMessages as Array<{ role: string; content: Array<{ text: string }> }>
    expect(msgs[0]!.role).toBe('user')
    expect(msgs[0]!.content[0]!.text).toContain('do the thing')
    expect(msgs[0]!.content[0]!.text).toContain('some background')
  })

  it('sets allowedAgentDispatch=false on the sub-session (recursion guard)', async () => {
    // We capture the session via a tool that reads ctx.session.
    let capturedFlag: boolean | undefined
    const registry = new ToolRegistry()
    registry.register({
      name: 'Peek',
      description: 'peek',
      parameters: { type: 'object', properties: {} },
      source: 'builtin',
      needsPermission: () => 'none',
      run: async (_input, ctx) => {
        capturedFlag = ctx.session?.allowedAgentDispatch
        return { output: '', isError: false }
      },
    })
    const provider = stubProvider([
      [
        { type: 'tool_use_start', id: 't1', name: 'Peek' },
        { type: 'tool_use_stop', id: 't1', input: {} },
        { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 } },
      ],
      [
        { type: 'text_delta', text: 'done' },
        { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } },
      ],
    ])
    await dispatchAgent({
      agent: makeAgent({ allowedTools: ['Peek'] }),
      task: 'peek',
      registry,
      providerResolver: makeResolver(provider),
      permission,
      signal: new AbortController().signal,
      parentSession: { providerId: 'p', model: 'm' },
    })
    expect(capturedFlag).toBe(false)
  })

  it('returns isError when provider throws', async () => {
    const provider: LLMProvider = {
      id: 'p',
      format: 'openai',
      async *stream() {
        throw new Error('provider exploded')
      },
      async listRemoteModels() { return [] },
    } as LLMProvider
    const result = await dispatchAgent({
      agent: makeAgent(),
      task: 'x',
      registry: new ToolRegistry(),
      providerResolver: makeResolver(provider),
      permission,
      signal: new AbortController().signal,
      parentSession: { providerId: 'p', model: 'm' },
    })
    expect(result.isError).toBe(true)
    expect(typeof result.output).toBe('string')
    expect(result.output as string).toMatch(/provider exploded/)
  })
})
