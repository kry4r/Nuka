import { describe, it, expect, vi } from 'vitest'
import { writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAgent } from '../../../src/core/agent/loop'
import { createSession } from '../../../src/core/session/session'
import type { LLMProvider, ProviderEvent } from '../../../src/core/provider/types'
import { ToolRegistry } from '../../../src/core/tools/registry'
import { PermissionChecker } from '../../../src/core/permission/checker'
import type { LspManager } from '../../../src/core/lsp/manager'

function stubProvider(scripts: ProviderEvent[][]): LLMProvider {
  let i = 0
  return {
    id: 'p', format: 'openai',
    async *stream() {
      const script = scripts[i++] ?? []
      for (const ev of script) yield ev
    },
    async listRemoteModels() { return [] },
  } as LLMProvider
}

function makeMockLspManager(): LspManager & { notifyFileChanged: ReturnType<typeof vi.fn> } {
  return {
    clientFor: vi.fn().mockResolvedValue(null),
    trackerFor: vi.fn(),
    list: vi.fn(() => []),
    register: vi.fn(),
    closeAll: vi.fn(),
    notifyFileChanged: vi.fn(),
  } as unknown as LspManager & { notifyFileChanged: ReturnType<typeof vi.fn> }
}

describe('runAgent + LSP didChange hook', () => {
  it('calls notifyFileChanged after successful Write tool run', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })

    // Turn 1: Write tool call
    const turn1: ProviderEvent[] = [
      { type: 'tool_use_start', id: 't1', name: 'Write' },
      { type: 'tool_use_args_delta', id: 't1', delta: '{"path":"/tmp/test.ts","content":"const x=1"}' },
      { type: 'tool_use_stop', id: 't1', input: { path: '/tmp/test.ts', content: 'const x=1' } },
      { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 5, outputTokens: 3 } },
    ]
    // Turn 2: end turn
    const turn2: ProviderEvent[] = [
      { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 2, outputTokens: 1 } },
    ]
    const provider = stubProvider([turn1, turn2])

    const tools = new ToolRegistry()
    // Register a mock Write tool that succeeds
    tools.register({
      name: 'Write',
      description: 'write files',
      parameters: { type: 'object', required: ['path', 'content'], properties: { path: { type: 'string' }, content: { type: 'string' } } },
      source: 'builtin',
      needsPermission: () => 'write',
      run: async () => ({ output: 'wrote file', isError: false }),
    })

    const permission = new PermissionChecker(() => session.permissionCache, async () => ({ allowed: true }))
    const lsp = makeMockLspManager()

    const events: unknown[] = []
    for await (const ev of runAgent(
      { text: 'write a file' },
      session,
      { provider: { resolveFor: () => ({ provider, model: 'm' }) } as any, tools, permission, lsp },
      new AbortController().signal,
    )) {
      events.push(ev)
    }

    // Wait for the async notifyFileChanged to complete
    await new Promise(r => setImmediate(r))
    await new Promise(r => setImmediate(r))

    // notifyFileChanged should have been called (it reads the file, which may fail, but the call happens)
    expect(lsp.notifyFileChanged).toHaveBeenCalledWith('/tmp/test.ts', expect.any(String))
  })

  it('calls notifyFileChanged after successful Edit tool run', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })
    const tmpPath = join(tmpdir(), `nuka-lsp-test-${Date.now()}.ts`)
    await writeFile(tmpPath, 'const x = 1', 'utf8')

    try {
      const turn1: ProviderEvent[] = [
        { type: 'tool_use_start', id: 't1', name: 'Edit' },
        { type: 'tool_use_args_delta', id: 't1', delta: JSON.stringify({ path: tmpPath, old_string: 'x', new_string: 'y' }) },
        { type: 'tool_use_stop', id: 't1', input: { path: tmpPath, old_string: 'x', new_string: 'y' } },
        { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 5, outputTokens: 3 } },
      ]
      const turn2: ProviderEvent[] = [
        { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 2, outputTokens: 1 } },
      ]
      const provider = stubProvider([turn1, turn2])

      const tools = new ToolRegistry()
      tools.register({
        name: 'Edit',
        description: 'edit files',
        parameters: { type: 'object', required: ['path', 'old_string', 'new_string'], properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } } },
        source: 'builtin',
        needsPermission: () => 'write',
        run: async () => ({ output: 'edited', isError: false }),
      })

      const permission = new PermissionChecker(() => session.permissionCache, async () => ({ allowed: true }))
      const lsp = makeMockLspManager()

      for await (const _ev of runAgent(
        { text: 'edit a file' },
        session,
        { provider: { resolveFor: () => ({ provider, model: 'm' }) } as any, tools, permission, lsp },
        new AbortController().signal,
      )) { /* drain */ }

      // Wait for the async file read + notifyFileChanged — poll up to 50ms
      const deadline = Date.now() + 50
      while (lsp.notifyFileChanged.mock.calls.length === 0 && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 5))
      }

      expect(lsp.notifyFileChanged).toHaveBeenCalledWith(tmpPath, expect.any(String))
    } finally {
      await rm(tmpPath, { force: true })
    }
  })

  it('does NOT call notifyFileChanged for non-file tools', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })

    const turn1: ProviderEvent[] = [
      { type: 'tool_use_start', id: 't1', name: 'Bash' },
      { type: 'tool_use_args_delta', id: 't1', delta: '{"command":"echo hello"}' },
      { type: 'tool_use_stop', id: 't1', input: { command: 'echo hello' } },
      { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 5, outputTokens: 3 } },
    ]
    const turn2: ProviderEvent[] = [
      { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 2, outputTokens: 1 } },
    ]
    const provider = stubProvider([turn1, turn2])

    const tools = new ToolRegistry()
    tools.register({
      name: 'Bash',
      description: 'run bash',
      parameters: { type: 'object', required: ['command'], properties: { command: { type: 'string' } } },
      source: 'builtin',
      needsPermission: () => 'exec',
      run: async () => ({ output: 'hello', isError: false }),
    })

    const permission = new PermissionChecker(() => session.permissionCache, async () => ({ allowed: true }))
    const lsp = makeMockLspManager()

    for await (const _ev of runAgent(
      { text: 'run a command' },
      session,
      { provider: { resolveFor: () => ({ provider, model: 'm' }) } as any, tools, permission, lsp },
      new AbortController().signal,
    )) { /* drain */ }

    await new Promise(r => setImmediate(r))
    expect(lsp.notifyFileChanged).not.toHaveBeenCalled()
  })

  it('does NOT call notifyFileChanged when lsp dep is absent', async () => {
    const session = createSession({ providerId: 'p', model: 'm' })

    const turn1: ProviderEvent[] = [
      { type: 'tool_use_start', id: 't1', name: 'Write' },
      { type: 'tool_use_args_delta', id: 't1', delta: '{"path":"/tmp/x.ts","content":""}' },
      { type: 'tool_use_stop', id: 't1', input: { path: '/tmp/x.ts', content: '' } },
      { type: 'message_stop', stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 } },
    ]
    const turn2: ProviderEvent[] = [
      { type: 'message_stop', stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } },
    ]
    const provider = stubProvider([turn1, turn2])
    const tools = new ToolRegistry()
    tools.register({
      name: 'Write', description: 'w', parameters: {},
      source: 'builtin', needsPermission: () => 'write',
      run: async () => ({ output: 'ok', isError: false }),
    })
    const permission = new PermissionChecker(() => session.permissionCache, async () => ({ allowed: true }))

    // No lsp dep
    for await (const _ev of runAgent(
      { text: 'write' },
      session,
      { provider: { resolveFor: () => ({ provider, model: 'm' }) } as any, tools, permission },
      new AbortController().signal,
    )) { /* drain */ }

    // No error should be thrown; test just verifies no crash
  })
})
